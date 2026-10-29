"""Per-browser rolling run history (last MAX_RUNS runs).

Layout: backend/history/<hid>/history.json   small index (newest first) + daily sequence counters
        backend/history/<hid>/runs/<run_id>.json   full run snapshot (loaded lazily on Open / Excel)
The browser is identified by a long-lived 'atg_history' cookie that is separate from the
session cookie, so Logout / New run never clear history. When a run beyond MAX_RUNS is
added only the single oldest entry is removed (FIFO) - history is never wiped all at once.
"""
import copy
import json
import shutil
import threading
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from .config import HISTORY_DIR, RUNS_DIR

MAX_RUNS = 5
IST = ZoneInfo("Asia/Kolkata")
_LOCK = threading.Lock()


def new_hid() -> str:
    return uuid.uuid4().hex


def valid(hid: Optional[str]) -> bool:
    return bool(hid) and hid.isalnum() and len(hid) <= 64


def _dir(hid):
    return HISTORY_DIR / hid


def _load(hid) -> Dict[str, Any]:
    p = _dir(hid) / "history.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"items": [], "seq": {}}


def _write(hid, idx):
    d = _dir(hid)
    (d / "runs").mkdir(parents=True, exist_ok=True)
    tmp = d / "history.json.tmp"
    tmp.write_text(json.dumps(idx, indent=1), encoding="utf-8")
    tmp.replace(d / "history.json")


def _source(run):
    if run.get("imported") and not run.get("markdown"):
        return "Excel upload"
    return {"jira": "Jira", "local": "Local text"}.get(run.get("source") or "", "Excel upload" if run.get("imported") else "Local text")


def _title(run):
    j = run.get("jira") or {}
    if j.get("summary"):
        return j["summary"]
    if run.get("imported") and run.get("import_info"):
        return "Imported from " + run["import_info"].get("filename", "Excel")
    if run.get("local_filename"):
        return run["local_filename"]
    for line in (run.get("feature_text") or "").splitlines():
        if line.strip():
            return line.strip()[:90]
    return "Untitled run"


def _summary(run) -> Dict[str, Any]:
    cases = run.get("test_cases") or []
    rv = sum(1 for c in cases if c.get("status") == "reviewed")
    up = run.get("upload") or {}
    status = "Uploaded to qTest" if up.get("created") else ("Reviewed" if cases and rv == len(cases) else "Draft")
    return {"story_id": run.get("story_id") or "", "title": _title(run), "source": _source(run),
            "count": len(cases), "reviewed": rv, "status": status}


def record(hid: str, run: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Upsert the run (only runs that have test cases). Returns the index entry."""
    if not valid(hid) or not run.get("test_cases"):
        return None
    with _LOCK:
        idx = _load(hid)
        items: List[Dict[str, Any]] = idx["items"]
        ent = next((e for e in items if e["run_id"] == run["run_id"]), None)
        now = datetime.now(IST)
        if ent is None:
            day = now.strftime("%Y%m%d")
            n = idx["seq"].get(day, 0) + 1
            idx["seq"] = {day: n, **{k: v for k, v in idx["seq"].items() if k != day}}
            idx["seq"] = dict(sorted(idx["seq"].items())[-10:])
            ent = {"run_id": run["run_id"], "rid": run.get("rid") or f"RUN-{day}-{n:03d}",
                   "created": now.isoformat(timespec="seconds")}
            items.insert(0, ent)
            while len(items) > MAX_RUNS:          # FIFO: drop ONLY the single oldest
                old = items.pop()                 # list is kept newest-first

                _drop_files(hid, old["run_id"], keep=run["run_id"])
        run["rid"] = ent["rid"]
        ent.update(_summary(run), updated=now.isoformat(timespec="seconds"))
        _write(hid, idx)
        (_dir(hid) / "runs" / f"{run['run_id']}.json").write_text(json.dumps(run, default=str), encoding="utf-8")
        return ent


def _drop_files(hid, run_id, keep=None):
    if run_id == keep or not run_id.isalnum():
        return
    p = _dir(hid) / "runs" / f"{run_id}.json"
    if p.exists():
        p.unlink()
    shutil.rmtree(RUNS_DIR / run_id, ignore_errors=True)


def list_items(hid) -> List[Dict[str, Any]]:
    if not valid(hid):
        return []
    with _LOCK:
        return _load(hid)["items"]  # stored newest-first


def load_run(hid, run_id) -> Optional[Dict[str, Any]]:
    if not valid(hid) or not str(run_id).isalnum():
        return None
    p = _dir(hid) / "runs" / f"{run_id}.json"
    if not p.exists():
        return None
    return copy.deepcopy(json.loads(p.read_text(encoding="utf-8")))


def save_snapshot(hid, run):
    if valid(hid):
        p = _dir(hid) / "runs" / f"{run['run_id']}.json"
        if p.exists():
            p.write_text(json.dumps(run, default=str), encoding="utf-8")


def delete(hid, run_id) -> bool:
    if not valid(hid):
        return False
    with _LOCK:
        idx = _load(hid)
        before = len(idx["items"])
        idx["items"] = [e for e in idx["items"] if e["run_id"] != run_id]
        if len(idx["items"]) == before:
            return False
        _write(hid, idx)
        _drop_files(hid, run_id)
        return True
