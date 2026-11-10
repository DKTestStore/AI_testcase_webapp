"""Token usage ledger (additive feature). Stored in backend/token_usage.json (gitignored).
Recording must never break generation: every public writer swallows its own errors.
Entries carry a stable `id` (`TU-` + 12 hex). Older rows are backfilled on load.
Deletes write a backup under ai_test_generator/reports/ (token_ledger.bak.json + last few stamped copies).
They do not touch reports/gemini_usage.json (the provider quota tracker)."""
import csv
import io
import json
import logging
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import settings_store
from .config import REPORTS_DIR

log = logging.getLogger("atg.tokens")
PATH = Path(__file__).resolve().parent / "token_usage.json"
_LOCK = threading.RLock()
MAX_ENTRIES = 20000
BACKUP_KEEP = 5
PAGE_SIZES = (10, 25, 50, 100)
ACTIONS = ["Generate", "Regenerate", "Coverage check", "AC generate", "AI review"]
DEFAULTS = {"token_daily_limit": 1_000_000, "token_rate_input": 0.30, "token_rate_output": 2.50}


def _new_id() -> str:
    return "TU-" + uuid.uuid4().hex[:12]


def _read() -> List[Dict[str, Any]]:
    try:
        d = json.loads(PATH.read_text(encoding="utf-8"))
        return d if isinstance(d, list) else []
    except Exception:
        return []


def _write(data: List[Dict[str, Any]]) -> None:
    tmp = PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    tmp.replace(PATH)


def _ensure_ids(data: List[Dict[str, Any]]) -> bool:
    """Assign persistent ids to legacy rows. Returns True if the list was mutated."""
    changed = False
    seen = set()
    for e in data:
        if not isinstance(e, dict):
            continue
        i = str(e.get("id") or "").strip()
        if not i or i in seen:
            nid = _new_id()
            while nid in seen:
                nid = _new_id()
            e["id"] = nid
            changed = True
            i = nid
        seen.add(i)
    return changed


def _load() -> List[Dict[str, Any]]:
    """Read the ledger, backfilling missing ids (and persisting them when possible)."""
    with _LOCK:
        data = _read()
        if _ensure_ids(data):
            try:
                _write(data)
            except Exception:
                log.exception("token usage id backfill write failed")
        return data


def _backup() -> None:
    """Copy the current ledger into reports/ before a delete. Keeps a rolling latest + last few stamps."""
    if not PATH.exists():
        return
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    raw = PATH.read_bytes()
    (REPORTS_DIR / "token_ledger.bak.json").write_bytes(raw)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    stamped = REPORTS_DIR / f"token_ledger.bak-{ts}.json"
    n = 1
    while stamped.exists():
        n += 1
        stamped = REPORTS_DIR / f"token_ledger.bak-{ts}-{n}.json"
    stamped.write_bytes(raw)
    old = sorted(REPORTS_DIR.glob("token_ledger.bak-*.json"))
    for p in old[:-BACKUP_KEEP]:
        try:
            p.unlink()
        except Exception:
            log.exception("token usage backup prune failed: %s", p)


def record(*, action: str, usage: Optional[Dict[str, Any]], run: Optional[Dict[str, Any]] = None,
           mode: str = "", batch: Optional[Dict[str, Any]] = None, item: Optional[Dict[str, Any]] = None) -> None:
    try:
        u = usage or {}
        # Record every provider. `model` field stores the concrete model_name (legacy shape).
        # Skip empty usage with no tokens and no model_name (nothing to attribute).
        if not (u.get("model_name") or u.get("model") or u.get("total_tokens") or u.get("input_tokens") or u.get("output_tokens") or u.get("mock")):
            return
        inp = int(u.get("input_tokens") or 0)
        out = int(u.get("output_tokens") or 0)
        tot = int(u.get("total_tokens") or 0) or inp + out
        run = run or {}
        story = run.get("story_id") or ""
        title = ""
        jira = run.get("jira") or {}
        if isinstance(jira, dict):
            title = jira.get("summary") or jira.get("title") or ""
        if item:
            story = story or item.get("item_id") or ""
            title = title or item.get("title") or ""
        src = run.get("source") or (item or {}).get("source") or ""
        ent = {"id": _new_id(), "ts": datetime.now().isoformat(timespec="seconds"), "action": action, "mode": mode,
               "rid": run.get("rid") or "", "run_id": run.get("run_id") or "",
               "batch_rid": (batch or {}).get("rid") or "", "batch_id": (batch or {}).get("batch_id") or "",
               "story_id": story, "title": title, "source": src,
               "model": u.get("model_name") or u.get("model") or "gemini", "mock": bool(u.get("mock")) or u.get("model_name") == "mock",
               "input": inp, "output": out, "total": tot, "provider": u.get("provider") or u.get("model") or ""}
        if u.get("template"):   # prompt templates: one row per template call
            ent["template"] = str(u["template"])[:80]
        with _LOCK:
            data = _load()
            data.append(ent)
            data = data[-MAX_ENTRIES:]
            _write(data)
    except Exception:
        log.exception("token usage record failed (ignored)")


# ---- settings (backend/app_settings.json) ---------------------------------- #
def get_settings() -> Dict[str, float]:
    d = settings_store._app()
    out = {}
    for k, dv in DEFAULTS.items():
        try:
            v = float(d.get(k, dv))
            out[k] = v if v >= 0 else dv
        except (TypeError, ValueError):
            out[k] = dv
    out["token_daily_limit"] = int(out["token_daily_limit"])
    return out


def set_settings(values: Dict[str, Any]) -> Dict[str, float]:
    clean = {}
    for k in DEFAULTS:
        if k not in (values or {}):
            continue
        try:
            v = float(str(values[k]).strip())
        except (TypeError, ValueError):
            raise ValueError(f"{k} must be a number.")
        if v < 0 or v > 1e12:
            raise ValueError(f"{k} must be a non-negative number.")
        if k == "token_daily_limit":
            if not v.is_integer() or v < 1:
                raise ValueError("Daily token limit must be a whole number ≥ 1.")
            v = int(v)
        clean[k] = v
    data = settings_store._app()
    data.update(clean)
    tmp = settings_store.APP_SETTINGS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(settings_store.APP_SETTINGS_PATH)
    return get_settings()


# ---- queries --------------------------------------------------------------- #
def _match(e, d_from, d_to, mode, model):
    day = e["ts"][:10]
    if d_from and day < d_from: return False
    if d_to and day > d_to: return False
    if mode and mode != "all" and e.get("mode") != mode: return False
    if model and model != "all" and e.get("model") != model: return False
    return True


def _sum(es):
    i = sum(e["input"] for e in es); o = sum(e["output"] for e in es)
    return {"input": i, "output": o, "total": sum(e["total"] for e in es)}


def query(d_from="", d_to="", mode="", model="", page: int = 1, page_size: int = 0) -> Dict[str, Any]:
    data = _load()
    st = get_settings()
    now = datetime.now()
    today = now.date().isoformat(); month = today[:7]
    sel = [e for e in data if _match(e, d_from, d_to, mode, model)]
    # cards: today/month honour mode+model filters but not the date range
    mm = [e for e in data if _match(e, "", "", mode, model)]
    t_es = [e for e in mm if e["ts"][:10] == today]
    m_es = [e for e in mm if e["ts"][:7] == month]
    m_sum = _sum(m_es)
    runs = len({e.get("batch_rid") or e.get("rid") or e["ts"] for e in m_es})
    cost = m_sum["input"] / 1e6 * st["token_rate_input"] + m_sum["output"] / 1e6 * st["token_rate_output"]
    t_sum = _sum(t_es)
    lim = st["token_daily_limit"] or 1
    days = []
    for k in range(13, -1, -1):
        d = (now.date() - timedelta(days=k)).isoformat()
        days.append({"date": d, "total": sum(e["total"] for e in mm if e["ts"][:10] == d)})
    by = {a: 0 for a in ACTIONS[:4]}
    for e in sel:
        by[e["action"]] = by.get(e["action"], 0) + e["total"]
    tot = sum(by.values()) or 0
    breakdown = [{"action": a, "total": v, "pct": round(v * 100 / tot, 1) if tot else 0} for a, v in by.items()]
    # rows: single runs as-is, batches grouped with item breakdown
    rows, groups = [], {}
    for e in sorted(sel, key=lambda x: x["ts"], reverse=True):
        if e.get("mode") == "batch":
            key = e.get("batch_id") or e.get("batch_rid")
            g = groups.get(key)
            if not g:
                g = groups[key] = {"kind": "batch", "rid": e.get("batch_rid") or "BATCH", "batch_id": e.get("batch_id"),
                                   "mode": "batch", "action": "Batch generate", "models": set(), "items": [],
                                   "input": 0, "output": 0, "total": 0, "ts": e["ts"]}
                rows.append(g)
            g["items"].append({k: e.get(k) for k in ("id", "rid", "story_id", "title", "source", "action", "model",
                                                      "input", "output", "total", "ts")})
            if e.get("template"):
                g["items"][-1]["template"] = e["template"]
            g["models"].add(e["model"])
            for k in ("input", "output", "total"): g[k] += e[k]
        else:
            rows.append({"kind": "run", **{k: e.get(k) for k in ("id", "rid", "story_id", "title", "source", "mode", "action",
                                                                   "model", "input", "output", "total", "ts")}})
            if e.get("template"):
                rows[-1]["template"] = e["template"]
    for g in groups.values():
        g["model"] = ", ".join(sorted(g.pop("models")))
        srcs = sorted({i["source"] for i in g["items"] if i["source"]})
        story_ids = list(dict.fromkeys(i["story_id"] for i in g["items"] if i["story_id"]))
        g["tickets"] = len({i["rid"] or i["story_id"] for i in g["items"]})
        g["ids"] = [i["id"] for i in g["items"] if i.get("id")]
        g["source_label"] = f"{g['tickets']} item(s) ({', '.join(story_ids[:4])}{'…' if len(story_ids) > 4 else ''})" + (f" · {' + '.join(srcs)}" if srcs else "")
    total_rows = len(rows)
    try:
        page = int(page or 1)
    except (TypeError, ValueError):
        page = 1
    try:
        ps = int(page_size or 0)
    except (TypeError, ValueError):
        ps = 0
    if ps and ps not in PAGE_SIZES:
        ps = 25
    if ps:
        pages = max(1, (total_rows + ps - 1) // ps) if total_rows else 1
        page = min(max(1, page), pages)
        start = (page - 1) * ps
        rows = rows[start:start + ps]
    else:
        page, pages = 1, 1
    return {"settings": st,
            "today": {**t_sum, "pct": round(t_sum["total"] * 100 / lim, 1)},
            "month": {**m_sum, "runs": runs, "label": now.strftime("%b"), "cost": round(cost, 4)},
            "daily": days, "breakdown": breakdown, "rows": rows,
            "models": sorted({e["model"] for e in data}), "count": len(sel),
            "total_rows": total_rows, "page": page, "page_size": ps or total_rows, "pages": pages if ps else 1}


def export_csv(d_from="", d_to="", mode="", model="") -> str:
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(["time", "batch_id", "run_id", "ticket", "title", "source", "mode", "action", "model",
                "input_tokens", "output_tokens", "total_tokens", "mock"])
    for e in sorted((e for e in _load() if _match(e, d_from, d_to, mode, model)), key=lambda x: x["ts"]):
        w.writerow([e["ts"], e.get("batch_rid", ""), e.get("rid", ""), e.get("story_id", ""), e.get("title", ""),
                    e.get("source", ""), e.get("mode", ""), e["action"], e["model"], e["input"], e["output"], e["total"],
                    "yes" if e.get("mock") else ""])
    return buf.getvalue()


def _victims(data: List[Dict[str, Any]], ids=None, before: str = "") -> List[Dict[str, Any]]:
    if ids:
        want = {str(x).strip() for x in ids if str(x).strip()}
        return [e for e in data if isinstance(e, dict) and e.get("id") in want]
    if before:
        day = str(before).strip()[:10]
        if len(day) != 10 or day[4] != "-" or day[7] != "-":
            raise ValueError("before must be YYYY-MM-DD.")
        return [e for e in data if isinstance(e, dict) and (e.get("ts") or "")[:10] < day]
    return []


def delete_entries(*, ids=None, before: str = "", confirm: bool = False) -> Dict[str, Any]:
    """Preview (confirm=False) or apply a delete. Backs up the ledger before a real delete.
    Does not modify reports/gemini_usage.json."""
    with _LOCK:
        data = _read()
        if _ensure_ids(data):
            try:
                _write(data)
            except Exception:
                log.exception("token usage id backfill write failed")
        vic = _victims(data, ids, before)
        tokens = sum(int(e.get("total") or 0) for e in vic)
        out = {"count": len(vic), "tokens": tokens, "ids": [e.get("id") for e in vic], "deleted": 0}
        if not confirm or not vic:
            return out
        _backup()
        gone = {e.get("id") for e in vic}
        _write([e for e in data if not (isinstance(e, dict) and e.get("id") in gone)])
        out["deleted"] = len(vic)
        return out
