"""Record feature (additive): record user actions in a real Chromium window and turn them into test cases.

No AI / Gemini is used anywhere in this module. The browser runs in its own worker thread (Playwright sync API
is thread-affine); HTTP handlers only touch lock-protected state and push commands onto a queue.
"""
import json
import logging
import os
import queue
import re
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import FileResponse, Response

from .services import ServiceError

log = logging.getLogger("atg.rec")
REC_DIR = Path(__file__).resolve().parent / "recordings"
INJECT_JS = (Path(__file__).resolve().parent / "recorder_inject.js").read_text(encoding="utf-8")
CHROME = os.environ.get("ATG_REC_CHROME", "/usr/bin/google-chrome")
DEFAULT_IGNORE = ["#onetrust-banner-sdk", ".cookie-consent", "#cookie-banner", "[id*=cookie]", "#intercom-container",
                  ".intercom-launcher", "#chat-widget", "[class*=chat-widget]", "#hubspot-messages-iframe-container"]
TYPES = ("Positive", "Negative", "Edge")
PRIOS = ("High", "Medium", "Low")
ACTIONS = {"navigate": "Navigate", "type": "Type", "click": "Click", "select": "Select", "check": "Check",
           "scroll": "Scroll", "checkpoint": "Checkpoint", "suggest": "Suggested", "ignored": "Skipped", "divider": "Divider"}
REC: Dict[str, "Recorder"] = {}          # owner key -> active recorder
_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _slug(s: str, n: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")
    return (s[:n].strip("_") or "recorded_test")


def _short_url(u: str) -> str:
    try:
        p = urlparse(u)
        if p.scheme in ("http", "https"):
            return (p.path or "/") + (("?" + p.query) if p.query else "")
    except Exception:
        pass
    return u


def _page_title(url: str, title: str) -> str:
    if title:
        return title.split("|")[0].split(" - ")[0].strip()[:60]
    path = _short_url(url).strip("/").split("?")[0]
    return (path.split("/")[-1].replace("-", " ").replace("_", " ").replace(".html", "").title() or "Home")


# --------------------------------------------------------------------------- #
# Recorder session
# --------------------------------------------------------------------------- #
class Recorder:
    def __init__(self, key: str, setup: Dict[str, Any], steps: Optional[List[Dict[str, Any]]] = None,
                 rid: Optional[str] = None, elapsed0: float = 0.0, params: Optional[Dict[str, Any]] = None):
        self.key, self.setup = key, setup
        self.rid = rid or datetime.now().strftime("%Y%m%d_%H%M%S_") + uuid.uuid4().hex[:4]
        self.dir = REC_DIR / key / self.rid
        (self.dir / "shots").mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.steps: List[Dict[str, Any]] = steps or []
        self.params: Dict[str, Any] = params or {}
        self.cmds: "queue.Queue" = queue.Queue()
        self.inbox: List[Any] = []
        self.state = "starting"          # starting | recording | paused | stopping | stopped | error | closed
        self.error = ""
        self.paused = False
        self.elapsed0 = elapsed0          # seconds already recorded before a resume
        self.t0 = time.time()
        self.video = ""                   # filename inside self.dir
        self.video_segments: List[str] = []
        self.cur = {"url": setup.get("url", ""), "title": "", "heading": ""}
        self.last_click = 0.0
        self.saved_at = ""
        self.test_result = None
        self.headless = bool(os.environ.get("ATG_REC_HEADLESS")) or not os.environ.get("DISPLAY")
        self.done = threading.Event()
        self.thread = threading.Thread(target=self._main, name=f"rec-{self.rid}", daemon=True)

    # ------------------------------------------------------------ helpers
    def elapsed(self) -> float:
        return round(self.elapsed0 + (time.time() - self.t0), 1)

    def _vt(self) -> float:   # video timestamp (this segment)
        return round(time.time() - self.t0, 2)

    def _new_step(self, kind: str, **kw) -> Dict[str, Any]:
        s = {"id": uuid.uuid4().hex[:8], "kind": kind, "desc": "", "expected": "", "name": "", "loc": {},
             "value": "", "masked": "", "param": "", "note": "", "shot": "", "t": self.elapsed(), "vt": self._vt(),
             "seg": len(self.video_segments), "errors": [], "url": self.cur.get("url", "")}
        s.update(kw)
        return s

    def add(self, s: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            self.steps.append(s)
        self.autosave()
        return s

    def find(self, sid: str) -> Optional[Dict[str, Any]]:
        return next((s for s in self.steps if s["id"] == sid), None)

    def autosave(self):
        """#13: draft is written after every change."""
        try:
            with self.lock:
                self.saved_at = _now()
                d = {"rid": self.rid, "setup": self.setup, "steps": self.steps, "params": self.params,
                     "elapsed": self.elapsed(), "saved_at": self.saved_at, "last_url": self.cur.get("url", ""),
                     "video": self.video, "status": "draft"}
            p = REC_DIR / self.key / "draft.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(d, indent=1), encoding="utf-8")
            tmp.replace(p)
        except Exception:
            log.exception("rec autosave failed")

    def public(self, since: int = 0) -> Dict[str, Any]:
        with self.lock:
            return {"rid": self.rid, "state": self.state, "error": self.error, "paused": self.paused,
                    "elapsed": self.elapsed(), "setup": self.setup, "steps": self.steps, "params": self.params,
                    "saved_at": self.saved_at, "cur": dict(self.cur), "headless": self.headless,
                    "video": bool(self.setup.get("video")), "test_result": self.test_result}

    # ------------------------------------------------------------ browser thread
    def _binding(self, source, payload):
        if isinstance(payload, dict) and payload.get("type") == "hello":
            return {"paused": self.paused, "t0": int((time.time() - self.elapsed()) * 1000)}
        self.inbox.append((source.get("page") if isinstance(source, dict) else None, payload))
        return {"ok": True}

    def _main(self):
        try:
            from playwright.sync_api import sync_playwright
        except Exception as ex:   # pragma: no cover
            self.state, self.error = "error", f"Playwright is not installed: {ex}"
            self.done.set()
            return
        pw = browser = ctx = None
        try:
            pw = sync_playwright().start()
            kw = {"headless": self.headless, "args": ["--no-first-run", "--no-default-browser-check"]}
            if Path(CHROME).exists():
                kw["executable_path"] = CHROME
            browser = pw.chromium.launch(**kw)
            ckw: Dict[str, Any] = {"viewport": {"width": 1280, "height": 800}}
            if self.setup.get("video"):
                ckw["record_video_dir"] = str(self.dir / "video_tmp")
                ckw["record_video_size"] = {"width": 1280, "height": 800}
            ctx = browser.new_context(**ckw)
            if self.setup.get("video"):   # video needs Playwright's ffmpeg; fall back to no video instead of failing
                try:
                    ctx.new_page().close()
                except Exception as ex:
                    log.warning("video recording unavailable: %s", ex)
                    ctx.close()
                    self.setup["video"] = False
                    self.error = "Video recording unavailable on this machine — recording without video."
                    ckw.pop("record_video_dir", None); ckw.pop("record_video_size", None)
                    ctx = browser.new_context(**ckw)
            cfg = {"ignore": self.setup.get("ignore") or [], "maskPw": bool(self.setup.get("mask", True)),
                   "ignoreScroll": bool(self.setup.get("ignore_hover", True))}
            ctx.expose_binding("__atgRec", self._binding)
            ctx.add_init_script(INJECT_JS.replace("__ATG_CFG__", json.dumps(cfg)))
            ctx.on("page", self._wire)
            page = ctx.new_page()
            self.page = page
            self.t0 = time.time()
            url = self.cur["url"] or self.setup.get("url")
            first = not self.steps
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            self._refresh(page)
            if first:
                self.add(self._new_step("navigate", desc=f"Open {url}",
                                        expected=f"{_page_title(page.url, self.cur['title'])} page opens",
                                        url=page.url, loc={"url": url}))
                self._shot(page, self.steps[-1])
            self.state = "recording"
            tick = 0
            while not self.done.is_set():
                self._drain(page)
                if self.done.is_set():
                    break
                if page.is_closed():
                    pages = [p for p in ctx.pages if not p.is_closed()]
                    if not pages:
                        self.state = "closed"
                        break
                    page = self.page = pages[-1]
                try:
                    page.wait_for_timeout(120)
                except Exception:
                    pass
                tick += 1
                if tick % 8 == 0:
                    self._refresh(page)
        except Exception as ex:
            log.exception("recorder failed")
            self.error = str(ex).split("\n")[0][:300]
            self.state = "error"
        finally:
            try:
                vids = [p.video for p in (ctx.pages if ctx else []) if getattr(p, "video", None)]
                if ctx:
                    ctx.close()
                for v in vids[:1]:
                    src = Path(v.path())
                    if src.exists():
                        name = f"evidence_{datetime.now().strftime('%Y-%m-%d_%H%M')}_{len(self.video_segments) + 1}.webm"
                        shutil.move(str(src), str(self.dir / name))
                        with self.lock:
                            self.video_segments.append(name)
                            self.video = self.video_segments[0]
                shutil.rmtree(self.dir / "video_tmp", ignore_errors=True)
            except Exception:
                log.exception("video finalize failed")
            for x in (browser, pw):
                try:
                    x and (x.close() if x is browser else x.stop())
                except Exception:
                    pass
            if self.state not in ("error",):
                self.state = "stopped" if self.state != "closed" else "closed"
            self.autosave()
            self.done.set()

    def _wire(self, page):
        q = lambda kind, text: self.inbox.append((page, {"type": "err", "kind": kind, "text": text}))   # ordered with actions
        page.on("console", lambda m: m.type == "error" and q("console", m.text))
        page.on("pageerror", lambda e: q("console", f"{getattr(e, 'name', 'Error')}: {getattr(e, 'message', e)}"))
        page.on("response", lambda r: r.status >= 400 and q("network", f"{r.request.method} {_short_url(r.url)} → {r.status} {r.status_text}"))
        page.on("requestfailed", lambda r: q("network", f"{r.method} {_short_url(r.url)} → failed ({r.failure})"))
        page.on("framenavigated", lambda f: f == page.main_frame and self.inbox.append((page, {"type": "nav", "url": f.url})))
        self.page = page

    def _err(self, kind: str, text: str):
        """#11 console / network errors are attached to the step that was active when they happened."""
        if "__atgRec" in text or "favicon" in text:
            return
        if kind == "console" and "Failed to load resource" in text:
            return   # the network entry already covers it
        with self.lock:
            tgt = next((s for s in reversed(self.steps) if s["kind"] not in ("suggest", "divider", "ignored")), None)
            if tgt is not None and len(tgt["errors"]) < 10 and not any(e["text"] == text for e in tgt["errors"]):
                tgt["errors"].append({"kind": kind, "text": text[:400], "t": self.elapsed()})
        self.autosave()

    def _refresh(self, page):
        try:
            info = page.evaluate("()=>({t:document.title,h:((document.querySelector('h1')||document.querySelector('h2')||{}).innerText||'').trim().slice(0,80)})")
            with self.lock:
                self.cur.update({"url": page.url, "title": info.get("t", ""), "heading": info.get("h", "")})
        except Exception:
            pass

    def _shot(self, page, step):
        """#9 per-step screenshot; #12 sensitive inputs masked, toolbar hidden."""
        if self.setup.get("screenshots") is False:
            return
        try:
            name = f"{len(self.steps):03d}_{step['id']}.jpg"
            page.screenshot(path=str(self.dir / "shots" / name), type="jpeg", quality=60, timeout=5000,
                            mask=[page.locator("[data-atg-sensitive], input[type=password]")], mask_color="#9aa3b2",
                            style="#atg-rec-toolbar{display:none!important}", animations="disabled")
            with self.lock:
                step["shot"] = name
        except Exception as ex:
            log.info("screenshot skipped: %s", ex)

    def _set_paused(self, page, p: bool):
        self.paused = p
        self.state = "paused" if p else "recording"
        try:
            for pg in page.context.pages:
                pg.evaluate(f"()=>window.__atgSetState&&window.__atgSetState({{paused:{'true' if p else 'false'}}})")
        except Exception:
            pass

    def _drain(self, page):
        while True:
            try:
                c = self.cmds.get_nowait()
            except queue.Empty:
                break
            try:
                self._cmd(page, c)
            finally:
                if c.get("evt"):
                    c["evt"].set()
        self._drain_inbox(page)

    def _drain_inbox(self, page):
        while self.inbox:
            src, ev = self.inbox.pop(0)
            try:
                self._event(src or page, ev)
            except Exception:
                log.exception("rec event failed")

    def _cmd(self, page, c: Dict[str, Any]):
        cmd = c.get("cmd")
        if cmd == "pause":
            self._set_paused(page, True)
        elif cmd == "resume":
            self._set_paused(page, False)
        elif cmd == "stop":
            self.done.set()
        elif cmd == "undo":
            with self.lock:   # removes the last real step and any suggestions it produced
                for i in range(len(self.steps) - 1, -1, -1):
                    k = self.steps[i]["kind"]
                    if k == "suggest":
                        self.steps.pop(i)
                        continue
                    if k != "divider":
                        self.steps.pop(i)
                        break
            self.autosave()
        elif cmd == "_test" and os.environ.get("ATG_REC_TEST_HOOK"):
            self._test_action(page, c.get("action") or {})
            self._drain_inbox(page)
        elif cmd == "checkpoint":
            self._refresh(page)
            cur = self.cur
            exp = (c.get("expected") or "").strip() or (f'Page shows "{cur["heading"]}"' if cur["heading"] else "Page is displayed")
            a = c.get("assert") or ("heading" if cur["heading"] else "url")
            s = self._new_step("checkpoint", desc=f"✔ Expected: {exp}", expected=exp, url=cur["url"],
                               loc={"assert": a, "url": _short_url(cur["url"]), "heading": cur["heading"],
                                    "text": c.get("text", ""), "css": c.get("css", "")})
            self.add(s)
            self._shot(page, s)

    def _test_action(self, page, a: Dict[str, Any]):
        """E2E-only hook (ATG_REC_TEST_HOOK=1): drive the recorder window with real (trusted) input events."""
        try:
            k, sel = a.get("do"), a.get("sel", "")
            if k == "click":
                page.click(sel, timeout=5000)
            elif k == "type":
                page.click(sel, timeout=5000)
                page.keyboard.type(a.get("text", ""), delay=10)
                page.keyboard.press("Tab")
            elif k == "select":
                page.select_option(sel, label=a.get("label"))
            elif k == "key":
                page.keyboard.press(a.get("key", ""))
            elif k == "goto":
                page.goto(a.get("url"), wait_until="domcontentloaded")
            elif k == "wait":
                page.wait_for_timeout(int(a.get("ms", 300)))
            elif k == "eval":
                self.test_result = page.evaluate(a.get("js", "0"))
            page.wait_for_timeout(250)
        except Exception as ex:
            log.info("test action failed: %s", ex)
            self.error = f"test action failed: {ex}"[:300]

    def _event(self, page, ev: Dict[str, Any]):
        t = ev.get("type")
        if t == "cmd":
            return self._cmd(page, {"cmd": ev.get("cmd")})
        if t == "err":
            return self._err(ev.get("kind", "console"), str(ev.get("text", "")))
        if t == "nav":
            return self._nav(page, ev.get("url", ""))
        if self.paused:
            return
        el = ev.get("el") or {}
        name = el.get("name") or el.get("tag") or "element"
        role = el.get("role") or ""
        noun = {"button": "button", "link": "link", "checkbox": "checkbox", "radio": "option", "combobox": "dropdown",
                "tab": "tab", "menuitem": "menu item", "textbox": "field"}.get(role, "")
        if t == "click":   # remember whether this click is expected to navigate (link / form button)
            self.last_click = time.time()
            self.last_click_nav = el.get("role") == "link" or bool(el.get("form"))
            s = self._new_step("click", desc=f'Click "{name}"' + (f" {noun}" if noun else ""), name=name, loc=el)
        elif t == "check":
            s = self._new_step("check", desc=f'{"Check" if ev.get("checked") else "Uncheck"} "{name}" {noun or "checkbox"}',
                               name=name, loc=dict(el, checked=bool(ev.get("checked"))))
        elif t == "type":
            val, masked = str(ev.get("value", "")), ev.get("masked") or ""
            with self.lock:   # #2 re-typing in the same field right after replaces the previous step
                last = self.steps[-1] if self.steps else None
                if last and last["kind"] == "type" and last["loc"].get("css") == el.get("css"):
                    self.steps.pop()
            s = self._new_step("type", desc=f'Enter "{val}" in {name} field', name=name, loc=el, value=val, masked=masked,
                               expected="Value is masked" if masked else "Value is entered", merged=int(ev.get("keys") or 0))
            if masked:   # #4/#12 masked values always become parameters
                pn = "otp" if masked == "otp" else ("card_number" if masked == "card" and "card" in name.lower() else _slug(name, 20))
                s["param"] = pn
                with self.lock:
                    self.params[pn] = {"value": val, "masked": True}
        elif t == "select":
            opt = ev.get("option") or ev.get("value") or ""
            s = self._new_step("select", desc=f'Select "{opt}" in {name} dropdown', name=name, loc=el, value=opt)
        elif t == "scroll":
            s = self._new_step("scroll", desc=f"Scroll page to {ev.get('y', 0)}px", loc={"y": ev.get("y", 0)})
        elif t == "ignored":
            s = self._new_step("ignored", desc=f'Skipped: click on "{name}" (ignore list {ev.get("by", "")})', name=name, loc=el)
            return self.add(s)
        elif t == "msg":
            txt = ev.get("text", "")
            err = ev.get("level") == "error"
            s = self._new_step("suggest", desc=f'{"Error" if err else "Message"} appeared: "{txt[:90]}"',
                               expected=(f'Error message "{txt[:80]}" is shown' if err else f'"{txt[:80]}" message is shown'),
                               loc={"assert": "text", "msg": True, "text": txt[:120], "css": el.get("css", ""), "url": _short_url(ev.get("url", ""))})
            self.add(s)
            return self._shot(page, s)
        else:
            return
        s["url"] = ev.get("url", "")
        self.add(s)
        self._shot(page, s)

    def _nav(self, page, url: str):
        if not url or url.startswith("about:") or url == self.cur.get("url"):
            return
        try:
            page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        old = self.cur.get("url", "")
        self._refresh(page)
        if self.paused or _short_url(old) == _short_url(url):
            return
        title = _page_title(url, self.cur.get("title", ""))
        dt = time.time() - self.last_click
        if dt < 4 and (getattr(self, "last_click_nav", False) or dt < 1.0):   # #3 URL change after an action -> suggestion
            h = self.cur.get("heading", "")
            s = self._new_step("suggest", desc=f"Auto-checkpoint: URL changed to {_short_url(url)}" + (f', heading "{h}" visible' if h else ""),
                               expected=f"{title} page opens", url=url,
                               loc={"assert": "url", "url": _short_url(url), "heading": h})
            self.add(s)
            self._shot(page, s)
        else:   # typed into the address bar / redirect without an action
            s = self._new_step("navigate", desc=f"Open {url}", expected=f"{title} page opens", url=url, loc={"url": url})
            self.add(s)
            self._shot(page, s)


# --------------------------------------------------------------------------- #
# Steps -> test cases (same structure as Gemini-generated cases)
# --------------------------------------------------------------------------- #
def _step_text(s: Dict[str, Any], params: Dict[str, Any]) -> str:
    d = s.get("desc", "")
    if s.get("param") and s.get("kind") in ("type", "select"):
        v = s.get("value", "")
        ph = "{{" + s["param"] + "}}"
        d = d.replace(f'"{v}"', ph, 1) if v and f'"{v}"' in d else d
    if s.get("note"):
        d += f"\nNote: {s['note']}"
    return d


def build_cases(setup: Dict[str, Any], steps: List[Dict[str, Any]], params: Dict[str, Any]):
    split = setup.get("split", "checkpoint") != "single"
    name0 = (setup.get("name") or "Recorded test").strip()
    groups: List[Dict[str, Any]] = []
    cur = {"name": name0, "steps": [], "ids": [], "cp": []}
    pending_name = ""

    def close():
        nonlocal cur, pending_name
        if cur["steps"]:
            groups.append(cur)
        cur = {"name": pending_name, "steps": [], "ids": [], "cp": []}
        pending_name = ""

    for s in steps:
        k = s.get("kind")
        if k in ("suggest", "ignored"):
            continue
        if k == "divider":
            pending_name = s.get("desc") or ""
            if cur["steps"]:
                close()
            else:
                cur["name"] = pending_name or cur["name"]
                pending_name = ""
            continue
        if k == "checkpoint":
            exp = (s.get("expected") or "").strip()
            cur["cp"].append(exp)
            cur["ids"].append(s["id"])
            if cur["steps"]:
                last = cur["steps"][-1]
                base = last["expected"]
                last["expected"] = exp if (not base or base in ("Value is entered",)) else f"{base}; {exp}"
                last["_cp"] = s["id"]
            else:
                cur["steps"].append({"description": f"Verify: {exp}", "expected": exp, "_sid": s["id"], "_cp": s["id"]})
            if split:
                close()
            continue
        cur["steps"].append({"description": _step_text(s, params), "expected": s.get("expected", ""), "_sid": s["id"]})
        cur["ids"].append(s["id"])
    if cur["steps"]:   # trailing actions after the last checkpoint become their own test case
        groups.append(cur)
    typ = setup.get("type") if setup.get("type") in TYPES else "Positive"
    pri = setup.get("priority") if setup.get("priority") in PRIOS else "Medium"
    data_line = ""
    if params:
        data_line = "Test data: " + "; ".join(f"{{{{{k}}}}} = {'(masked)' if v.get('masked') else v.get('value', '')}"
                                               for k, v in params.items())
    cases, n = [], len(groups)
    for i, g in enumerate(groups):
        nm = g["name"]
        if not nm:
            cp = g["cp"][0] if g["cp"] else ""
            nm = ("Verify " + cp[0].lower() + cp[1:]) if cp else f"{name0} (part {i + 1})"
        pre = [setup.get("precondition", "").strip()]
        if i > 0:
            pre.append(f"Continues from TC{i:03d} (same browser session).")
        if data_line:
            pre.append(data_line)
        desc = setup.get("description", "").strip() if i == 0 else ""
        desc = desc or (f"Recorded flow — part {i + 1} of {n}: {name0}." if n > 1 else f"Recorded flow: {name0}.")
        cases.append({"id": f"TC{i + 1:03d}", "name": nm[:200], "description": desc,
                      "precondition": "\n".join(p for p in pre if p), "steps": g["steps"], "priority": pri,
                      "type": typ, "acs": [], "status": "not", "_rec_ids": g["ids"],
                      "_sids": [x.get("_sid") for x in g["steps"]], "_cps": [x.get("_cp") for x in g["steps"]]})
    return cases


def summary_text(setup, steps) -> str:
    lines = [f"Recorded test: {setup.get('name', '')}", f"Target URL: {setup.get('url', '')}"]
    if setup.get("description"):
        lines.append(f"Description: {setup['description']}")
    lines.append("Recorded steps:")
    n = 0
    for s in steps:
        if s["kind"] in ("suggest", "ignored", "divider"):
            continue
        n += 1
        lines.append(f"{n}. {s['desc']}" + (f" → {s['expected']}" if s.get("expected") else ""))
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# #15 Script export
# --------------------------------------------------------------------------- #
def _q(s: str) -> str:
    return json.dumps(str(s or ""))


def _py_loc(l: Dict[str, Any]) -> str:
    if l.get("testid"):
        return f"page.get_by_test_id({_q(l['testid'])})"
    if l.get("label") and l.get("tag") in ("input", "select", "textarea"):
        return f"page.get_by_label({_q(l['label'])})"
    if l.get("role") in ("button", "link", "tab", "menuitem", "checkbox", "radio") and (l.get("text") or l.get("aria") or l.get("label")):
        return f"page.get_by_role({_q(l['role'])}, name={_q(l.get('aria') or l.get('text') or l.get('label'))})"
    if l.get("placeholder"):
        return f"page.get_by_placeholder({_q(l['placeholder'])})"
    if l.get("id"):
        return f"page.locator({_q('#' + l['id'])})"
    if l.get("text") and len(l["text"]) < 40:
        return f"page.get_by_text({_q(l['text'])}, exact=True)"
    return f"page.locator({_q(l.get('css') or l.get('tag') or 'body')})"


def _js_loc(l: Dict[str, Any]) -> str:
    p = _py_loc(l)
    p = p.replace("get_by_test_id", "getByTestId").replace("get_by_label", "getByLabel").replace("get_by_placeholder", "getByPlaceholder")
    p = re.sub(r"get_by_role\((\"[^\"]*\"), name=(.*)\)$", r"getByRole(\1, { name: \2 })", p)
    p = re.sub(r"get_by_text\((.*), exact=True\)$", r"getByText(\1, { exact: true })", p)
    return p


def _se_loc(l: Dict[str, Any]) -> str:
    if l.get("id"):
        return f"By.id({_q(l['id'])})"
    if l.get("nameAttr") and l.get("tag") in ("input", "select", "textarea"):
        return f"By.name({_q(l['nameAttr'])})"
    if l.get("testid"):
        return f"By.cssSelector({_q('[data-testid=' + chr(34) + l['testid'] + chr(34) + ']')})"
    if l.get("text") and len(l["text"]) < 40 and '"' not in l["text"] and "'" not in l["text"]:
        return f"By.xpath({_q('//' + (l.get('tag') or '*') + '[normalize-space()=' + chr(39) + l['text'] + chr(39) + ']')})"
    return f"By.cssSelector({_q(l.get('css') or l.get('tag') or 'body')})"


def _val(s, use_params, lang):
    if use_params and s.get("param"):
        return {"py": s["param"], "js": "data." + s["param"], "java": s["param"]}[lang]
    v = "***" if s.get("masked") else s.get("value", "")
    return _q(v)


def build_script(rec: Dict[str, Any], lang: str, assertions: bool = True, use_params: bool = True) -> Dict[str, str]:
    setup, steps, params = rec.get("setup", {}), rec.get("steps", []), rec.get("params", {})
    groups = rec.get("groups") or [{"name": setup.get("name", "Recorded test"), "ids": [s["id"] for s in steps]}]
    by = {s["id"]: s for s in steps}
    pnames = list(params.keys())
    slug = _slug(setup.get("name", "recorded_test"))
    out: List[str] = []
    seen: Dict[str, int] = {}

    def fname_of(name: str) -> str:   # unique per script (test names may repeat)
        b = _slug(name, 60)
        seen[b] = seen.get(b, 0) + 1
        return b if seen[b] == 1 else f"{b}_{seen[b]}"
    if lang == "py":
        out += ["import re", "from playwright.sync_api import Page, expect", "", ""]
        if use_params and params:
            out += ["# Test data recorded as {{parameters}} (masked values must be supplied by you)",
                    "TEST_DATA = {" + ", ".join(f"{_q(k)}: {_q('***' if v.get('masked') else v.get('value', ''))}" for k, v in params.items()) + "}", "", ""]
        for g in groups:
            sig = "page: Page"
            used = [by[i].get("param") for i in g["ids"] if i in by and by[i].get("param")] if use_params else []
            used = list(dict.fromkeys(used))
            sig += "".join(f", {p}=TEST_DATA[{_q(p)}]" for p in used)
            out.append(f"def test_{fname_of(g['name'])}({sig}):")
            body = []
            for i in g["ids"]:
                s = by.get(i)
                if not s:
                    continue
                l, k = s.get("loc") or {}, s["kind"]
                if s.get("note"):
                    body.append(f"# Note: {s['note']}")
                if k == "navigate":
                    body.append(f"page.goto({_q(l.get('url') or s.get('url'))})")
                elif k == "click":
                    body.append(f"{_py_loc(l)}.click()")
                elif k == "check":
                    body.append(f"{_py_loc(l)}.{'check' if l.get('checked') else 'uncheck'}()")
                elif k == "type":
                    body.append(f"{_py_loc(l)}.fill({_val(s, use_params, 'py')})")
                elif k == "select":
                    body.append(f"{_py_loc(l)}.select_option(label={_val(s, use_params, 'py')})")
                elif k == "scroll":
                    body.append(f"page.mouse.wheel(0, {int(l.get('y') or 0)})")
                elif k == "checkpoint":
                    body.append(f"# Checkpoint: {s.get('expected', '')}")
                    if assertions:
                        if l.get("assert") == "url" and l.get("url"):
                            body.append(f"expect(page).to_have_url(re.compile({_q(re.escape(l['url'].split('?')[0]))}))")
                        elif l.get("assert") == "heading" and l.get("heading"):
                            body.append(f"expect(page.get_by_role(\"heading\", name={_q(l['heading'])})).to_be_visible()")
                        elif l.get("assert") == "text" and l.get("text"):
                            if l.get("msg") or not l.get("css"):
                                body.append(f"expect(page.get_by_text({_q(l['text'])})).to_be_visible()")
                            else:
                                body.append(f"expect(page.locator({_q(l['css'])})).to_contain_text({_q(l['text'])})")
            out += ["    " + b for b in (body or ["pass"])] + ["", ""]
        fname = f"test_{slug}.py"
    elif lang == "js":
        out += ["// @ts-check", "const { test, expect } = require('@playwright/test');", ""]
        if use_params and params:
            out += ["// Test data recorded as {{parameters}} (masked values must be supplied by you)",
                    "const data = { " + ", ".join(f"{k}: {_q('***' if v.get('masked') else v.get('value', ''))}" for k, v in params.items()) + " };", ""]
        for g in groups:
            tn = fname_of(g["name"])
            title = g["name"] + (f" ({tn.rsplit('_', 1)[-1]})" if seen[_slug(g["name"], 60)] > 1 else "")
            out.append(f"test({_q(title)}, async ({{ page }}) => {{")
            for i in g["ids"]:
                s = by.get(i)
                if not s:
                    continue
                l, k = s.get("loc") or {}, s["kind"]
                loc = "await " + _js_loc(l)
                if s.get("note"):
                    out.append(f"  // Note: {s['note']}")
                if k == "navigate":
                    out.append(f"  await page.goto({_q(l.get('url') or s.get('url'))});")
                elif k == "click":
                    out.append(f"  {loc}.click();")
                elif k == "check":
                    out.append(f"  {loc}.{'check' if l.get('checked') else 'uncheck'}();")
                elif k == "type":
                    out.append(f"  {loc}.fill({_val(s, use_params, 'js')});")
                elif k == "select":
                    out.append(f"  {loc}.selectOption({{ label: {_val(s, use_params, 'js')} }});")
                elif k == "scroll":
                    out.append(f"  await page.mouse.wheel(0, {int(l.get('y') or 0)});")
                elif k == "checkpoint":
                    out.append(f"  // Checkpoint: {s.get('expected', '')}")
                    if assertions:
                        if l.get("assert") == "url" and l.get("url"):
                            out.append(f"  await expect(page).toHaveURL(new RegExp({_q(re.escape(l['url'].split('?')[0]))}));")
                        elif l.get("assert") == "heading" and l.get("heading"):
                            out.append(f"  await expect(page.getByRole('heading', {{ name: {_q(l['heading'])} }})).toBeVisible();")
                        elif l.get("assert") == "text" and l.get("text"):
                            if l.get("msg") or not l.get("css"):
                                out.append(f"  await expect(page.getByText({_q(l['text'])})).toBeVisible();")
                            else:
                                out.append(f"  await expect(page.locator({_q(l['css'])})).toContainText({_q(l['text'])});")
            out += ["});", ""]
        fname = f"{slug}.spec.js"
    elif lang == "java":
        cls = "".join(w.capitalize() for w in slug.split("_"))[:60] + "Test"
        out += ["import org.junit.jupiter.api.*;", "import org.openqa.selenium.*;", "import org.openqa.selenium.chrome.ChromeDriver;",
                "import org.openqa.selenium.support.ui.*;", "import java.time.Duration;", "", f"public class {cls} {{",
                "    WebDriver driver;", "    WebDriverWait wait;", ""]
        if use_params and params:
            out += ["    // Test data recorded as {{parameters}} (masked values must be supplied by you)"]
            out += [f"    String {k} = {_q('***' if v.get('masked') else v.get('value', ''))};" for k, v in params.items()]
            out.append("")
        out += ["    @BeforeEach void setUp() { driver = new ChromeDriver(); wait = new WebDriverWait(driver, Duration.ofSeconds(10)); }",
                "    @AfterEach void tearDown() { if (driver != null) driver.quit(); }", ""]
        for g in groups:
            mname = "".join(w.capitalize() if j else w for j, w in enumerate(fname_of(g["name"]).split("_")))
            out += [f"    @Test", f"    void {mname}() {{"]
            for i in g["ids"]:
                s = by.get(i)
                if not s:
                    continue
                l, k = s.get("loc") or {}, s["kind"]
                find = f"wait.until(ExpectedConditions.elementToBeClickable({_se_loc(l)}))"
                if s.get("note"):
                    out.append(f"        // Note: {s['note']}")
                if k == "navigate":
                    out.append(f"        driver.get({_q(l.get('url') or s.get('url'))});")
                elif k in ("click", "check"):
                    out.append(f"        {find}.click();")
                elif k == "type":
                    out.append(f"        {{ WebElement e = {find}; e.clear(); e.sendKeys({_val(s, use_params, 'java')}); }}")
                elif k == "select":
                    out.append(f"        new Select(driver.findElement({_se_loc(l)})).selectByVisibleText({_val(s, use_params, 'java')});")
                elif k == "scroll":
                    out.append(f"        ((JavascriptExecutor) driver).executeScript(\"window.scrollTo(0, {int(l.get('y') or 0)})\");")
                elif k == "checkpoint":
                    out.append(f"        // Checkpoint: {s.get('expected', '')}")
                    if assertions:
                        if l.get("assert") == "url" and l.get("url"):
                            out.append(f"        wait.until(ExpectedConditions.urlContains({_q(l['url'].split('?')[0])}));")
                        elif l.get("assert") == "heading" and l.get("heading"):
                            out.append(f"        Assertions.assertTrue(driver.findElement(By.xpath(\"//*[self::h1 or self::h2][normalize-space()='{l['heading']}']\")).isDisplayed());")
                        elif l.get("assert") == "text" and l.get("text"):
                            sel = "body" if l.get("msg") else (l.get("css") or "body")
                            out.append(f"        Assertions.assertTrue(driver.findElement(By.cssSelector({_q(sel)})).getText().contains({_q(l['text'])}));")
            out += ["    }", ""]
        out.append("}")
        fname = f"{cls}.java"
    else:
        raise ServiceError("Unknown script language.")
    return {"filename": fname, "script": "\n".join(out).rstrip() + "\n", "params": pnames}


# --------------------------------------------------------------------------- #
# B4 storage retention (per browser/history id). Default keep all; pinned never deleted.
# --------------------------------------------------------------------------- #
def load_settings(key: str) -> Dict[str, Any]:
    p = REC_DIR / key / "settings.json"
    d = {}
    try:
        d = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    except Exception:
        d = {}
    return {"keep_last": int(d.get("keep_last") or 0), "keep_days": int(d.get("keep_days") or 0),
            "pinned": [str(x) for x in d.get("pinned") or []]}


def save_settings(key: str, st: Dict[str, Any]):
    p = REC_DIR / key / "settings.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(st, indent=1), encoding="utf-8")


def rec_dirs(key: str) -> List[Path]:
    base = REC_DIR / key
    if not base.exists():
        return []
    ds = [d for d in base.iterdir() if d.is_dir() and re.match(r"^\d{8}_\d{6}_", d.name)]
    return sorted(ds, key=lambda d: d.name, reverse=True)   # rid starts with a timestamp -> newest first


def retention_cleanup(key: str, keep=None) -> List[str]:
    """Delete recordings beyond 'keep last N' / older than X days. Pinned, active and `keep` rids are never removed."""
    st = load_settings(key)
    n, days = st["keep_last"], st["keep_days"]
    if not n and not days:
        return []
    protect = set(st["pinned"]) | set(keep or [])
    act = REC.get(key)
    if act and not act.done.is_set():
        protect.add(act.rid)
    removed, kept = [], 0
    now = datetime.now()
    for d in rec_dirs(key):
        if d.name in protect:
            continue
        try:
            age = (now - datetime.strptime(d.name[:15], "%Y%m%d_%H%M%S")).days
        except ValueError:
            age = 0
        kept += 1
        if (n and kept > max(0, n - len([p for p in (keep or []) if (REC_DIR / key / p).exists()]))) or (days and age >= days):
            shutil.rmtree(d, ignore_errors=True)
            removed.append(d.name)
    if removed:
        log.info("rec retention removed %s", removed)
    return removed


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
def install(app, current, get_run, save, public_run, validate_cases, version_hooks=None, hcookie="atg_history"):
    router = APIRouter(prefix="/api/rec")
    if version_hooks is not None:
        version_hooks.append(("POST", re.compile(r"^/api/rec/(?:stop|draft/review)$"), "Recorded"))

    def key_of(sess) -> str:
        k = sess.get("hid") or sess.get("sid") or "anon"
        return re.sub(r"[^A-Za-z0-9_-]", "", str(k))[:64] or "anon"

    def active(sess, required=True) -> Optional[Recorder]:
        r = REC.get(key_of(sess))
        if required and not r:
            raise ServiceError("No recording in progress.", 404)
        return r

    def draft_path(sess) -> Path:
        return REC_DIR / key_of(sess) / "draft.json"

    def load_draft(sess) -> Optional[Dict[str, Any]]:
        p = draft_path(sess)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def clean_setup(d: Dict[str, Any]) -> Dict[str, Any]:
        url = str(d.get("url", "")).strip()
        if not url:
            raise ServiceError("Enter the target URL to record.")
        if not re.match(r"^(https?|file)://", url):
            url = "https://" + url
        name = str(d.get("name", "")).strip()
        if not name:
            raise ServiceError("Enter a test name.")
        ign = d.get("ignore")
        if isinstance(ign, str):
            ign = [x.strip() for x in re.split(r"[\n,]", ign) if x.strip()]
        return {"url": url[:2000], "name": name[:200], "description": str(d.get("description", ""))[:4000],
                "precondition": str(d.get("precondition", ""))[:4000],
                "type": d.get("type") if d.get("type") in TYPES else "Positive",
                "priority": d.get("priority") if d.get("priority") in PRIOS else "Medium",
                "split": "single" if d.get("split") == "single" else "checkpoint",
                "browser": "chromium", "video": bool(d.get("video", True)), "mask": bool(d.get("mask", True)),
                "ignore_hover": bool(d.get("ignore_hover", True)), "screenshots": bool(d.get("screenshots", True)),
                "ignore": [str(x)[:200] for x in (ign if isinstance(ign, list) else DEFAULT_IGNORE)][:40],
                "story_id": str(d.get("story_id", "")).strip()[:40]}

    def launch(sess, setup, steps=None, rid=None, elapsed0=0.0, params=None, url=None) -> Recorder:
        k = key_of(sess)
        with _LOCK:
            old = REC.get(k)
            if old and not old.done.is_set():
                raise ServiceError("A recording is already in progress.", 409)
            r = Recorder(k, setup, steps, rid, elapsed0, params)
            if url:
                r.cur["url"] = url
            REC[k] = r
        r.autosave()
        r.thread.start()
        for _ in range(150):   # wait until the page is open (or failed)
            if r.state not in ("starting",):
                break
            time.sleep(0.1)
        if r.state == "error":
            REC.pop(k, None)
            raise ServiceError(f"Could not start the recorder browser: {r.error}", 500)
        return r

    @router.get("/defaults")
    def rec_defaults(sess=Depends(current)):
        return {"ok": True, "ignore": DEFAULT_IGNORE, "display": bool(os.environ.get("DISPLAY")) and not os.environ.get("ATG_REC_HEADLESS")}

    @router.post("/start")
    def rec_start(data: Dict[str, Any] = Body(...), sess=Depends(current)):
        setup = clean_setup(data)
        r = launch(sess, setup)
        return {"ok": True, **r.public()}

    @router.get("/status")
    def rec_status(sess=Depends(current)):
        r = active(sess, False)
        if not r:
            return {"ok": True, "state": "none"}
        return {"ok": True, **r.public()}

    @router.post("/cmd")
    def rec_cmd(data: Dict[str, Any] = Body(...), sess=Depends(current)):
        r = active(sess)
        c = str(data.get("cmd", ""))
        if c not in ("pause", "resume", "checkpoint", "undo") and not (c == "_test" and os.environ.get("ATG_REC_TEST_HOOK")):
            raise ServiceError("Unknown command.")
        evt = threading.Event()
        r.cmds.put({"cmd": c, "evt": evt, "action": data.get("action"), "expected": str(data.get("expected", ""))[:300], "assert": data.get("assert") or "",
                    "text": str(data.get("text", ""))[:200], "css": str(data.get("css", ""))[:300]})
        evt.wait(timeout=40 if c == "_test" else 10)
        time.sleep(0.05)
        return {"ok": True, **r.public()}

    def mutate(sess, fn):
        r = active(sess)
        with r.lock:
            res = fn(r)
        r.autosave()
        return {"ok": True, **r.public(), **(res or {})}

    @router.patch("/steps/{sid}")
    def rec_patch(sid: str, data: Dict[str, Any] = Body(...), sess=Depends(current)):
        def f(r):
            s = r.find(sid)
            if not s:
                raise ServiceError("Step not found.", 404)
            for k in ("desc", "expected", "note"):
                if k in data:
                    s[k] = str(data[k])[:1000]
            if s["kind"] == "checkpoint" and "expected" in data:   # keep the checkpoint label in sync
                s["desc"] = f"✔ Expected: {s['expected']}"
            if "param" in data:   # #4 mark value as test data
                p = _slug(str(data.get("param") or ""), 30) if data.get("param") else ""
                old = s.get("param")
                s["param"] = p
                if old and old != p and not any(x.get("param") == old for x in r.steps if x is not s):
                    r.params.pop(old, None)
                if p:
                    r.params[p] = {"value": s.get("value", ""), "masked": bool(s.get("masked"))}
        return mutate(sess, f)

    @router.delete("/steps/{sid}")
    def rec_delete(sid: str, sess=Depends(current)):
        def f(r):
            s = r.find(sid)
            if not s:
                raise ServiceError("Step not found.", 404)
            r.steps.remove(s)
        return mutate(sess, f)

    @router.post("/reorder")
    def rec_reorder(data: Dict[str, Any] = Body(...), sess=Depends(current)):
        def f(r):
            ids = [str(i) for i in data.get("ids") or []]
            by = {s["id"]: s for s in r.steps}
            if sorted(ids) != sorted(by):
                raise ServiceError("Step list changed — reload and try again.", 409)
            r.steps[:] = [by[i] for i in ids]
        return mutate(sess, f)

    @router.post("/undo")
    def rec_undo(sess=Depends(current)):
        return rec_cmd({"cmd": "undo"}, sess)

    @router.post("/divider")
    def rec_divider(data: Dict[str, Any] = Body(...), sess=Depends(current)):
        """#7 start a new test case here (after step `after`, or at the end)."""
        def f(r):
            nm = str(data.get("name", "")).strip()[:200]
            d = r._new_step("divider", desc=nm)
            after = data.get("after")
            ix = next((i for i, s in enumerate(r.steps) if s["id"] == after), None)
            if ix is None:
                r.steps.append(d)
            else:
                r.steps.insert(ix + 1, d)
        return mutate(sess, f)

    @router.post("/suggest/{sid}/{act}")
    def rec_suggest(sid: str, act: str, data: Dict[str, Any] = Body(default={}), sess=Depends(current)):
        def f(r):
            s = r.find(sid)
            if not s or s["kind"] not in ("suggest", "ignored"):
                raise ServiceError("Suggestion not found.", 404)
            if act == "accept" and s["kind"] == "suggest":
                exp = str(data.get("expected") or s["expected"])[:300]
                s.update({"kind": "checkpoint", "desc": f"✔ Expected: {exp}", "expected": exp})
            elif act == "keep" and s["kind"] == "ignored":   # #14 keep a skipped (ignore-listed) click
                s.update({"kind": "click", "desc": f'Click "{s.get("name") or "element"}"'})
            elif act in ("dismiss", "drop"):
                r.steps.remove(s)
            else:
                raise ServiceError("Unknown action.")
        return mutate(sess, f)

    def finish(sess, setup, steps, params, rid, video, elapsed):
        cases = build_cases(setup, steps, params)
        for c in cases:   # one implicit acceptance criterion: the recorded flow (keeps coverage / RTM meaningful)
            c["acs"] = ["AC-01"]
        if not cases:
            raise ServiceError("Nothing was recorded yet — perform at least one action in the recorder window.")
        groups = [{"name": c["name"], "ids": c.pop("_rec_ids"), "sids": c.pop("_sids"), "cps": c.pop("_cps")} for c in cases]
        from . import parsing, session_store, history_store   # local import keeps module load light
        clean = parsing.sanitize_cases(cases)
        validate_cases(clean)
        run = get_run(sess)
        name = (setup.get("name") or "").strip().lower()
        same = run.get("source") == "record" and ((run.get("recording") or {}).get("setup") or {}).get("name", "").strip().lower() == name
        prev_snap = None
        if not same:
            # B3: re-recording a test with the same name -> new version of that recording (same run in history)
            hid = sess.get("hid")
            for e in history_store.list_items(hid) if hid else []:
                if e.get("kind") != "batch" and ((e.get("rec") or {}).get("name") or "").strip().lower() == name:
                    prev_snap = history_store.load_run(hid, e["run_id"])
                    break
            if run.get("test_cases") and sess.get("mode") != "batch":   # never overwrite a different saved run
                save(sess, history=True)
                session_store.reset_run(sess["sid"])
                run = get_run(sess)
            if prev_snap:
                run["run_id"], run["rid"] = prev_snap["run_id"], prev_snap.get("rid")
        old = (run.get("recording") if same else (prev_snap or {}).get("recording")) or None
        previous = list((old or {}).get("previous") or [])
        if old and old.get("rid") != rid:
            previous.append({"rid": old.get("rid"), "created": old.get("created"), "duration": old.get("duration"),
                             "name": (old.get("setup") or {}).get("name"),
                             "steps": [{"kind": x.get("kind"), "desc": x.get("desc"), "expected": x.get("expected")}
                                       for x in old.get("steps", []) if x.get("kind") not in ("suggest", "ignored")]})
        previous = previous[-10:]
        meta = {"rid": rid, "setup": setup, "steps": steps, "params": params, "groups": groups,
                "case_ids": [c["id"] for c in clean], "case_names": [c["name"] for c in clean],
                "video": video, "duration": round(elapsed, 1), "created": _now(), "previous": previous,
                "version": len(previous) + 1,
                "n_steps": sum(1 for s in steps if s["kind"] not in ("suggest", "ignored", "divider", "checkpoint")),
                "n_checkpoints": sum(1 for s in steps if s["kind"] == "checkpoint"),
                "n_errors": sum(len(s.get("errors") or []) for s in steps)}
        run.update({"source": "record", "story_id": setup.get("story_id") or run.get("story_id") or "",
                    "feature_text": summary_text(setup, steps), "jira": None, "local_filename": "",
                    "imported": False, "import_info": None, "markdown": "", "test_cases": clean, "dirty": True,
                    "excel_path": "", "review": None, "upload": None, "rtm": [],
                    "ac_list": [{"id": "AC-01", "title": f"Recorded flow: {setup.get('name', '')}"[:80],
                                 "text": summary_text(setup, steps)}],
                    "recording": meta})
        save(sess, history=True)
        try:
            retention_cleanup(key_of(sess), keep={rid})
        except Exception:
            log.exception("retention cleanup failed (ignored)")
        return {"ok": True, "count": len(clean), "run": public_run(run), "rerecorded": bool(previous)}

    @router.post("/stop")
    def rec_stop(sess=Depends(current)):
        r = active(sess)
        r.done.set()
        r.thread.join(timeout=30)
        REC.pop(key_of(sess), None)
        res = finish(sess, r.setup, r.steps, r.params, r.rid, r.video, r.elapsed())
        try:
            draft_path(sess).unlink()
        except FileNotFoundError:
            pass
        return res

    @router.post("/discard")
    def rec_discard(sess=Depends(current)):
        r = active(sess, False)
        if r:
            r.done.set()
            r.thread.join(timeout=30)
            REC.pop(key_of(sess), None)
        try:
            draft_path(sess).unlink()
        except FileNotFoundError:
            pass
        return {"ok": True}

    # #13 drafts
    @router.get("/draft")
    def rec_draft(sess=Depends(current)):
        r = active(sess, False)
        if r and not r.done.is_set():
            return {"ok": True, "draft": None, "active": True}
        d = load_draft(sess)
        if not d or not d.get("steps"):
            return {"ok": True, "draft": None}
        st = d["steps"]
        return {"ok": True, "draft": {"rid": d.get("rid"), "name": d["setup"].get("name"), "url": d["setup"].get("url"),
                                      "steps": sum(1 for s in st if s["kind"] not in ("suggest", "ignored", "divider", "checkpoint")),
                                      "checkpoints": sum(1 for s in st if s["kind"] == "checkpoint"),
                                      "saved_at": d.get("saved_at"), "video": bool(d.get("video")),
                                      "video_wanted": bool(d["setup"].get("video"))}}

    @router.delete("/draft")
    def rec_draft_delete(sess=Depends(current)):
        return rec_discard(sess)

    @router.post("/draft/resume")
    def rec_draft_resume(sess=Depends(current)):
        d = load_draft(sess)
        if not d:
            raise ServiceError("No draft to resume.", 404)
        r = launch(sess, d["setup"], d["steps"], d.get("rid"), float(d.get("elapsed") or 0), d.get("params") or {},
                   url=d.get("last_url") or d["setup"].get("url"))
        if d.get("video"):
            r.video_segments.append(d["video"])
            r.video = d["video"]
        return {"ok": True, **r.public()}

    @router.post("/draft/review")
    def rec_draft_review(sess=Depends(current)):
        d = load_draft(sess)
        if not d:
            raise ServiceError("No draft to open.", 404)
        res = finish(sess, d["setup"], d["steps"], d.get("params") or {}, d.get("rid"), d.get("video") or "",
                     float(d.get("elapsed") or 0))
        draft_path(sess).unlink(missing_ok=True)
        return res

    # ---------------------------------------------------------------- B4 retention / pin
    @router.get("/storage")
    def rec_storage(sess=Depends(current)):
        k = key_of(sess)
        st = load_settings(k)
        dirs = rec_dirs(k)
        size = sum(f.stat().st_size for d in dirs for f in d.rglob("*") if f.is_file())
        return {"ok": True, **st, "count": len(dirs), "mb": round(size / 1048576, 1), "rids": [d.name for d in dirs]}

    @router.put("/storage")
    def rec_storage_put(data: Dict[str, Any] = Body(...), sess=Depends(current)):
        k = key_of(sess)
        st = load_settings(k)
        for f in ("keep_last", "keep_days"):
            if f in data:
                try:
                    st[f] = max(0, min(10000, int(data[f] or 0)))
                except (TypeError, ValueError):
                    raise ServiceError(f"{f} must be a number (0 = keep all).")
        save_settings(k, st)
        removed = retention_cleanup(k, keep=set()) if data.get("apply") else []
        return {"ok": True, **st, "removed": removed}

    @router.post("/pin")
    def rec_pin(data: Dict[str, Any] = Body(...), sess=Depends(current)):
        k = key_of(sess)
        rid = str(data.get("rid", ""))
        if not re.match(r"^[\w-]+$", rid):
            raise ServiceError("Bad recording id.")
        st = load_settings(k)
        pins = set(st["pinned"])
        (pins.add if data.get("pinned", True) else pins.discard)(rid)
        st["pinned"] = sorted(pins)
        save_settings(k, st)
        return {"ok": True, **st}

    def rec_of(sess, run_id: str = ""):
        run = get_run(sess)
        if run_id and run_id != run.get("run_id"):
            from . import history_store
            snap = history_store.load_run(sess.get("hid"), run_id)
            if not snap:
                raise ServiceError("This run is no longer in history.", 404)
            run = snap
        rec = run.get("recording")
        if not rec:
            raise ServiceError("This run was not created from a recording.", 400)
        return run, rec

    # ---------------------------------------------------------------- B5 zip export
    @router.get("/zip")
    def rec_zip(run_id: str = "", sess=Depends(current)):
        import io
        import zipfile
        run, rec = rec_of(sess, run_id)
        base = REC_DIR / key_of(sess) / rec["rid"]
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("steps.json", json.dumps({k: v for k, v in rec.items() if k != "previous"}, indent=1, ensure_ascii=False))
            z.writestr("test_cases.json", json.dumps(run.get("test_cases") or [], indent=1, ensure_ascii=False))
            for lang in ("py", "js", "java"):
                sc = build_script(rec, lang)
                z.writestr("scripts/" + sc["filename"], sc["script"])
            missing = []
            if rec.get("video"):
                vp = base / rec["video"]
                z.write(vp, "video/" + rec["video"]) if vp.exists() else missing.append(rec["video"])
            for s in rec.get("steps", []):
                if s.get("shot"):
                    sp = base / "shots" / s["shot"]
                    z.write(sp, "screenshots/" + s["shot"]) if sp.exists() else missing.append(s["shot"])
            if missing:
                z.writestr("MISSING_FILES.txt", "Removed by storage retention:\n" + "\n".join(missing))
        fn = f"recording_{_slug((rec.get('setup') or {}).get('name', ''), 40)}_{rec['rid']}.zip"
        return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{fn}"'})

    # ---------------------------------------------------------------- B3 compare with a previous recording
    @router.get("/compare")
    def rec_compare(rid: str = "", sess=Depends(current)):
        import difflib
        run, rec = rec_of(sess)
        prev = next((p for p in rec.get("previous", []) if p.get("rid") == rid), None) or (rec.get("previous") or [None])[-1]
        if not prev:
            raise ServiceError("There is no earlier recording of this test.", 404)
        line = lambda x: x.get("desc") or ""
        a = [line(x) for x in prev["steps"]]
        b = [line(x) for x in rec["steps"] if x.get("kind") not in ("suggest", "ignored")]
        rows = []
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
            if op == "equal":
                rows += [{"op": "same", "old": a[i], "new": a[i]} for i in range(i1, i2)]
            elif op == "replace":
                m = min(i2 - i1, j2 - j1)
                rows += [{"op": "changed", "old": a[i1 + k], "new": b[j1 + k]} for k in range(m)]
                rows += [{"op": "removed", "old": a[i], "new": ""} for i in range(i1 + m, i2)]
                rows += [{"op": "added", "old": "", "new": b[j]} for j in range(j1 + m, j2)]
            elif op == "delete":
                rows += [{"op": "removed", "old": a[i], "new": ""} for i in range(i1, i2)]
            else:
                rows += [{"op": "added", "old": "", "new": b[j]} for j in range(j1, j2)]
        return {"ok": True, "old": {k: prev.get(k) for k in ("rid", "created", "duration")}, "new": {"rid": rec["rid"], "created": rec.get("created")},
                "rows": rows, "summary": {o: sum(r["op"] == o for r in rows) for o in ("same", "changed", "added", "removed")},
                "previous": [{k: p.get(k) for k in ("rid", "created", "duration")} for p in rec.get("previous", [])]}

    @router.get("/file/{rid}/{name}")
    def rec_file(rid: str, name: str, sess=Depends(current)):
        if not re.match(r"^[\w-]+$", rid) or not re.match(r"^[\w.-]+\.(jpg|webm)$", name):
            raise ServiceError("Bad file name.", 400)
        base = REC_DIR / key_of(sess) / rid
        p = base / ("shots" if name.endswith(".jpg") else "") / name
        if not p.exists():
            raise ServiceError("File not found.", 404)
        return FileResponse(str(p), media_type="image/jpeg" if name.endswith(".jpg") else "video/webm",
                            filename=name if name.endswith(".webm") else None)

    @router.post("/script")
    def rec_script(data: Dict[str, Any] = Body(...), sess=Depends(current)):
        run = get_run(sess)
        rec = run.get("recording")
        if not rec:
            raise ServiceError("This run was not created from a recording.", 400)
        return {"ok": True, **build_script(rec, str(data.get("lang", "py")), bool(data.get("assertions", True)),
                                           bool(data.get("params", True)))}

    @router.patch("/evidence")
    def rec_evidence(data: Dict[str, Any] = Body(...), sess=Depends(current)):
        """#11 'Attach to test case as evidence': adds the step's errors to the case precondition-free notes (description)."""
        run = get_run(sess)
        rec = run.get("recording") or {}
        s = next((x for x in rec.get("steps", []) if x["id"] == data.get("step")), None)
        if not s or not s.get("errors"):
            raise ServiceError("No errors on that step.", 404)
        g = next((g for g in rec.get("groups", []) if s["id"] in g["ids"]), None)
        ci = rec.get("groups", []).index(g) if g else 0
        cases = run.get("test_cases") or []
        if ci >= len(cases):
            raise ServiceError("Test case not found.", 404)
        line = "Evidence (recorded): " + " | ".join(e["text"] for e in s["errors"])
        if line not in cases[ci]["description"]:
            cases[ci]["description"] = (cases[ci]["description"] + "\n" + line).strip()
        run["dirty"] = True
        save(sess, history=True)
        return {"ok": True, "case": cases[ci]["id"], "run": public_run(run)}

    app.include_router(router)
