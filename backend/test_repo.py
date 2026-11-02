"""Test Case Repository (additive feature).

Storage: backend/test_repo/repo.json  {"seq": int, "fseq": int, "folders": [...], "cases": [...]}
Writes are atomic (tmp + replace) under a thread lock + an fcntl file lock (same pattern as history_store).
Routes are mounted by app.py with the session dependency (include_router(..., dependencies=[Depends(current)])).
"""
import contextlib
import csv
import difflib
import io
import json
import logging
import os
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body

from . import excel_io, token_usage
from .services import ServiceError

log = logging.getLogger("atg.repo")
DATA_DIR = Path(__file__).resolve().parent / "test_repo"
REPO_FILE = DATA_DIR / "repo.json"
_LOCK = threading.RLock()
STATUSES = ["Draft", "Ready", "Obsolete"]
SOURCES = ["AI", "Manual", "Record"]
router = APIRouter()


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


@contextlib.contextmanager
def locked(path: Path):
    """Thread lock + advisory file lock so two server processes don't interleave writes."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        fh = open(str(path) + ".lock", "w")
        try:
            try:
                import fcntl
                fcntl.flock(fh, fcntl.LOCK_EX)
            except Exception:
                pass
            yield
        finally:
            fh.close()


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _load() -> Dict[str, Any]:
    d = load_json(REPO_FILE, {})
    d.setdefault("seq", 0); d.setdefault("fseq", 0); d.setdefault("folders", []); d.setdefault("cases", [])
    return d


def _s(v, n=5000) -> str:
    return str(v if v is not None else "").strip()[:n]


def _steps(raw) -> List[Dict[str, str]]:
    out = []
    for s in raw or []:
        if not isinstance(s, dict):
            continue
        st = {"step": _s(s.get("step", s.get("description", ""))), "expected": _s(s.get("expected")),
              "data": _s(s.get("data"))}
        if st["step"] or st["expected"] or st["data"]:
            out.append(st)
    return out


CONTENT_KEYS = ("title", "description", "precondition", "priority", "type", "steps")


def _content(c) -> Dict[str, Any]:
    return {k: c.get(k) for k in CONTENT_KEYS}


def _clean_case(data: Dict[str, Any]) -> Dict[str, Any]:
    tags = data.get("tags")
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]
    return {"title": _s(data.get("title", data.get("name")), 300), "description": _s(data.get("description")),
            "precondition": _s(data.get("precondition")), "priority": _s(data.get("priority") or "Medium", 30),
            "type": _s(data.get("type"), 30), "story": _s(data.get("story"), 60),
            "tags": [_s(t, 40) for t in (tags or []) if _s(t)][:20], "steps": _steps(data.get("steps")),
            "acs": [_s(a, 20) for a in (data.get("acs") or []) if _s(a)][:30]}


# ------------------------------------------------------------------ folders
def _folder(d, fid):
    return next((f for f in d["folders"] if f["id"] == fid), None)


def _ensure_folder(d, name: str, parent: str = "") -> str:
    name = _s(name, 120) or "Unfiled"
    f = next((f for f in d["folders"] if f["name"].lower() == name.lower() and f.get("parent", "") == parent), None)
    if f:
        return f["id"]
    d["fseq"] += 1
    fid = f"F{d['fseq']}"
    d["folders"].append({"id": fid, "name": name, "parent": parent})
    return fid


def project_of(story: str) -> str:
    m = re.match(r"^([A-Za-z][A-Za-z0-9]*)-\d+", story or "")
    return m.group(1).upper() if m else "Local"


def default_folder(d, story: str, story_title: str = "") -> str:
    pid = _ensure_folder(d, project_of(story))
    sname = (story or "Unfiled") + (f" · {story_title[:60]}" if story_title else "")
    existing = next((f for f in d["folders"] if f.get("parent") == pid and story and f["name"].split(" · ")[0] == story), None)
    return existing["id"] if existing else _ensure_folder(d, sname, pid)


def _folder_path(d, fid) -> str:
    parts, f, guard = [], _folder(d, fid), 0
    while f and guard < 10:
        parts.insert(0, f["name"]); f = _folder(d, f.get("parent", "")); guard += 1
    return " / ".join(parts)


def _desc_ids(d, fid) -> List[str]:
    out, todo = [], [fid]
    while todo:
        x = todo.pop(); out.append(x)
        todo += [f["id"] for f in d["folders"] if f.get("parent") == x]
    return out


# ------------------------------------------------------------------ cases
def _new_case(d, data, source="Manual", status="Draft", folder_id="", note="Created") -> Dict[str, Any]:
    c = _clean_case(data)
    if not c["title"]:
        raise ServiceError("Title is required.")
    d["seq"] += 1
    ts = now()
    c.update({"id": f"TC-{d['seq']:04d}", "status": status if status in STATUSES else "Draft",
              "source": source if source in SOURCES else "Manual", "folder_id": folder_id or default_folder(d, c["story"]),
              "version": 1, "created": ts, "updated": ts, "last_result": "", "last_run": ""})
    c["versions"] = [{"version": 1, "ts": ts, "note": note, "snapshot": _content(c)}]
    d["cases"].append(c)
    return c


def _update_case(c, data, note="Edited") -> bool:
    """Apply edits; bump version when test content changed. Returns True if a new version was created."""
    n = _clean_case({**c, **data})
    changed = _content(n) != _content(c)
    for k in ("title", "description", "precondition", "priority", "type", "story", "tags", "steps", "acs"):
        c[k] = n[k]
    if data.get("status") in STATUSES:
        c["status"] = data["status"]
    if data.get("folder_id"):
        c["folder_id"] = str(data["folder_id"])
    c["updated"] = now()
    if changed:
        c["version"] = int(c.get("version", 1)) + 1
        c.setdefault("versions", []).append({"version": c["version"], "ts": c["updated"], "note": note, "snapshot": _content(c)})
    return changed


def _summary(c) -> Dict[str, Any]:
    r = {k: v for k, v in c.items() if k != "versions"}
    r["versions_count"] = len(c.get("versions") or [])
    return r


def get_case(cid: str) -> Optional[Dict[str, Any]]:
    return next((c for c in _load()["cases"] if c["id"] == cid), None)


def set_last_result(cid: str, result: str) -> None:
    with locked(REPO_FILE):
        d = _load()
        c = next((x for x in d["cases"] if x["id"] == cid), None)
        if c:
            c["last_result"], c["last_run"] = result, now()
            write_json(REPO_FILE, d)


def _text(c) -> str:
    return " ".join([c.get("title", "")] + [s.get("step", "") + " " + s.get("expected", "") for s in c.get("steps") or []]).lower()


def _match(d, case) -> Optional[Dict[str, Any]]:
    best, score = None, 0.0
    t1, title = _text(case), (case.get("title") or "").lower()
    story = (case.get("story") or "").strip().lower()
    for c in d["cases"]:
        if c.get("status") == "Obsolete":
            continue
        if story and (c.get("story") or "").strip().lower() != story:
            continue  # duplicates are checked within the same story
        s = 0.5 * difflib.SequenceMatcher(None, title, c["title"].lower()).ratio() + \
            0.5 * difflib.SequenceMatcher(None, t1, _text(c)).ratio()
        if s > score:
            best, score = c, s
    if best and score >= 0.8:
        cc = _clean_case(case)
        identical = cc["title"].lower() == best["title"].lower() and cc["steps"] == best["steps"] and \
            cc["description"] == best["description"] and cc["precondition"] == best["precondition"]
        return {"id": best["id"], "title": best["title"], "version": best["version"], "score": round(score * 100),
                "identical": bool(identical)}
    return None


def from_review_case(tc: Dict[str, Any], story: str) -> Dict[str, Any]:
    return {"title": tc.get("name", ""), "description": tc.get("description", ""), "precondition": tc.get("precondition", ""),
            "priority": tc.get("priority") or "Medium", "type": tc.get("type", ""), "story": story,
            "acs": tc.get("acs") or [], "ref": tc.get("id", ""),
            "steps": [{"step": s.get("description", ""), "expected": s.get("expected", "")} for s in tc.get("steps") or []]}


def save_many(cases: List[Dict[str, Any]], *, story="", story_title="", folder_id="", status="Draft", tags=None,
              source="AI", actions: Optional[Dict[str, str]] = None, note="", update_status=True) -> Dict[str, Any]:
    """actions: {index: 'update'|'new'|'skip'}; default = update when a match exists, else new."""
    actions = actions or {}
    res = {"created": [], "updated": [], "skipped": [], "ids": []}
    with locked(REPO_FILE):
        d = _load()
        fid = folder_id if folder_id and _folder(d, folder_id) else default_folder(d, story, story_title)
        for i, raw in enumerate(cases):
            data = {**raw, "story": raw.get("story") or story}
            if tags:
                data["tags"] = sorted(set((data.get("tags") or []) + list(tags)))
            m = _match(d, data)
            act = actions.get(str(i)) or ("update" if m and not m["identical"] else ("skip" if m else "new"))
            if act == "skip" and m:
                res["skipped"].append(m["id"]); res["ids"].append(m["id"]); continue
            if act == "update" and m:
                c = next(x for x in d["cases"] if x["id"] == m["id"])
                _update_case(c, {**data, "folder_id": fid, **({"status": status} if update_status else {})}, note or "Updated from Review")
                res["updated"].append(c["id"]); res["ids"].append(c["id"]); continue
            c = _new_case(d, data, source, status, fid, note or "Created from Review")
            res["created"].append(c["id"]); res["ids"].append(c["id"])
        write_json(REPO_FILE, d)
    return res


def _tree(d) -> List[Dict[str, Any]]:
    out = []
    for f in d["folders"]:
        ids = set(_desc_ids(d, f["id"]))
        cs = [c for c in d["cases"] if c.get("folder_id") in ids]
        out.append({**f, "count": len(cs), "ready": sum(1 for c in cs if c["status"] == "Ready"), "path": _folder_path(d, f["id"])})
    return out


# ------------------------------------------------------------------ routes
@router.get("/api/repo")
def repo_list():
    d = _load()
    return {"ok": True, "folders": _tree(d), "cases": [_summary(c) for c in d["cases"]], "total": len(d["cases"])}


@router.get("/api/repo/cases/{cid}")
def repo_case(cid: str):
    d = _load()
    c = next((x for x in d["cases"] if x["id"] == cid), None)
    if not c:
        raise ServiceError("Test case not found.", 404)
    from . import test_runs
    return {"ok": True, "case": {**c, "folder_path": _folder_path(d, c.get("folder_id"))}, "executions": test_runs.executions_for(cid)}


@router.post("/api/repo/cases")
def repo_create(data: Dict[str, Any] = Body(...)):
    with locked(REPO_FILE):
        d = _load()
        fid = data.get("folder_id") if _folder(d, data.get("folder_id", "")) else ""
        if not fid and data.get("folder_path"):
            parts = [p.strip() for p in str(data["folder_path"]).split("/") if p.strip()]
            for p in parts:
                fid = _ensure_folder(d, p, fid)
        c = _new_case(d, data, data.get("source") or "Manual", data.get("status") or "Draft", fid)
        write_json(REPO_FILE, d)
    return {"ok": True, "case": c}


@router.put("/api/repo/cases/{cid}")
def repo_update(cid: str, data: Dict[str, Any] = Body(...)):
    with locked(REPO_FILE):
        d = _load()
        c = next((x for x in d["cases"] if x["id"] == cid), None)
        if not c:
            raise ServiceError("Test case not found.", 404)
        if data.get("folder_path") and not data.get("folder_id"):
            fid = ""
            for p in [p.strip() for p in str(data["folder_path"]).split("/") if p.strip()]:
                fid = _ensure_folder(d, p, fid)
            data["folder_id"] = fid
        if not _s(data.get("title", c["title"])):
            raise ServiceError("Title is required.")
        newv = _update_case(c, data, _s(data.get("note"), 200) or "Edited")
        write_json(REPO_FILE, d)
    return {"ok": True, "case": c, "new_version": newv}


@router.post("/api/repo/bulk")
def repo_bulk(data: Dict[str, Any] = Body(...)):
    ids = set(data.get("ids") or [])
    op = data.get("op")
    with locked(REPO_FILE):
        d = _load()
        n = 0
        if op == "delete":
            before = len(d["cases"]); d["cases"] = [c for c in d["cases"] if c["id"] not in ids]; n = before - len(d["cases"])
        elif op in ("status", "move"):
            if op == "status" and data.get("status") not in STATUSES:
                raise ServiceError("Unknown status.")
            if op == "move" and not _folder(d, data.get("folder_id", "")):
                raise ServiceError("Choose a folder.")
            for c in d["cases"]:
                if c["id"] in ids:
                    c["status" if op == "status" else "folder_id"] = data["status" if op == "status" else "folder_id"]
                    c["updated"] = now(); n += 1
        else:
            raise ServiceError("Unknown bulk action.")
        write_json(REPO_FILE, d)
    return {"ok": True, "count": n}


@router.post("/api/repo/folders")
def repo_folder(data: Dict[str, Any] = Body(...)):
    name = _s(data.get("name"), 120)
    if not name:
        raise ServiceError("Folder name is required.")
    with locked(REPO_FILE):
        d = _load()
        parent = data.get("parent") if _folder(d, data.get("parent", "")) else ""
        fid = _ensure_folder(d, name, parent)
        write_json(REPO_FILE, d)
    return {"ok": True, "id": fid, "folders": _tree(d)}


@router.post("/api/repo/check")
def repo_check(data: Dict[str, Any] = Body(...)):
    """Duplicate check of Review cases vs. repo + default folder suggestion (read-only)."""
    story = _s(data.get("story"), 60)
    d = _load()
    cases = [from_review_case(tc, story) for tc in data.get("test_cases") or []]
    sugg = next((f for f in d["folders"] if story and f["name"].split(" · ")[0] == story and f.get("parent")), None)
    return {"ok": True, "matches": [_match(d, c) for c in cases], "folders": _tree(d),
            "suggest": {"folder_id": sugg["id"] if sugg else "", "project": project_of(story),
                        "story_folder": (story or "Unfiled") + (f" · {_s(data.get('story_title'), 60)}" if data.get("story_title") else "")}}


@router.post("/api/repo/save_review")
def repo_save_review(data: Dict[str, Any] = Body(...)):
    story = _s(data.get("story"), 60)
    cases = [from_review_case(tc, story) for tc in data.get("test_cases") or []]
    if not cases:
        raise ServiceError("No test cases to save.")
    fid = data.get("folder_id") or ""
    if data.get("new_folder"):
        with locked(REPO_FILE):
            d = _load(); fid = _ensure_folder(d, data["new_folder"], data.get("new_folder_parent") or _ensure_folder(d, project_of(story))); write_json(REPO_FILE, d)
    res = save_many(cases, story=story, story_title=_s(data.get("story_title"), 80), folder_id=fid,
                    status=data.get("status") or "Draft", tags=[_s(t, 40) for t in data.get("tags") or [] if _s(t)],
                    source="Record" if data.get("source") == "record" else "AI", actions=data.get("actions") or {})
    return {"ok": True, **res}


# ------------------------------------------------------------------ import
IMPORT_MAX = 10 * 1024 * 1024


def _csv_to_xlsx(raw: bytes) -> bytes:
    import openpyxl
    text = raw.decode("utf-8-sig", errors="replace")
    wb = openpyxl.Workbook(); ws = wb.active
    for row in csv.reader(io.StringIO(text)):
        ws.append(row)
    b = io.BytesIO(); wb.save(b)
    return b.getvalue()


@router.post("/api/repo/import")
def repo_import(data: Dict[str, Any] = Body(...)):
    import base64
    name = _s(data.get("filename"), 200).lower()
    try:
        raw = base64.b64decode(str(data.get("data", "")).split(",")[-1])
    except Exception:
        raise ServiceError("Could not read the uploaded file.")
    if len(raw) > IMPORT_MAX:
        raise ServiceError("File is larger than 10 MB.")
    story = _s(data.get("story"), 60)
    if name.endswith(".json"):
        try:
            items = json.loads(raw.decode("utf-8-sig"))
        except Exception:
            raise ServiceError("Not valid JSON.")
        items = items.get("cases", items) if isinstance(items, dict) else items
        cases = [{**_clean_case(x), "story": _s(x.get("story")) or story} for x in items if isinstance(x, dict)]
        warnings = []
    elif name.endswith(".csv") or name.endswith(".xlsx"):
        parsed = excel_io.parse_workbook(_csv_to_xlsx(raw) if name.endswith(".csv") else raw)
        cases = [from_review_case(tc, story) for tc in parsed["cases"]]
        warnings = parsed.get("warnings") or []
    else:
        raise ServiceError("Upload a .xlsx, .csv (app template columns) or .json file.")
    cases = [c for c in cases if _s(c.get("title"))]
    if not cases:
        raise ServiceError("No test cases found in the file.")
    acts = {str(i): "new" for i in range(len(cases))} if data.get("as_new") else {}
    res = save_many(cases, story=story, folder_id=data.get("folder_id") or "", status=data.get("status") or "Draft",
                    source="Manual", actions=acts, note="Imported from " + (data.get("filename") or "file"))
    return {"ok": True, "warnings": warnings[:50], **res}


# ------------------------------------------------------------------ AI review
AI_SYSTEM = """You are a senior QA reviewer. Review ONE manual test case against the acceptance criteria.
Return ONLY JSON: {"coverage": 0-100, "ac": [{"id": "AC-1", "title": "...", "covered": true}],
"summary": "short", "suggestions": [{"kind": "Title|Description|Precondition|Clarify expected|Vague wording|Missing step|Test data",
"title": "short reason", "field": "title|description|precondition|step", "step": <1-based step index or null>,
"part": "step|expected|data" (for step fields), "op": "replace|add", "before": "old text", "after": "new text",
"new_step": {"step": "...", "expected": "...", "data": ""} (only for op=add)}]}. Max 8 suggestions."""


def _mock_review(case: Dict[str, Any], acs_text: str) -> Dict[str, Any]:
    steps = case.get("steps") or []
    sug = []
    t = case.get("title", "")
    if t and not t.lower().startswith("verify user can"):
        sug.append({"kind": "Title", "title": "Make title outcome-specific", "field": "title", "op": "replace",
                    "before": t, "after": "Verify user can " + re.sub(r"^verify\s+", "", t, flags=re.I)})
    if steps:
        e = steps[-1].get("expected", "")
        sug.append({"kind": "Clarify expected", "title": f"Step {len(steps)} expected result is vague", "field": "step",
                    "step": len(steps), "part": "expected", "op": "replace", "before": e,
                    "after": (e or "Result") + " – confirmation message shown and value persists after reload"})
        s1 = steps[0].get("step", "")
        sug.append({"kind": "Vague wording", "title": "Step 1: say exactly how to start", "field": "step", "step": 1,
                    "part": "step", "op": "replace", "before": s1, "after": "From the home page, " + (s1[:1].lower() + s1[1:] if s1 else "open the page")})
    sug.append({"kind": "Missing step", "title": "Add a negative step for invalid input", "field": "step", "step": None,
                "op": "add", "before": "", "after": "Enter invalid input and submit → inline validation error shown",
                "new_step": {"step": "Enter invalid input and submit", "expected": "Inline validation error is shown; nothing is saved", "data": "12ab"}})
    sug.append({"kind": "Test data", "title": "Precondition should state the starting data", "field": "precondition", "op": "replace",
                "before": case.get("precondition", ""), "after": (case.get("precondition") or "User is logged in.") + " Test data prepared in QA."})
    acs = [a.strip() for a in acs_text.splitlines() if a.strip()][:6] or ["AC-1 Main flow", "AC-2 Error handling", "AC-3 Validation"]
    ac = [{"id": f"AC-{i + 1}", "title": re.sub(r"^AC[-\s]?\d+[:.)\s-]*", "", a, flags=re.I)[:80], "covered": i < max(1, len(acs) - 1)} for i, a in enumerate(acs)]
    cov = round(100 * sum(1 for a in ac if a["covered"]) / len(ac))
    return {"coverage": cov, "ac": ac, "summary": f"{len(sug)} suggestions (mock reviewer)", "suggestions": sug}


def ai_review(case: Dict[str, Any], acs_text: str) -> Dict[str, Any]:
    from . import services
    case = _clean_case(case)
    content = (f"Acceptance criteria / story notes:\n{acs_text or '(none given – infer from the test case)'}\n\n"
               f"Test case (JSON):\n{json.dumps({k: case[k] for k in ('title', 'description', 'precondition', 'priority', 'steps')}, ensure_ascii=False)}")
    usage: Dict[str, Any] = {"model": "gemini"}
    if os.environ.get("ATG_MOCK_GEMINI") == "1":
        out = _mock_review(case, acs_text)
        txt = json.dumps(out)
        usage.update({"mock": True, "model_name": "mock", "input_tokens": len(content) // 4 + 300,
                      "output_tokens": len(txt) // 4, "total_tokens": len(content) // 4 + 300 + len(txt) // 4})
    else:
        g = services._gemini_module()
        usage["model_name"] = g.gemini_model
        try:
            resp = g.client.models.generate_content(
                model=g.gemini_model, contents=content,
                config=g.types.GenerateContentConfig(system_instruction=AI_SYSTEM, temperature=0.3,
                                                     response_mime_type="application/json"))
        except Exception as ex:
            raise ServiceError(f"Gemini review error: {ex}", 502)
        um = getattr(resp, "usage_metadata", None)
        usage.update({"input_tokens": getattr(um, "prompt_token_count", 0) or 0,
                      "output_tokens": getattr(um, "candidates_token_count", 0) or 0,
                      "total_tokens": getattr(um, "total_token_count", 0) or 0})
        try:
            data, today = g.get_today_quota()
            today["requests_used"] = today.get("requests_used", 0) + 1
            today["tokens_used"] = today.get("tokens_used", 0) + usage["total_tokens"]
            g.save_quota(data)
        except Exception:
            pass
        txt = getattr(resp, "text", "") or ""
        try:
            out = json.loads(re.sub(r"^```(json)?|```$", "", txt.strip()).strip())
        except Exception:
            raise ServiceError("The AI reviewer returned an unreadable answer. Try again.", 502)
    sugs = []
    for i, s in enumerate((out.get("suggestions") or [])[:12]):
        if isinstance(s, dict) and (s.get("after") or s.get("new_step")):
            s["id"] = f"S{i + 1}"; sugs.append(s)
    out["suggestions"] = sugs
    try:
        out["coverage"] = max(0, min(100, int(out.get("coverage") or 0)))
    except Exception:
        out["coverage"] = 0
    token_usage.record(action="AI review (repo)", usage=usage, run={"story_id": case.get("story") or "", "jira": {"summary": case.get("title")}, "source": "repo"}, mode="repo")
    return {**out, "usage": usage}


@router.post("/api/repo/ai_review")
def repo_ai_review(data: Dict[str, Any] = Body(...)):
    case = data.get("case") or {}
    if not _s(case.get("title")) and not case.get("steps"):
        raise ServiceError("Add a title or steps before asking the AI to review.")
    return {"ok": True, "review": ai_review(case, _s(data.get("acs"), 8000))}
