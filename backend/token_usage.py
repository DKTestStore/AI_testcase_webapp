"""Token usage ledger (additive feature). Stored in backend/token_usage.json (gitignored).
Recording must never break generation: every public writer swallows its own errors."""
import csv
import io
import json
import logging
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import settings_store

log = logging.getLogger("atg.tokens")
PATH = Path(__file__).resolve().parent / "token_usage.json"
_LOCK = threading.Lock()
MAX_ENTRIES = 20000
ACTIONS = ["Generate", "Regenerate", "Coverage check", "AC generate", "AI review"]
DEFAULTS = {"token_daily_limit": 1_000_000, "token_rate_input": 0.30, "token_rate_output": 2.50}


def _load() -> List[Dict[str, Any]]:
    try:
        d = json.loads(PATH.read_text(encoding="utf-8"))
        return d if isinstance(d, list) else []
    except Exception:
        return []


def record(*, action: str, usage: Optional[Dict[str, Any]], run: Optional[Dict[str, Any]] = None,
           mode: str = "", batch: Optional[Dict[str, Any]] = None, item: Optional[Dict[str, Any]] = None) -> None:
    try:
        u = usage or {}
        if u.get("model") not in (None, "gemini"):
            return  # only Gemini calls are tracked
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
        ent = {"ts": datetime.now().isoformat(timespec="seconds"), "action": action, "mode": mode,
               "rid": run.get("rid") or "", "run_id": run.get("run_id") or "",
               "batch_rid": (batch or {}).get("rid") or "", "batch_id": (batch or {}).get("batch_id") or "",
               "story_id": story, "title": title, "source": src,
               "model": u.get("model_name") or "gemini", "mock": bool(u.get("mock")) or u.get("model_name") == "mock",
               "input": inp, "output": out, "total": tot}
        if u.get("template"):   # prompt templates: one row per template call
            ent["template"] = str(u["template"])[:80]
        with _LOCK:
            data = _load()
            data.append(ent)
            data = data[-MAX_ENTRIES:]
            tmp = PATH.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
            tmp.replace(PATH)
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


def query(d_from="", d_to="", mode="", model="") -> Dict[str, Any]:
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
            g["items"].append({k: e.get(k) for k in ("rid", "story_id", "title", "source", "action", "model",
                                                      "input", "output", "total", "ts")})
            if e.get("template"):
                g["items"][-1]["template"] = e["template"]
            g["models"].add(e["model"])
            for k in ("input", "output", "total"): g[k] += e[k]
        else:
            rows.append({"kind": "run", **{k: e.get(k) for k in ("rid", "story_id", "title", "source", "mode", "action",
                                                                   "model", "input", "output", "total", "ts")}})
            if e.get("template"):
                rows[-1]["template"] = e["template"]
    for g in groups.values():
        g["model"] = ", ".join(sorted(g.pop("models")))
        srcs = sorted({i["source"] for i in g["items"] if i["source"]})
        ids = list(dict.fromkeys(i["story_id"] for i in g["items"] if i["story_id"]))
        g["tickets"] = len({i["rid"] or i["story_id"] for i in g["items"]})
        g["source_label"] = f"{g['tickets']} item(s) ({', '.join(ids[:4])}{'…' if len(ids) > 4 else ''})" + (f" · {' + '.join(srcs)}" if srcs else "")
    return {"settings": st,
            "today": {**t_sum, "pct": round(t_sum["total"] * 100 / lim, 1)},
            "month": {**m_sum, "runs": runs, "label": now.strftime("%b"), "cost": round(cost, 4)},
            "daily": days, "breakdown": breakdown, "rows": rows,
            "models": sorted({e["model"] for e in data}), "count": len(sel)}


def export_csv(d_from="", d_to="", mode="", model="") -> str:
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(["time", "batch_id", "run_id", "ticket", "title", "source", "mode", "action", "model",
                "input_tokens", "output_tokens", "total_tokens", "mock"])
    for e in sorted((e for e in _load() if _match(e, d_from, d_to, mode, model)), key=lambda x: x["ts"]):
        w.writerow([e["ts"], e.get("batch_rid", ""), e.get("rid", ""), e.get("story_id", ""), e.get("title", ""),
                    e.get("source", ""), e.get("mode", ""), e["action"], e["model"], e["input"], e["output"], e["total"],
                    "yes" if e.get("mock") else ""])
    return buf.getvalue()
