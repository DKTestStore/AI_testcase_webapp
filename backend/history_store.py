"""Per-browser rolling run history (last MAX_RUNS runs).

Live store is SQLite (history_entries, history_snapshots, history_seq in backend/app.db).
Leftover backend/history/<hid>/ JSON folders are imported once on first start and kept
as a backup; live writes go only to SQLite. Excel / report artifacts stay as files under
ai_test_generator/reports/runs/<run_id>/ (RUNS_DIR).

The browser is identified by a long-lived 'atg_history' cookie that is separate from the
session cookie, so Logout / New run never clear history. When a run beyond MAX_RUNS is
added only the single oldest entry is removed (FIFO) - history is never wiped all at once.
"""
from __future__ import annotations

import copy
import json
import shutil
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import RUNS_DIR
from .db.engine import session_scope
from .db.models import HistoryEntry, HistorySeq, HistorySnapshot
from .settings_store import get_history_limit

MAX_RUNS = 5  # default; the live value comes from Settings (get_history_limit)
IST = ZoneInfo("Asia/Kolkata")
_LOCK = threading.Lock()

_ENTRY_COLS = (
    "run_id", "rid", "kind", "created", "updated", "story_id", "title",
    "source", "count", "reviewed", "status", "model", "model_name",
)


def new_hid() -> str:
    return uuid.uuid4().hex


def valid(hid: Optional[str]) -> bool:
    return bool(hid) and hid.isalnum() and len(hid) <= 64


def _jsonable(obj: Any) -> Any:
    return json.loads(json.dumps(obj, default=str))


@contextmanager
def _session() -> Iterator[Session]:
    session = session_scope()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _source(run):
    if run.get("imported") and not run.get("markdown"):
        return "Excel upload"
    return {"jira": "Jira", "local": "Local text", "record": "Recorded", "repo": "Repo"}.get(run.get("source") or "", "Excel upload" if run.get("imported") else "Local text")


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
           "count": len(cases), "reviewed": rv, "status": status,
           "model": run.get("model") or "", "model_name": run.get("model_name") or ""}
    rec = run.get("recording") if run.get("source") == "record" else None
    if rec:   # Record feature (additive): shown in Run history for recorded runs only
        su = rec.get("setup") or {}
        out["rec"] = {"name": su.get("name", ""), "url": su.get("url", ""), "duration": rec.get("duration"),
                      "steps": rec.get("n_steps"), "checkpoints": rec.get("n_checkpoints"), "errors": rec.get("n_errors"),
                      "video": bool(rec.get("video")), "rid": rec.get("rid"), "version": rec.get("version", 1)}
    return out


def _entry_from_row(row: HistoryEntry) -> Dict[str, Any]:
    ent: Dict[str, Any] = {
        "run_id": row.run_id,
        "rid": row.rid or "",
        "created": row.created or "",
        "story_id": row.story_id or "",
        "title": row.title or "",
        "source": row.source or "",
        "count": int(row.count or 0),
        "reviewed": int(row.reviewed or 0),
        "status": row.status or "",
        "updated": row.updated or "",
        "model": getattr(row, "model", None) or "",
        "model_name": getattr(row, "model_name", None) or "",
    }
    if row.kind:
        # Insert kind after rid to match the previous JSON shape for batch entries.
        keys = list(ent.items())
        ent = {"run_id": ent["run_id"], "rid": ent["rid"], "kind": row.kind}
        ent.update(keys[2:])
    extra = row.extra
    if isinstance(extra, dict):
        for k, v in extra.items():
            if k not in _ENTRY_COLS:
                ent[k] = copy.deepcopy(v)
    return ent


def _apply_entry(row: HistoryEntry, ent: Dict[str, Any]) -> None:
    row.rid = str(ent.get("rid") or "")
    row.kind = str(ent.get("kind") or "")
    row.created = str(ent.get("created") or "")
    row.updated = str(ent.get("updated") or "")
    row.story_id = str(ent.get("story_id") or "")
    row.title = str(ent.get("title") or "")
    row.source = str(ent.get("source") or "")
    row.count = int(ent.get("count") or 0)
    row.reviewed = int(ent.get("reviewed") or 0)
    row.status = str(ent.get("status") or "")
    if hasattr(row, "model"):
        row.model = str(ent.get("model") or "")
    if hasattr(row, "model_name"):
        row.model_name = str(ent.get("model_name") or "")
    extra = {k: v for k, v in ent.items() if k not in _ENTRY_COLS}
    row.extra = _jsonable(extra) if extra else None


def _load_items(session: Session, hid: str) -> List[Dict[str, Any]]:
    rows = (
        session.query(HistoryEntry)
        .filter_by(hid=hid)
        .order_by(HistoryEntry.position.desc())
        .all()
    )
    return [_entry_from_row(r) for r in rows]


def _load_seq(session: Session, hid: str) -> Dict[str, Dict[str, int]]:
    out: Dict[str, Dict[str, int]] = {"seq": {}, "bseq": {}}
    for r in session.query(HistorySeq).filter_by(hid=hid).all():
        if r.key in out:
            out[r.key][r.day] = int(r.n)
    return out


def _replace_seq(session: Session, hid: str, key: str, mapping: Dict[str, int]) -> None:
    session.query(HistorySeq).filter_by(hid=hid, key=key).delete()
    for day, n in mapping.items():
        session.add(HistorySeq(hid=hid, key=key, day=str(day), n=int(n)))


def _next_position(session: Session, hid: str) -> int:
    m = session.query(func.max(HistoryEntry.position)).filter_by(hid=hid).scalar()
    return (int(m) if m is not None else 0) + 1


def _bump(seqmap: Dict[str, int], day: str) -> int:
    n = seqmap.get(day, 0) + 1
    seqmap[day] = n
    # Keep last 10 days, same as the previous JSON store.
    trimmed = dict(sorted(seqmap.items())[-10:])
    seqmap.clear()
    seqmap.update(trimmed)
    return n


def _upsert_snapshot(session: Session, hid: str, run_id: str, payload: Any) -> None:
    row = session.get(HistorySnapshot, (hid, run_id))
    data = _jsonable(payload)
    if row is None:
        session.add(HistorySnapshot(hid=hid, run_id=run_id, payload=data))
    else:
        row.payload = data


def _queue_drop(session: Session, hid: str, ent: Dict[str, Any], cleanup: List[Any], keep=None) -> None:
    """Delete the entry's SQLite snapshot and queue RUNS_DIR trees (not JSON backups).

    A batch entry counts as one history entry; removing it also drops child report dirs.
    """
    run_id = ent.get("run_id") or ""
    if run_id != keep and str(run_id).isalnum():
        snap = session.get(HistorySnapshot, (hid, run_id))
        if snap is not None:
            session.delete(snap)
        cleanup.append(RUNS_DIR / run_id)
    for ch in ent.get("children") or []:
        cid = ch.get("run_id")
        if cid != keep and str(cid or "").isalnum():
            cleanup.append(RUNS_DIR / cid)


def _rmtree_all(paths: List[Any]) -> None:
    seen = set()
    for p in paths:
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        shutil.rmtree(p, ignore_errors=True)


def record(hid: str, run: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Upsert the run (only runs that have test cases). Returns the index entry."""
    if not valid(hid) or not run.get("test_cases"):
        return None
    with _LOCK:
        with _session() as session:
            items = _load_items(session, hid)
            seqs = _load_seq(session, hid)
            ent = next((e for e in items if e["run_id"] == run["run_id"]), None)
            now = datetime.now(IST)
            cleanup: List[Any] = []
            if ent is None:
                day = now.strftime("%Y%m%d")
                n = _bump(seqs["seq"], day)
                _replace_seq(session, hid, "seq", seqs["seq"])
                ent = {"run_id": run["run_id"], "rid": run.get("rid") or f"RUN-{day}-{n:03d}",
                       "created": now.isoformat(timespec="seconds")}
                items.insert(0, ent)
                row = HistoryEntry(hid=hid, run_id=ent["run_id"], position=_next_position(session, hid))
                session.add(row)
                session.flush()
                limit = get_history_limit()
                while len(items) > limit:             # FIFO: drop only the oldest beyond the limit
                    old = items.pop()                 # list is kept newest-first
                    old_row = session.get(HistoryEntry, (hid, old["run_id"]))
                    if old_row is not None:
                        session.delete(old_row)
                    _queue_drop(session, hid, old, cleanup, keep=run["run_id"])
            else:
                row = session.get(HistoryEntry, (hid, ent["run_id"]))
                if row is None:
                    row = HistoryEntry(hid=hid, run_id=ent["run_id"], position=_next_position(session, hid))
                    session.add(row)
                    session.flush()
            run["rid"] = ent["rid"]
            ent.update(_summary(run), updated=now.isoformat(timespec="seconds"))
            _apply_entry(row, ent)
            _upsert_snapshot(session, hid, run["run_id"], run)
        _rmtree_all(cleanup)
        return ent


def record_batch(hid: str, batch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Upsert a whole batch as ONE history entry (kind=batch) with its item runs as children.
    Item runs get RUN-YYYYMMDD-NNN ids from the same daily sequence as single runs."""
    items_with_cases = [it for it in batch.get("items", []) if (it.get("run") or {}).get("test_cases")]
    if not valid(hid) or not items_with_cases:
        return None
    with _LOCK:
        with _session() as session:
            items = _load_items(session, hid)
            seqs = _load_seq(session, hid)
            now = datetime.now(IST)
            day = now.strftime("%Y%m%d")
            ent = next((e for e in items if e["run_id"] == batch["batch_id"]), None)
            cleanup: List[Any] = []
            seq_changed = False
            bseq_changed = False
            if ent is None:
                if not batch.get("rid"):
                    batch["rid"] = f"BATCH-{day}-{_bump(seqs['bseq'], day):02d}"
                    bseq_changed = True
                ent = {"run_id": batch["batch_id"], "rid": batch["rid"], "kind": "batch",
                       "created": now.isoformat(timespec="seconds")}
                items.insert(0, ent)
                row = HistoryEntry(hid=hid, run_id=ent["run_id"], position=_next_position(session, hid))
                session.add(row)
                session.flush()
                limit = get_history_limit()
                while len(items) > limit:
                    old = items.pop()
                    old_row = session.get(HistoryEntry, (hid, old["run_id"]))
                    if old_row is not None:
                        session.delete(old_row)
                    _queue_drop(session, hid, old, cleanup, keep=batch["batch_id"])
            else:
                row = session.get(HistoryEntry, (hid, ent["run_id"]))
                if row is None:
                    row = HistoryEntry(hid=hid, run_id=ent["run_id"], position=_next_position(session, hid))
                    session.add(row)
                    session.flush()
            children = []
            for it in items_with_cases:
                run = it["run"]
                if not run.get("rid"):
                    run["rid"] = f"RUN-{day}-{_bump(seqs['seq'], day):03d}"
                    seq_changed = True
                ch = {"run_id": run["run_id"], "rid": run["rid"], "key": it["key"], **_summary(run)}
                ch["story_id"] = it.get("item_id") or ch["story_id"]
                ch["title"] = it.get("title") or ch["title"]
                ch["source"] = {"jira": "Jira", "local": "Local text", "excel": "Excel upload"}[it["source"]]
                children.append(ch)
            if seq_changed:
                _replace_seq(session, hid, "seq", seqs["seq"])
            if bseq_changed:
                _replace_seq(session, hid, "bseq", seqs["bseq"])
            n_up = sum(1 for c in children if c["status"] == "Uploaded to qTest")
            n_rv = sum(1 for c in children if c["status"] in ("Reviewed", "Uploaded to qTest"))
            status = ("Uploaded to qTest" if n_up == len(children) else "Partly uploaded" if n_up
                      else "Reviewed" if n_rv == len(children) else "Draft")
            ent.update(story_id=", ".join(c["story_id"] for c in children if c["story_id"]),
                       title=f"Batch · {len(children)} item" + ("s" if len(children) != 1 else ""),
                       source="Batch", count=sum(c["count"] for c in children),
                       reviewed=sum(c["reviewed"] for c in children), status=status,
                       children=children, updated=now.isoformat(timespec="seconds"))
            _apply_entry(row, ent)
            _upsert_snapshot(session, hid, batch["batch_id"], batch)
        _rmtree_all(cleanup)
        return ent


def list_items(hid) -> List[Dict[str, Any]]:
    if not valid(hid):
        return []
    with _LOCK:
        with _session() as session:
            return _load_items(session, hid)  # stored newest-first


def load_run(hid, run_id) -> Optional[Dict[str, Any]]:
    if not valid(hid) or not str(run_id).isalnum():
        return None
    with _session() as session:
        row = session.get(HistorySnapshot, (hid, str(run_id)))
        if row is None or row.payload is None:
            return None
        return copy.deepcopy(row.payload)


def save_snapshot(hid, run):
    """Update an existing snapshot only (run or batch). No-op if it is not already stored."""
    if not valid(hid):
        return
    run_id = run.get("run_id") or run.get("batch_id")
    if not run_id or not str(run_id).isalnum():
        return
    with _LOCK:
        with _session() as session:
            row = session.get(HistorySnapshot, (hid, str(run_id)))
            if row is None:
                return
            row.payload = _jsonable(run)


def delete(hid, run_id) -> bool:
    if not valid(hid):
        return False
    with _LOCK:
        with _session() as session:
            row = session.get(HistoryEntry, (hid, run_id))
            if row is None:
                return False
            gone = _entry_from_row(row)
            session.delete(row)
            cleanup: List[Any] = []
            _queue_drop(session, hid, gone, cleanup)
        _rmtree_all(cleanup)
        return True


def prune_all(limit: int, hid: Optional[str] = None) -> int:
    """Limit lowered in Settings: drop only the oldest runs beyond `limit` in every browser's
    history (FIFO). Never removes runs within the limit; raising the limit removes nothing."""
    removed = 0
    with _LOCK:
        with _session() as session:
            hids = [r[0] for r in session.query(HistoryEntry.hid).distinct().all()]
            cleanup: List[Any] = []
            for name in hids:
                if not valid(name):
                    continue
                rows = (
                    session.query(HistoryEntry)
                    .filter_by(hid=name)
                    .order_by(HistoryEntry.position.desc())
                    .all()
                )
                if len(rows) <= limit:
                    continue
                drop = rows[limit:]
                for e in drop:
                    gone = _entry_from_row(e)
                    session.delete(e)
                    _queue_drop(session, name, gone, cleanup)
                    removed += name == hid
        _rmtree_all(cleanup)
    return removed
