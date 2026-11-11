"""Test Runs (cycles + executions + attachments). Additive feature.

Storage: SQLite tables cycles, cycle_items, executions in backend/app.db (same dict shape as the leftover backend/test_repo/runs.json backup).
Attachments: backend/attachments/<32-hex>.<ext> (max 50 MB each), served by /api/attachments/{name}
with a strict filename pattern + resolved-path check.
"""
import base64
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Body
from fastapi.responses import FileResponse

from . import test_repo
from .services import ServiceError
from .test_repo import _s, locked, load_json, now, write_json

RUNS_FILE = test_repo.DATA_DIR / "runs.json"
ATT_DIR = Path(__file__).resolve().parent / "attachments"
ATT_MAX = 50 * 1024 * 1024
ATT_EXT = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "mp4", "webm", "mov", "ogg", "txt", "log", "pdf"}
ATT_RE = re.compile(r"^[0-9a-f]{32}\.[a-z0-9]{1,5}$")
STEP_ST = ["", "Pass", "Fail", "Blocked", "N/A"]
RUN_ST = ["Not run", "Pass", "Fail", "Blocked", "Skipped", "Retest"]
CYCLE_FIELDS = ("name", "description", "release", "sprint", "build", "env", "start", "end", "assignee", "owner")
router = APIRouter()


def _save(d):
    from .db import save_runs
    save_runs(d)


def _load():
    from .db import load_runs
    d = load_runs()
    for k, v in (("seq", 0), ("eseq", 0), ("cycles", []), ("executions", [])):
        d.setdefault(k, v)
    return d


def derive(step_statuses: List[str]) -> str:
    st = [s for s in step_statuses]
    if any(s == "Fail" for s in st):
        return "Fail"
    if any(s == "Blocked" for s in st):
        return "Blocked"
    if st and all(s in ("Pass", "N/A") for s in st):
        return "Pass"
    return "Not run"  # partially executed (or nothing executed yet)


def _cyc(d, cid):
    c = next((x for x in d["cycles"] if x["id"] == cid), None)
    if not c:
        raise ServiceError("Cycle not found.", 404)
    return c


def _norm(n: str) -> str:
    """Compare cycle names leniently: any dash (– — -) / whitespace / case differences are ignored."""
    return re.sub(r"\s+", " ", re.sub(r"[\u2010-\u2015\u2212-]", "-", str(n or ""))).strip().lower()


def _counts(c):
    out = {k: 0 for k in RUN_ST}
    for it in c.get("items", []) or []:
        out[it.get("status", "Not run")] = out.get(it.get("status", "Not run"), 0) + 1
    return out


def _pub(c, repo=None):
    r = dict(c)
    r["counts"] = _counts(c)
    if repo is not None:
        byid = {x["id"]: x for x in repo["cases"]}
        r["items"] = [{**it, "title": byid.get(it["case_id"], {}).get("title", "(deleted from repo)"),
                       "priority": byid.get(it["case_id"], {}).get("priority", ""),
                       "repo_status": byid.get(it["case_id"], {}).get("status", ""),
                       "story": byid.get(it["case_id"], {}).get("story", ""),
                       "case_state": "removed" if it["case_id"] not in byid else ("archived" if byid[it["case_id"]].get("status") == "Archived" else "")}
                      for it in sorted(c.get("items", []), key=lambda i: i.get("order", 0))]
    return r


def _clean_cycle(data, base=None):
    c = dict(base or {})
    for k in CYCLE_FIELDS:
        if k in data or not base:
            c[k] = _s(data.get(k), 2000 if k == "description" else 200)
    if not c.get("name"):
        raise ServiceError("Cycle name is required.")
    return c


def create_cycle(data, case_ids=None, source="") -> Dict[str, Any]:
    with locked(RUNS_FILE):
        d = _load()
        c = _clean_cycle(data)
        d["seq"] += 1
        c.update({"id": f"CY-{d['seq']:04d}", "status": "Active", "created": now(), "source": source, "items": []})
        _add_items(c, case_ids or [], c.get("assignee", ""))
        d["cycles"].append(c)
        _save(d)
    return c


def _add_items(c, case_ids, assignee=""):
    have = {i["case_id"] for i in c["items"]}
    n = 0
    for cid in case_ids:
        if cid in have:
            continue
        have.add(cid)
        c["items"].append({"key": uuid.uuid4().hex[:10], "case_id": cid, "order": len(c["items"]) + 1, "assignee": assignee,
                           "status": "Not run", "last_run": "", "defects": [], "executions": []})
        n += 1
    return n


def executions_for(case_id: str) -> List[Dict[str, Any]]:
    d = _load()
    names = {c["id"]: c["name"] for c in d["cycles"]}
    ex = [{**e, "cycle_name": names.get(e["cycle_id"], "(deleted cycle)")} for e in d["executions"] if e["case_id"] == case_id]
    return sorted(ex, key=lambda e: e["ts"], reverse=True)


def items_for(case_id: str) -> List[Dict[str, Any]]:
    """Active cycles that contain this case (used by the case preview 'Run now')."""
    d = _load()
    out = []
    for c in d["cycles"]:
        if c.get("status") == "Archived":
            continue
        for it in c.get("items", []):
            if it["case_id"] == case_id:
                out.append({"cycle_id": c["id"], "cycle_name": c.get("name", ""), "key": it["key"], "status": it.get("status", ""),
                            "created": c.get("created", "")})
    return sorted(out, key=lambda x: x["created"], reverse=True)


# ------------------------------------------------------------------ cycles
@router.get("/api/runs")
def runs_list(archived: int = 0):
    d = _load()
    cs = [_pub(c) for c in d["cycles"] if archived or c.get("status") != "Archived"]
    for c in cs:
        c.pop("items", None)
    return {"ok": True, "cycles": sorted(cs, key=lambda c: c.get("created", ""), reverse=True)}


@router.post("/api/runs")
def runs_create(data: Dict[str, Any] = Body(...)):
    return {"ok": True, "cycle": create_cycle(data, data.get("case_ids") or [])}


@router.get("/api/runs/{cid}")
def runs_get(cid: str):
    d = _load()
    return {"ok": True, "cycle": _pub(_cyc(d, cid), test_repo._load())}


@router.put("/api/runs/{cid}")
def runs_update(cid: str, data: Dict[str, Any] = Body(...)):
    with locked(RUNS_FILE):
        d = _load()
        c = _cyc(d, cid)
        c.update(_clean_cycle(data, c))
        _save(d)
    return {"ok": True, "cycle": _pub(c)}


@router.post("/api/runs/{cid}/clone")
def runs_clone(cid: str):
    c = _cyc(_load(), cid)
    nc = create_cycle({**{k: c.get(k, "") for k in ("description", "release", "sprint", "build", "env", "start", "end", "assignee", "owner")},
                       "name": c["name"] + " (copy)"}, [i["case_id"] for i in sorted(c["items"], key=lambda i: i["order"])])
    return {"ok": True, "cycle": nc}


@router.post("/api/runs/{cid}/archive")
def runs_archive(cid: str, data: Dict[str, Any] = Body(default={})):
    with locked(RUNS_FILE):
        d = _load()
        c = _cyc(d, cid)
        c["status"] = "Active" if data.get("restore") else "Archived"
        _save(d)
    return {"ok": True}


@router.delete("/api/runs/{cid}")
def runs_delete(cid: str, confirm: str = ""):
    with locked(RUNS_FILE):
        d = _load()
        c = _cyc(d, cid)
        if _norm(confirm) != _norm(c.get("name", "")):
            raise ServiceError("Type the cycle name exactly to confirm deletion.")
        d["cycles"] = [x for x in d["cycles"] if x["id"] != cid]
        d["executions"] = [e for e in d["executions"] if e["cycle_id"] != cid]
        _save(d)
    return {"ok": True}


@router.post("/api/runs/{cid}/items")
def runs_add_items(cid: str, data: Dict[str, Any] = Body(...)):
    repo_ids = {c["id"] for c in test_repo._load()["cases"] if c.get("status") != "Archived"}
    with locked(RUNS_FILE):
        d = _load()
        c = _cyc(d, cid)
        n = _add_items(c, [x for x in data.get("case_ids") or [] if x in repo_ids], _s(data.get("assignee")) or c.get("assignee", ""))
        _save(d)
    return {"ok": True, "added": n}


@router.post("/api/runs/{cid}/items/bulk")
def runs_items_bulk(cid: str, data: Dict[str, Any] = Body(...)):
    keys = set(data.get("keys") or [])
    op = data.get("op")
    with locked(RUNS_FILE):
        d = _load()
        c = _cyc(d, cid)
        if op == "remove":
            c["items"] = [i for i in c["items"] if i["key"] not in keys]
        elif op == "assign":
            for i in c["items"]:
                if i["key"] in keys:
                    i["assignee"] = _s(data.get("assignee"), 100)
        elif op == "status":
            if data.get("status") not in RUN_ST:
                raise ServiceError("Unknown status.")
            for i in c["items"]:
                if i["key"] in keys:
                    i["status"] = data["status"]
        elif op == "reorder":
            order = data.get("order") or []
            pos = {k: n for n, k in enumerate(order)}
            c["items"].sort(key=lambda i: pos.get(i["key"], 10 ** 6 + i["order"]))
        else:
            raise ServiceError("Unknown action.")
        for n, i in enumerate(sorted(c["items"], key=lambda i: i["order"]) if op != "reorder" else c["items"], 1):
            i["order"] = n
        _save(d)
    return {"ok": True}


# ------------------------------------------------------------------ execution
@router.get("/api/runs/{cid}/items/{key}")
def runs_item(cid: str, key: str):
    d = _load()
    c = _cyc(d, cid)
    it = next((i for i in c["items"] if i["key"] == key), None)
    if not it:
        raise ServiceError("Case not in this cycle.", 404)
    case = test_repo.get_case(it["case_id"])
    hist = [e for e in d["executions"] if e["case_id"] == it["case_id"]]
    hist.sort(key=lambda e: e["ts"], reverse=True)
    names = {x["id"]: x["name"] for x in d["cycles"]}
    for e in hist:
        e["cycle_name"] = names.get(e["cycle_id"], "")
    return {"ok": True, "item": it, "case": case, "history": hist}


@router.post("/api/runs/{cid}/items/{key}/execute")
def runs_execute(cid: str, key: str, data: Dict[str, Any] = Body(...)):
    case = None
    with locked(RUNS_FILE):
        d = _load()
        c = _cyc(d, cid)
        it = next((i for i in c["items"] if i["key"] == key), None)
        if not it:
            raise ServiceError("Case not in this cycle.", 404)
        case = test_repo.get_case(it["case_id"])
        if not case:
            raise ServiceError("This case was removed from the repo – remove it from the cycle.", 409)
        if case.get("status") == "Archived":
            raise ServiceError("This case is archived – restore it in the repo to execute it.", 409)
        steps = []
        for s in (data.get("steps") or [])[:200]:
            st = s.get("status") if s.get("status") in STEP_ST else ""
            atts = [a for a in (s.get("attachments") or []) if isinstance(a, dict) and ATT_RE.match(str(a.get("name", "")))]
            steps.append({"status": st, "actual": _s(s.get("actual")), "attachments": [
                {"name": a["name"], "orig": _s(a.get("orig"), 200), "mime": _s(a.get("mime"), 80), "size": int(a.get("size") or 0)} for a in atts]})
        auto = derive([s["status"] for s in steps])
        override = data.get("override") if data.get("override") in RUN_ST else ""
        reason = _s(data.get("reason"), 1000)
        if override and override != auto and not reason:
            raise ServiceError("A reason is required when overriding the auto status.")
        final = override or auto
        d["eseq"] += 1
        ex = {"id": f"EX-{d['eseq']:05d}", "cycle_id": cid, "item_key": key, "case_id": it["case_id"],
              "case_version": case.get("version", 1), "ts": now(), "tester": _s(data.get("tester"), 100) or it.get("assignee", ""),
              "steps": steps, "auto_status": auto, "status": final, "override_reason": reason if override else "",
              "comments": _s(data.get("comments")), "duration": int(data.get("duration") or 0),
              "defects": [_s(x, 40) for x in (data.get("defects") or []) if _s(x)][:20],
              "build": c.get("build", ""), "env": c.get("env", "")}
        d["executions"].append(ex)
        it["status"], it["last_run"] = final, ex["ts"]
        it["executions"].append(ex["id"])
        it["defects"] = sorted(set(it.get("defects", []) + ex["defects"]))
        _save(d)
    if final != "Not run":
        test_repo.set_last_result(it["case_id"], final)
    test_repo.log_event(it["case_id"], "ran", c.get("name", ""), ex.get("tester", ""), result=final, exec_id=ex["id"], cycle_id=cid)
    return {"ok": True, "execution": ex}


# ------------------------------------------------------------------ quick run from Review
@router.post("/api/runs/quick")
def runs_quick(data: Dict[str, Any] = Body(...)):
    story = _s(data.get("story"), 60)
    cases = [test_repo.from_review_case(tc, story) for tc in data.get("test_cases") or []]
    if not cases:
        raise ServiceError("No test cases to run.")
    # new cases -> Draft; changed matches -> new version (status kept); identical matches -> reused as-is
    saved = test_repo.save_many(cases, story=story, story_title=_s(data.get("story_title"), 80), status="Draft",
                                source="Record" if data.get("source") == "record" else "AI", note="Saved by Execute now",
                                update_status=False)
    ids = saved["ids"]
    if data.get("cycle_id"):
        runs_add_items(data["cycle_id"], {"case_ids": ids, "assignee": data.get("assignee", "")})
        cyc = _cyc(_load(), data["cycle_id"])
    else:
        name = _s(data.get("name"), 200) or f"Quick run – {story or 'Local'} – {datetime.now().strftime('%d-%b-%Y')}"
        cyc = create_cycle({"name": name, "build": data.get("build"), "env": data.get("env"), "assignee": data.get("assignee"),
                            "description": f"Created from Review ({_s(data.get('rid'), 60)})"}, ids, source="review")
    return {"ok": True, "cycle": _pub(cyc), "saved": saved}


# ------------------------------------------------------------------ attachments
@router.post("/api/attachments")
def att_upload(data: Dict[str, Any] = Body(...)):
    orig = _s(data.get("filename"), 200) or "file"
    ext = (orig.rsplit(".", 1)[-1] if "." in orig else "").lower()
    mime = _s(data.get("mime"), 80)
    if ext not in ATT_EXT:
        ext = {"image/png": "png", "image/jpeg": "jpg", "video/webm": "webm", "video/mp4": "mp4"}.get(mime, "")
    if ext not in ATT_EXT:
        raise ServiceError("Unsupported file type. Upload an image, video, log or PDF.")
    b64 = str(data.get("data", "")).split(",")[-1]
    if len(b64) > ATT_MAX * 4 // 3 + 16:
        raise ServiceError("Attachment is larger than 50 MB.", 413)
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise ServiceError("Could not read the attachment.")
    if not raw:
        raise ServiceError("The attachment is empty.")
    if len(raw) > ATT_MAX:
        raise ServiceError("Attachment is larger than 50 MB.", 413)
    ATT_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    (ATT_DIR / name).write_bytes(raw)
    return {"ok": True, "attachment": {"name": name, "orig": orig, "mime": mime, "size": len(raw)}}


def _att_path(name: str) -> Path:
    if not ATT_RE.match(name or ""):
        raise ServiceError("Invalid attachment name.", 400)
    p = (ATT_DIR / name).resolve()
    if p.parent != ATT_DIR.resolve() or not p.is_file():
        raise ServiceError("Attachment not found.", 404)
    return p


@router.get("/api/attachments/{name}")
def att_get(name: str):
    return FileResponse(_att_path(name))


@router.delete("/api/attachments/{name}")
def att_delete(name: str):
    _att_path(name).unlink()
    return {"ok": True}
