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
from .settings_store import get_history_limit

MAX_RUNS = 5  # default; the live value comes from Settings (get_history_limit)
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
    return {"jira": "Jira", "local": "Local text", "record": "Recorded"}.get(run.get("source") or "", "Excel upload" if run.get("imported") else "Local text")


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
    out = {"story_id": run.get("story_id") or "", "title": _title(run), "source": _source(run),
           "count": len(cases), "reviewed": rv, "status": status}
    rec = run.get("recording") if run.get("source") == "record" else None
    if rec:   # Record feature (additive): shown in Run history for recorded runs only
        su = rec.get("setup") or {}
        out["rec"] = {"name": su.get("name", ""), "url": su.get("url", ""), "duration": rec.get("duration"),
                      "steps": rec.get("n_steps"), "checkpoints": rec.get("n_checkpoints"), "errors": rec.get("n_errors"),
                      "video": bool(rec.get("video")), "rid": rec.get("rid"), "version": rec.get("version", 1)}
    return out


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
            limit = get_history_limit()
            while len(items) > limit:             # FIFO: drop only the oldest beyond the limit
                old = items.pop()                 # list is kept newest-first

                _drop_entry(hid, old, keep=run["run_id"])
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


def _drop_entry(hid, ent, keep=None):
    """A batch entry counts as one history entry; removing it removes all of its item runs."""
    _drop_files(hid, ent["run_id"], keep=keep)
    for ch in ent.get("children") or []:
        if ch.get("run_id") != keep and str(ch.get("run_id", "")).isalnum():
            shutil.rmtree(RUNS_DIR / ch["run_id"], ignore_errors=True)


def _bump(idx, key, day):
    seq = idx.setdefault(key, {})
    n = seq.get(day, 0) + 1
    seq[day] = n
    idx[key] = dict(sorted(seq.items())[-10:])
    return n


def record_batch(hid: str, batch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Upsert a whole batch as ONE history entry (kind=batch) with its item runs as children.
    Item runs get RUN-YYYYMMDD-NNN ids from the same daily sequence as single runs."""
    items_with_cases = [it for it in batch.get("items", []) if (it.get("run") or {}).get("test_cases")]
    if not valid(hid) or not items_with_cases:
        return None
    with _LOCK:
        idx = _load(hid)
        items: List[Dict[str, Any]] = idx["items"]
        now = datetime.now(IST)
        day = now.strftime("%Y%m%d")
        ent = next((e for e in items if e["run_id"] == batch["batch_id"]), None)
        if ent is None:
            if not batch.get("rid"):
                batch["rid"] = f"BATCH-{day}-{_bump(idx, 'bseq', day):02d}"
            ent = {"run_id": batch["batch_id"], "rid": batch["rid"], "kind": "batch",
                   "created": now.isoformat(timespec="seconds")}
            items.insert(0, ent)
            limit = get_history_limit()
            while len(items) > limit:
                _drop_entry(hid, items.pop(), keep=batch["batch_id"])
        children = []
        for it in items_with_cases:
            run = it["run"]
            if not run.get("rid"):
                run["rid"] = f"RUN-{day}-{_bump(idx, 'seq', day):03d}"
            ch = {"run_id": run["run_id"], "rid": run["rid"], "key": it["key"], **_summary(run)}
            ch["story_id"] = it.get("item_id") or ch["story_id"]
            ch["title"] = it.get("title") or ch["title"]
            ch["source"] = {"jira": "Jira", "local": "Local text", "excel": "Excel upload"}[it["source"]]
            children.append(ch)
        n_up = sum(1 for c in children if c["status"] == "Uploaded to qTest")
        n_rv = sum(1 for c in children if c["status"] in ("Reviewed", "Uploaded to qTest"))
        status = ("Uploaded to qTest" if n_up == len(children) else "Partly uploaded" if n_up
                  else "Reviewed" if n_rv == len(children) else "Draft")
        ent.update(story_id=", ".join(c["story_id"] for c in children if c["story_id"]),
                   title=f"Batch · {len(children)} item" + ("s" if len(children) != 1 else ""),
                   source="Batch", count=sum(c["count"] for c in children),
                   reviewed=sum(c["reviewed"] for c in children), status=status,
                   children=children, updated=now.isoformat(timespec="seconds"))
        _write(hid, idx)
        (_dir(hid) / "runs" / f"{batch['batch_id']}.json").write_text(json.dumps(batch, default=str), encoding="utf-8")
        return ent


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
        gone = next(e for e in _load(hid)["items"] if e["run_id"] == run_id)
        _write(hid, idx)
        _drop_entry(hid, gone)
        return True


def prune_all(limit: int, hid: Optional[str] = None) -> int:
    """Limit lowered in Settings: drop only the oldest runs beyond `limit` in every browser's
    history (FIFO). Never removes runs within the limit; raising the limit removes nothing."""
    removed = 0
    if not HISTORY_DIR.exists():
        return 0
    with _LOCK:
        for d in HISTORY_DIR.iterdir():
            if not (d.is_dir() and valid(d.name)):
                continue
            idx = _load(d.name)
            if len(idx["items"]) <= limit:
                continue
            drop = idx["items"][limit:]
            idx["items"] = idx["items"][:limit]
            _write(d.name, idx)
            for e in drop:
                _drop_entry(d.name, e)
                removed += d.name == hid
    return removed
