"""Test Case Repository (additive feature).

Storage: SQLite tables repo_folders + cases in backend/app.db
(same dict shape as the leftover backend/test_repo/repo.json backup).
Writes use a thread lock plus a SQLite transaction. Routes are mounted by
app.py with the session dependency (include_router(..., dependencies=[Depends(current)])).
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
STATUSES = ["Draft", "Ready", "Obsolete", "Archived"]
SOURCES = ["AI", "Manual", "Record"]
router = APIRouter()


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


@contextlib.contextmanager
def locked(path=None):
    """Thread lock around a read-modify-write. SQLite transactions provide write atomicity."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        yield


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


def _save(d: Dict[str, Any]) -> None:
    from .db import save_repo
    save_repo(d)


def _load() -> Dict[str, Any]:
    from .db import load_repo
    d = load_repo()
    d.setdefault("seq", 0); d.setdefault("fseq", 0); d.setdefault("folders", []); d.setdefault("cases", [])
    d["fver"] = 2
    return d


def _migrate(d) -> None:
    """v1 -> v2: folders become first-class records (id, name, parent, order, description);
    cases pointing at a missing folder get one rebuilt from their story key, so nothing is lost."""
    for i, f in enumerate(d["folders"]):
        f.setdefault("parent", f.get("parent_id", "") or "")
        f.setdefault("order", i + 1)
        f.setdefault("description", "")
    ids = {f["id"] for f in d["folders"]}
    for c in d["cases"]:
        if c.get("folder_id") not in ids:
            c["folder_id"] = default_folder(d, c.get("story", ""))
            ids.add(c["folder_id"])
    d["fver"] = 2


def _s(v, n=5000) -> str:
    return str(v if v is not None else "").strip()[:n]


def _steps(raw) -> List[Dict[str, str]]:
    out = []
    for s in raw or []:
        if not isinstance(s, dict):
            continue
        st = {"step": _s(s.get("step", s.get("description", ""))), "expected": _s(s.get("expected")),
              "data": _s(s.get("data"))}
        td = s.get("test_data")
        if isinstance(td, dict):
            st["test_data"] = td
            if not st["data"]:
                try:
                    from .testdata import format_test_data
                    st["data"] = format_test_data(td)
                except Exception:
                    pass
        if st["step"] or st["expected"] or st["data"]:
            out.append(st)
    return out


CONTENT_KEYS = ("title", "description", "precondition", "priority", "type", "steps")


def _content(c) -> Dict[str, Any]:
    return {k: c.get(k) for k in CONTENT_KEYS}


ACT_MAX = 500


def _event(c, typ: str, text: str = "", by: str = "", **meta) -> None:
    """Append an audit event to the case record (new field, lazily created on old cases)."""
    ev = {"ts": now(), "type": typ, "text": _s(text, 500), "by": _s(by, 100)}
    ev.update({k: v for k, v in meta.items() if v not in (None, "")})
    act = c.setdefault("activity", [])
    act.append(ev)
    if len(act) > ACT_MAX:
        del act[:len(act) - ACT_MAX]


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
    order = max([x.get("order", 0) for x in d["folders"] if x.get("parent", "") == parent] or [0]) + 1
    d["folders"].append({"id": fid, "name": name, "parent": parent, "order": order, "description": ""})
    return fid


def _norm_name(n: str) -> str:
    return re.sub(r"\s+", " ", (n or "").strip()).lower()


def _dup_name(d, name, parent, exclude="") -> bool:
    return any(f["id"] != exclude and f.get("parent", "") == parent and _norm_name(f["name"]) == _norm_name(name) for f in d["folders"])


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
    c["activity"], c["comments"], c["attachments"] = [], [], []
    _event(c, "created", note, _s(data.get("by"), 100), version=1, source=c["source"])
    d["cases"].append(c)
    return c


def _update_case(c, data, note="Edited") -> bool:
    """Apply edits; bump version when test content changed. Returns True if a new version was created."""
    n = _clean_case({**c, **data})
    changed = _content(n) != _content(c)
    by = _s(data.get("by"), 100)
    old_status, old_folder = c.get("status"), c.get("folder_id")
    for k in ("title", "description", "precondition", "priority", "type", "story", "tags", "steps", "acs"):
        c[k] = n[k]
    if data.get("status") in STATUSES:
        c["status"] = data["status"]
    if data.get("folder_id"):
        c["folder_id"] = str(data["folder_id"])
    c["updated"] = now()
    if changed:
        if data.get("autosave"):
            # Persist live fields without minting a version on every debounce tick.
            # The next manual Save still bumps the version as usual.
            pass
        else:
            c["version"] = int(c.get("version", 1)) + 1
            c.setdefault("versions", []).append({"version": c["version"], "ts": c["updated"], "note": note, "snapshot": _content(c)})
            _event(c, _s(data.get("event_type"), 20) or "edited", note, by, version=c["version"])
    if c.get("status") != old_status:
        _event(c, "status", f"{old_status} → {c['status']}", by, old=old_status, new=c["status"])
    if c.get("folder_id") != old_folder:
        _event(c, "moved", "Moved to another folder", by, folder_id=c.get("folder_id"))
    return changed and not data.get("autosave")


def _summary(c) -> Dict[str, Any]:
    r = {k: v for k, v in c.items() if k not in ("versions", "activity", "comments")}
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
            _save(d)


def _text(c) -> str:
    return " ".join([c.get("title", "")] + [s.get("step", "") + " " + s.get("expected", "") for s in c.get("steps") or []]).lower()


def _match(d, case) -> Optional[Dict[str, Any]]:
    best, score = None, 0.0
    t1, title = _text(case), (case.get("title") or "").lower()
    story = (case.get("story") or "").strip().lower()
    for c in d["cases"]:
        if c.get("status") in ("Obsolete", "Archived"):
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


def _review_step(s: Dict[str, Any]) -> Dict[str, Any]:
    td = s.get("test_data") if isinstance(s.get("test_data"), dict) else None
    data = str(s.get("data") or "").strip()
    if not data and td:
        try:
            from .testdata import format_test_data
            data = format_test_data(td)
        except Exception:
            data = ""
    out = {"step": s.get("description", ""), "expected": s.get("expected", ""), "data": data}
    if td:
        out["test_data"] = td
    return out


def from_review_case(tc: Dict[str, Any], story: str) -> Dict[str, Any]:
    return {"title": tc.get("name", ""), "description": tc.get("description", ""), "precondition": tc.get("precondition", ""),
            "priority": tc.get("priority") or "Medium", "type": tc.get("type", ""), "story": story,
            "acs": tc.get("acs") or [], "ref": tc.get("id", ""),
            "steps": [_review_step(s) for s in tc.get("steps") or []]}


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
        _save(d)
    return res


def _tree(d) -> List[Dict[str, Any]]:
    out = []
    for f in sorted(d["folders"], key=lambda x: (x.get("order", 0), x["name"].lower())):
        ids = set(_desc_ids(d, f["id"]))
        cs = [c for c in d["cases"] if c.get("folder_id") in ids and c.get("status") != "Archived"]
        out.append({**f, "parent_id": f.get("parent", ""), "count": len(cs), "ready": sum(1 for c in cs if c["status"] == "Ready"),
                    "archived": sum(1 for c in d["cases"] if c.get("folder_id") in ids and c.get("status") == "Archived"),
                    "path": _folder_path(d, f["id"])})
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
    ex = test_runs.executions_for(cid)
    return {"ok": True, "case": {**c, "folder_path": _folder_path(d, c.get("folder_id")), "comments": c.get("comments") or [],
                                 "attachments": c.get("attachments") or []},
            "executions": ex, "activity": _activity(c, ex), "cycles": test_runs.items_for(cid),
            "jira_base": _jira_base()}


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
        _save(d)
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
        _save(d)
    return {"ok": True, "case": c, "new_version": newv}


@router.post("/api/repo/bulk")
def repo_bulk(data: Dict[str, Any] = Body(...)):
    ids = set(data.get("ids") or [])
    op = data.get("op")
    with locked(REPO_FILE):
        d = _load()
        n = 0
        archived = []
        if op == "delete":
            # cases with execution history / cycle membership are archived, never deleted (keeps cycle results intact)
            used = _usage(ids)
            keep = []
            for c in d["cases"]:
                if c["id"] in ids and used.get(c["id"], {}).get("in_use"):
                    c["status"], c["updated"] = "Archived", now(); archived.append(c["id"]); keep.append(c)
                    _event(c, "archived", "Archived (delete requested; case has execution history)", _s(data.get("by"), 100))
                elif c["id"] in ids:
                    n += 1
                else:
                    keep.append(c)
            d["cases"] = keep
        elif op in ("archive", "restore"):
            for c in d["cases"]:
                if c["id"] in ids and (op == "archive" or c.get("status") == "Archived"):
                    c["status"] = "Archived" if op == "archive" else "Draft"; c["updated"] = now(); n += 1
                    _event(c, "archived" if op == "archive" else "restored", "Archived" if op == "archive" else "Restored (as Draft)", _s(data.get("by"), 100))
        elif op in ("status", "move"):
            if op == "status" and data.get("status") not in STATUSES:
                raise ServiceError("Unknown status.")
            if op == "move" and not _folder(d, data.get("folder_id", "")):
                raise ServiceError("Choose a folder.")
            for c in d["cases"]:
                if c["id"] in ids:
                    if op == "status" and c.get("status") != data["status"]:
                        _event(c, "status", f"{c.get('status')} → {data['status']}", _s(data.get("by"), 100), old=c.get("status"), new=data["status"])
                    if op == "move" and c.get("folder_id") != data["folder_id"]:
                        _event(c, "moved", "Moved to " + _folder_path(d, data["folder_id"]), _s(data.get("by"), 100), folder_id=data["folder_id"])
                    c["status" if op == "status" else "folder_id"] = data["status" if op == "status" else "folder_id"]
                    c["updated"] = now(); n += 1
        else:
            raise ServiceError("Unknown bulk action.")
        _save(d)
    return {"ok": True, "count": n, "archived": archived}


@router.post("/api/repo/folders")
def repo_folder(data: Dict[str, Any] = Body(...)):
    name = _s(data.get("name"), 120)
    if not name:
        raise ServiceError("Folder name is required.")
    with locked(REPO_FILE):
        d = _load()
        parent = data.get("parent") if _folder(d, data.get("parent", "")) else ""
        if _dup_name(d, name, parent):
            raise ServiceError(f"A folder named “{name}” already exists there. Choose another name.", 409)
        fid = _ensure_folder(d, name, parent)
        _folder(d, fid)["description"] = _s(data.get("description"), 1000)
        _save(d)
    return {"ok": True, "id": fid, "folders": _tree(d)}


@router.post("/api/repo/check")
def repo_check(data: Dict[str, Any] = Body(...)):
    """Duplicate check of Review cases vs. repo + default folder suggestion (read-only)."""
    story = _s(data.get("story"), 60)
    d = _load()
    cases = [from_review_case(tc, story) for tc in data.get("test_cases") or []]
    sugg = next((f for f in d["folders"] if story and f["name"].split(" · ")[0] == story and f.get("parent")), None)
    # a missing default folder is only *suggested* here ("(new) Project › Story"); it is created on save
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
            d = _load(); fid = _ensure_folder(d, data["new_folder"], data.get("new_folder_parent") or _ensure_folder(d, project_of(story))); _save(d)
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


# ------------------------------------------------------------------ export
EXPORT_HEADERS = ["Test Case ID", "Test Case Name", "Folder Path", "Priority", "Case Status", "Version", "Source", "Story",
                  "Test Case Description", "Precondition", "Last Result", "Updated", "Step No", "Step Description",
                  "Expected Result", "Test Data"]


def _export_rows(d, cases) -> List[List[Any]]:
    """One row per step; case fields only on the first row (re-importable through /api/repo/import)."""
    rows = []
    for c in cases:
        head = [c.get("id", ""), c.get("title", ""), _folder_path(d, c.get("folder_id", "")), c.get("priority", ""),
                c.get("status", ""), c.get("version", ""), c.get("source", ""), c.get("story", ""),
                c.get("description", ""), c.get("precondition", ""), c.get("last_result", "") or "", c.get("updated", "")]
        steps = c.get("steps") or [{}]
        for i, st in enumerate(steps, 1):
            rows.append((head if i == 1 else [""] * len(head)) +
                        [i if st else "", st.get("step", ""), st.get("expected", ""), st.get("data", "")])
    return rows


@router.post("/api/repo/export")
def repo_export(data: Dict[str, Any] = Body(...)):
    from fastapi.responses import Response
    fmt = "csv" if str(data.get("format", "xlsx")).lower() == "csv" else "xlsx"
    ids = [str(i) for i in (data.get("ids") or [])]
    arch = bool(data.get("include_archived"))
    d = _load()
    by_id = {c["id"]: c for c in d["cases"]}
    cases = [by_id[i] for i in ids if i in by_id] if ids else list(d["cases"])
    if not arch:
        cases = [c for c in cases if c.get("status") != "Archived"]
    if not cases:
        raise ServiceError("No test cases to export.")
    rows = _export_rows(d, cases)
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    if fmt == "csv":
        buf = io.StringIO(); w = csv.writer(buf)
        w.writerow(EXPORT_HEADERS); w.writerows(rows)
        body, mt = ("\ufeff" + buf.getvalue()).encode("utf-8"), "text/csv; charset=utf-8"
    else:
        import openpyxl
        from openpyxl.styles import Font, PatternFill
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Test Cases"
        ws.append(EXPORT_HEADERS)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF"); cell.fill = PatternFill("solid", fgColor="4361EE")
        for r in rows:
            ws.append([("'" + v) if isinstance(v, str) and v[:1] in "=+-@" else v for v in r])
        for col, wd in zip("ABCDEFGHIJKLMNOP", (12, 40, 30, 10, 12, 8, 10, 14, 40, 30, 12, 18, 8, 50, 50, 25)):
            ws.column_dimensions[col].width = wd
        ws.freeze_panes = "A2"
        b = io.BytesIO(); wb.save(b)
        body, mt = b.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return Response(body, media_type=mt, headers={
        "Content-Disposition": f'attachment; filename="test_cases_{stamp}.{fmt}"', "X-Case-Count": str(len(cases))})


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


def ai_review(case: Dict[str, Any], acs_text: str, model: str = "gemini", model_name: str = None) -> Dict[str, Any]:
    from . import services
    case = _clean_case(case)
    content = (f"Acceptance criteria / story notes:\n{acs_text or '(none given – infer from the test case)'}\n\n"
               f"Test case (JSON):\n{json.dumps({k: case[k] for k in ('title', 'description', 'precondition', 'priority', 'steps')}, ensure_ascii=False)}")
    usage: Dict[str, Any] = {"model": "gemini"}
    mid = (model_name or "").strip() or None
    if os.environ.get("ATG_MOCK_GEMINI") == "1":
        out = _mock_review(case, acs_text)
        txt = json.dumps(out)
        usage.update({"mock": True, "model_name": mid or "mock", "input_tokens": len(content) // 4 + 300,
                      "output_tokens": len(txt) // 4, "total_tokens": len(content) // 4 + 300 + len(txt) // 4})
    else:
        provider = services._norm_provider(model)
        usage["model"] = provider
        usage["provider"] = provider
        if provider == "gemini":
            g = services._gemini_module()
            gmodel = mid or g.gemini_model
            usage["model_name"] = gmodel
            try:
                resp = g.client.models.generate_content(
                    model=gmodel, contents=content,
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
        else:
            out_c = services._complete(provider, AI_SYSTEM, content, temperature=0.3, model_name=mid)
            txt, usage = out_c["text"], out_c["usage"]
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
    return {"ok": True, "review": ai_review(case, _s(data.get("acs"), 8000),
                                           model=_s(data.get("model"), 32) or "gemini",
                                           model_name=_s(data.get("model_name"), 200) or None)}


# ------------------------------------------------------------------ v4: usage check, folder management
def _usage(ids) -> Dict[str, Dict[str, Any]]:
    from . import test_runs
    rd = test_runs._load()
    out = {}
    for cid in ids:
        cyc = [c["name"] for c in rd["cycles"] if any(i["case_id"] == cid for i in c.get("items", []))]
        ex = sum(1 for e in rd["executions"] if e["case_id"] == cid)
        out[cid] = {"cycles": cyc, "executions": ex, "in_use": bool(cyc or ex)}
    return out


@router.post("/api/repo/delete_check")
def repo_delete_check(data: Dict[str, Any] = Body(...)):
    ids = [str(x) for x in data.get("ids") or []]
    d = _load()
    byid = {c["id"]: c for c in d["cases"]}
    u = _usage(ids)
    return {"ok": True, "cases": [{"id": i, "title": byid.get(i, {}).get("title", ""), "versions": len(byid.get(i, {}).get("versions") or []), **u[i]} for i in ids if i in byid]}


@router.put("/api/repo/folders/{fid}")
def repo_folder_update(fid: str, data: Dict[str, Any] = Body(...)):
    with locked(REPO_FILE):
        d = _load()
        f = _folder(d, fid)
        if not f:
            raise ServiceError("Folder not found.", 404)
        name = _s(data.get("name", f["name"]), 120)
        parent = f.get("parent", "")
        if "parent" in data:
            parent = data.get("parent") or ""
            if parent and (not _folder(d, parent) or parent in _desc_ids(d, fid)):
                raise ServiceError("Invalid parent folder.")
        if not name:
            raise ServiceError("Folder name is required.")
        if _dup_name(d, name, parent, fid):
            raise ServiceError(f"A folder named “{name}” already exists there. Choose another name.", 409)
        if parent != f.get("parent", ""):
            f["order"] = max([x.get("order", 0) for x in d["folders"] if x.get("parent", "") == parent] or [0]) + 1
        f.update({"name": name, "parent": parent})
        if "description" in data:
            f["description"] = _s(data.get("description"), 1000)
        _save(d)
    return {"ok": True, "folders": _tree(d)}


@router.post("/api/repo/folders/reorder")
def repo_folder_reorder(data: Dict[str, Any] = Body(...)):
    """Either {id, dir: 'up'|'down'} or {parent, ids: [...]} (drag & drop; may also move into a new parent)."""
    with locked(REPO_FILE):
        d = _load()
        if data.get("dir") in ("up", "down"):
            f = _folder(d, data.get("id", ""))
            if not f:
                raise ServiceError("Folder not found.", 404)
            sib = sorted([x for x in d["folders"] if x.get("parent", "") == f.get("parent", "")], key=lambda x: x.get("order", 0))
            i = sib.index(f); j = i - 1 if data["dir"] == "up" else i + 1
            if 0 <= j < len(sib):
                sib[i], sib[j] = sib[j], sib[i]
            for n, x in enumerate(sib, 1):
                x["order"] = n
        else:
            parent = data.get("parent") or ""
            if parent and not _folder(d, parent):
                raise ServiceError("Invalid parent folder.")
            for n, fid in enumerate(data.get("ids") or [], 1):
                f = _folder(d, fid)
                if not f or (parent and parent in _desc_ids(d, fid)):
                    continue
                if f.get("parent", "") != parent and _dup_name(d, f["name"], parent, fid):
                    raise ServiceError(f"A folder named “{f['name']}” already exists there.", 409)
                f["parent"], f["order"] = parent, n
        _save(d)
    return {"ok": True, "folders": _tree(d)}


@router.delete("/api/repo/folders/{fid}")
def repo_folder_delete(fid: str, mode: str = "move", target: str = "", confirm: str = ""):
    with locked(REPO_FILE):
        d = _load()
        f = _folder(d, fid)
        if not f:
            raise ServiceError("Folder not found.", 404)
        if _norm_name(confirm) != _norm_name(f["name"]):
            raise ServiceError("Type the folder name to confirm.")
        gone = set(_desc_ids(d, fid))
        cases = [c for c in d["cases"] if c.get("folder_id") in gone]
        if cases and mode == "move":
            if not _folder(d, target) or target in gone:
                raise ServiceError("Choose a folder to move the cases to.")
            for c in cases:
                c["folder_id"], c["updated"] = target, now()
                _event(c, "moved", f"Moved to {_folder_path(d, target)} (folder “{f['name']}” deleted)", folder_id=target)
        elif cases:
            # archive: cases keep a home so they can be restored -> park them in an 'Archived cases' folder
            home = _ensure_folder(d, "Archived cases")
            for c in cases:
                c["folder_id"], c["status"], c["updated"] = home, "Archived", now()
                _event(c, "archived", f"Archived (folder “{f['name']}” deleted)")
        d["folders"] = [x for x in d["folders"] if x["id"] not in gone]
        _save(d)
    return {"ok": True, "moved": len(cases) if mode == "move" else 0, "archived": len(cases) if mode != "move" else 0, "folders": _tree(d)}


@router.post("/api/repo/save_back")
def repo_save_back(data: Dict[str, Any] = Body(...)):
    """Review run opened from the repo: write edits back as new versions of the linked cases (no duplicates)."""
    links = data.get("links") or []          # repo id per review case (same order), "" = new case
    story = _s(data.get("story"), 60)
    res = {"updated": [], "unchanged": [], "created": []}
    with locked(REPO_FILE):
        d = _load()
        for i, tc in enumerate(data.get("test_cases") or []):
            rc = from_review_case(tc, story)
            rid = links[i] if i < len(links) else ""
            c = next((x for x in d["cases"] if x["id"] == rid), None)
            if c:
                rc["story"] = c.get("story") or story
                for k, st in enumerate(rc["steps"]):      # keep the repo's data only when Review has none
                    if k < len(c.get("steps") or []) and not st.get("data"):
                        st["data"] = c["steps"][k].get("data", "")
                (res["updated"] if _update_case(c, rc, "Saved back from Review") else res["unchanged"]).append(c["id"])
            else:
                res["created"].append(_new_case(d, rc, "AI", "Draft", "", "Created from Review (repo run)")["id"])
        _save(d)
    return {"ok": True, **res}


# ------------------------------------------------------------------ case detail v2 (preview drawer / full page)
def _jira_base() -> str:
    """Non-secret Jira base URL from Settings (for story / defect links); '' when not configured."""
    try:
        from . import settings_store
        for f in settings_store.get_settings():
            if f.get("key") == "JIRA_URL" and not f.get("secret"):
                v = str(f.get("value") or "").strip().rstrip("/")
                return v if v.startswith("http") else ""
    except Exception:
        log.debug("jira base lookup failed", exc_info=True)
    return ""


def _activity(c, executions) -> List[Dict[str, Any]]:
    """Stored audit events + events derived from versions / executions / comments for older data."""
    stored = [dict(e) for e in c.get("activity") or []]
    vers = {e.get("version") for e in stored if e.get("version")}
    ran = {e.get("exec_id") for e in stored if e.get("type") == "ran"}
    out = list(stored)
    for v in c.get("versions") or []:
        if v.get("version") not in vers:
            out.append({"ts": v.get("ts", ""), "type": "created" if v.get("version") == 1 else "edited",
                        "text": v.get("note", ""), "by": "", "version": v.get("version"), "derived": True})
    for e in executions or []:
        if e.get("id") not in ran:
            out.append({"ts": e.get("ts", ""), "type": "ran", "text": e.get("cycle_name", ""), "by": e.get("tester", ""),
                        "result": e.get("status", ""), "exec_id": e.get("id"), "cycle_id": e.get("cycle_id"), "derived": True})
    for m in c.get("comments") or []:
        out.append({"ts": m.get("ts", ""), "type": "commented", "text": m.get("text", "")[:120], "by": m.get("by", "")})
    return sorted(out, key=lambda e: e.get("ts", ""), reverse=True)


def log_event(cid: str, typ: str, text: str = "", by: str = "", **meta) -> None:
    """Used by test_runs (execution recorded) — best effort, never breaks the caller."""
    try:
        with locked(REPO_FILE):
            d = _load()
            c = next((x for x in d["cases"] if x["id"] == cid), None)
            if c:
                _event(c, typ, text, by, **meta)
                _save(d)
    except Exception:
        log.exception("log_event failed")


def _get(d, cid):
    c = next((x for x in d["cases"] if x["id"] == cid), None)
    if not c:
        raise ServiceError("Test case not found.", 404)
    return c


@router.post("/api/repo/cases/{cid}/status")
def repo_case_status(cid: str, data: Dict[str, Any] = Body(...)):
    st = data.get("status")
    if st not in ("Draft", "Ready", "Obsolete"):
        raise ServiceError("Unknown status.")
    with locked(REPO_FILE):
        d = _load()
        c = _get(d, cid)
        if c.get("status") == "Archived":
            raise ServiceError("Restore the case before changing its status.", 409)
        if c.get("status") != st:
            _event(c, "status", f"{c.get('status')} → {st}", _s(data.get("by"), 100), old=c.get("status"), new=st)
            c["status"], c["updated"] = st, now()
            _save(d)
    return {"ok": True, "case": _summary(c)}


@router.post("/api/repo/cases/{cid}/comments")
def repo_case_comment(cid: str, data: Dict[str, Any] = Body(...)):
    text = _s(data.get("text"), 4000)
    if not text:
        raise ServiceError("Write a comment first.")
    with locked(REPO_FILE):
        d = _load()
        c = _get(d, cid)
        m = {"id": f"CM{len(c.get('comments') or []) + 1}", "ts": now(), "by": _s(data.get("by"), 100) or "User", "text": text}
        c.setdefault("comments", []).append(m)
        _save(d)
    return {"ok": True, "comment": m, "comments": c["comments"]}


@router.post("/api/repo/cases/{cid}/duplicate")
def repo_case_duplicate(cid: str, data: Dict[str, Any] = Body(default={})):
    with locked(REPO_FILE):
        d = _load()
        c = _get(d, cid)
        n = _new_case(d, {**_content(c), "title": (c["title"] + " (copy)")[:300], "story": c.get("story", ""),
                          "tags": c.get("tags") or [], "acs": c.get("acs") or [], "by": data.get("by")},
                      c.get("source") or "Manual", "Draft", c.get("folder_id", ""), f"Duplicated from {cid}")
        _event(c, "duplicated", f"Duplicated as {n['id']}", _s(data.get("by"), 100), copy=n["id"])
        _save(d)
    return {"ok": True, "case": n}


@router.post("/api/repo/cases/{cid}/restore_version")
def repo_case_restore_version(cid: str, data: Dict[str, Any] = Body(...)):
    """Restore = a NEW version whose content copies the chosen old version (history is never rewritten)."""
    try:
        ver = int(data.get("version"))
    except Exception:
        raise ServiceError("Choose a version to restore.")
    with locked(REPO_FILE):
        d = _load()
        c = _get(d, cid)
        v = next((x for x in c.get("versions") or [] if x.get("version") == ver), None)
        if not v:
            raise ServiceError("Version not found.", 404)
        newv = _update_case(c, {**(v.get("snapshot") or {}), "by": data.get("by"), "event_type": "restored"}, f"Restored v{ver}")
        _save(d)
    return {"ok": True, "case": c, "new_version": newv}


@router.post("/api/repo/cases/{cid}/regenerate")
def repo_case_regenerate(cid: str, data: Dict[str, Any] = Body(default={})):
    """Proposal only (same service as Review's Regenerate); the browser saves it as a new version after confirm."""
    from . import services
    c = _get(_load(), cid)
    tc = {"id": c["id"], "name": c.get("title", ""), "description": c.get("description", ""),
          "precondition": c.get("precondition", ""), "priority": c.get("priority", ""),
          "steps": [{"description": s.get("step", ""), "expected": s.get("expected", "")} for s in c.get("steps") or []]}
    res = services.regenerate_one(c.get("story", ""), _s(data.get("feature_text"), 12000),
                                  [{"id": a, "title": ""} for a in c.get("acs") or []], tc, _s(data.get("instruction"), 1000),
                                  model=_s(data.get("model"), 32) or "gemini",
                                  model_name=_s(data.get("model_name"), 200) or None)
    p = res["test_case"]
    old = c.get("steps") or []
    keep = bool(data.get("keep_title_priority"))
    prop = {"title": (c["title"] if keep else (p.get("name") or c["title"])), "description": p.get("description", ""), "precondition": p.get("precondition", ""),
            "priority": (c.get("priority") or "Medium") if keep else (p.get("priority") or c.get("priority", "Medium")),
            "steps": [{"step": s["description"], "expected": s["expected"],
                       "data": (s.get("data") or (old[i].get("data", "") if i < len(old) else "")),
                       **({"test_data": s.get("test_data") or (old[i].get("test_data") if i < len(old) else None)}
                          if (s.get("test_data") or (i < len(old) and old[i].get("test_data"))) else {})}
                      for i, s in enumerate(p.get("steps") or [])]}
    try:
        token_usage.record(action="Regenerate (repo)", usage=res["usage"], run={"story_id": c.get("story") or "", "jira": {"summary": c.get("title")}, "source": "repo"}, mode="repo")
    except Exception:
        log.debug("token usage record failed", exc_info=True)
    return {"ok": True, "proposal": prop, "usage": res["usage"]}


@router.post("/api/repo/cases/{cid}/attachments")
def repo_case_attach(cid: str, data: Dict[str, Any] = Body(...)):
    """Link an already-uploaded file (POST /api/attachments, 50 MB limit) to the case itself."""
    from .test_runs import ATT_RE
    a = data.get("attachment") or {}
    if not ATT_RE.match(str(a.get("name", ""))):
        raise ServiceError("Invalid attachment.")
    with locked(REPO_FILE):
        d = _load()
        c = _get(d, cid)
        item = {"name": a["name"], "orig": _s(a.get("orig"), 200), "mime": _s(a.get("mime"), 80), "size": int(a.get("size") or 0),
                "ts": now(), "by": _s(data.get("by"), 100)}
        c.setdefault("attachments", []).append(item)
        _event(c, "attached", "Attached " + item["orig"], item["by"])
        _save(d)
    return {"ok": True, "attachments": c["attachments"]}


@router.delete("/api/repo/cases/{cid}/attachments/{name}")
def repo_case_detach(cid: str, name: str):
    with locked(REPO_FILE):
        d = _load()
        c = _get(d, cid)
        c["attachments"] = [a for a in c.get("attachments") or [] if a.get("name") != name]
        _save(d)
    return {"ok": True, "attachments": c["attachments"]}
