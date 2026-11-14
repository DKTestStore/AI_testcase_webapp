"""Token usage ledger (additive feature). Stored in SQLite (`token_ledger` in backend/app.db).
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
ACTIONS = ["Generate", "Regenerate", "Coverage check", "AC generate", "AI review", "Help chat", "Test data", "Boost coverage"]
DEFAULTS = {"token_daily_limit": 1_000_000, "token_rate_input": 0.30, "token_rate_output": 2.50}


def _new_id() -> str:
    return "TU-" + uuid.uuid4().hex[:12]


def _read() -> List[Dict[str, Any]]:
    from .db import load_token_ledger
    return load_token_ledger()


def _write(data: List[Dict[str, Any]]) -> None:
    from .db import save_token_ledger
    save_token_ledger(data)


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
    """Copy the current ledger into reports/ before a delete. Keeps a rolling latest + last few stamps.
    Writes the live SQLite ledger as JSON (same list shape as the old file). Does not touch gemini_usage.json."""
    data = _read()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, indent=1).encode("utf-8")
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
           mode: str = "", batch: Optional[Dict[str, Any]] = None, item: Optional[Dict[str, Any]] = None,
           estimate: Optional[Dict[str, Any]] = None) -> None:
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
        provider = u.get("provider") or u.get("model") or run.get("model") or ""
        model_name = u.get("model_name") or u.get("model") or run.get("model_name") or "gemini"
        est = estimate or u.get("estimate") or {}
        try:
            from . import token_registry as _reg
            priced = _reg.cost_for(inp, out, provider, model_name)
        except Exception:
            priced = {"cost": 0.0, "rate_source": "legacy_global"}
        rate_source = est.get("rate_source") or priced.get("rate_source") or "model"
        if rate_source not in ("model", "legacy_global"):
            rate_source = "legacy_global"
        # New rows prefer the per-model registry when a matching model exists; otherwise legacy global rates.
        if priced.get("rate_source") == "legacy_global" and not est.get("rate_source"):
            rate_source = "legacy_global"
            st = get_settings()
            actual_cost = inp / 1e6 * st["token_rate_input"] + out / 1e6 * st["token_rate_output"]
        else:
            actual_cost = float(priced.get("cost") or 0)
        ent = {"id": _new_id(), "ts": datetime.now().isoformat(timespec="seconds"), "action": action, "mode": mode,
               "rid": run.get("rid") or "", "run_id": run.get("run_id") or "",
               "batch_rid": (batch or {}).get("rid") or "", "batch_id": (batch or {}).get("batch_id") or "",
               "story_id": story, "title": title, "source": src,
               "model": model_name, "mock": bool(u.get("mock")) or u.get("model_name") == "mock",
               "input": inp, "output": out, "total": tot, "provider": provider,
               "est_input": int(est.get("est_input") or est.get("tokens") or 0),
               "est_output": int(est.get("est_output") or 0),
               "est_cost": float(est.get("est_cost") or 0),
               "actual_cost": float(actual_cost),
               "rate_source": rate_source}
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
    from .db import update_app_settings
    update_app_settings(clean)
    return get_settings()


# ---- queries --------------------------------------------------------------- #
def _match(e, d_from, d_to, mode, model, provider="", action=""):
    day = (e.get("ts") or "")[:10]
    if d_from and day < d_from: return False
    if d_to and day > d_to: return False
    if mode and mode != "all" and e.get("mode") != mode: return False
    if model and model != "all" and e.get("model") != model: return False
    if provider and provider != "all" and (e.get("provider") or "").lower() != str(provider).lower():
        return False
    if action and action != "all" and (e.get("action") or "") != action:
        return False
    return True


def _sum(es):
    i = sum(e["input"] for e in es); o = sum(e["output"] for e in es)
    return {"input": i, "output": o, "total": sum(e["total"] for e in es)}


def query(d_from="", d_to="", mode="", model="", page: int = 1, page_size: int = 0,
          provider="", action="") -> Dict[str, Any]:
    data = _load()
    st = get_settings()
    now = datetime.now()
    today = now.date().isoformat(); month = today[:7]
    sel = [e for e in data if _match(e, d_from, d_to, mode, model, provider, action)]
    # cards: today/month honour mode+model (+ provider/action) filters but not the date range
    mm = [e for e in data if _match(e, "", "", mode, model, provider, action)]
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
                                                      "provider", "input", "output", "total", "ts",
                                                      "est_input", "est_output", "est_cost", "actual_cost", "rate_source")})
            if e.get("template"):
                g["items"][-1]["template"] = e["template"]
            g["models"].add(e["model"])
            for k in ("input", "output", "total"): g[k] += e[k]
        else:
            rows.append({"kind": "run", **{k: e.get(k) for k in ("id", "rid", "story_id", "title", "source", "mode", "action",
                                                                   "model", "provider", "input", "output", "total", "ts",
                                                                   "est_input", "est_output", "est_cost", "actual_cost", "rate_source")}})
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
    # Additive: per-provider / per-model share and estimate accuracy (does not replace action breakdown).
    by_prov, by_model = {}, {}
    acc = {}
    for e in sel:
        pid = (e.get("provider") or "") or "unknown"
        mid = e.get("model") or ""
        bp = by_prov.setdefault(pid, {"provider": pid, "input": 0, "output": 0, "total": 0, "cost": 0.0, "calls": 0, "models": {}})
        bp["input"] += int(e.get("input") or 0); bp["output"] += int(e.get("output") or 0)
        bp["total"] += int(e.get("total") or 0); bp["calls"] += 1
        bp["cost"] += float(e.get("actual_cost") or 0)
        bm = bp["models"].setdefault(mid, {"model": mid, "input": 0, "output": 0, "total": 0, "cost": 0.0, "calls": 0})
        bm["input"] += int(e.get("input") or 0); bm["output"] += int(e.get("output") or 0)
        bm["total"] += int(e.get("total") or 0); bm["calls"] += 1
        bm["cost"] += float(e.get("actual_cost") or 0)
        actn = e.get("action") or ""
        a = acc.setdefault(actn, {"action": actn, "est": 0, "actual": 0, "calls": 0})
        a["est"] += int(e.get("est_input") or 0) + int(e.get("est_output") or 0)
        a["actual"] += int(e.get("total") or 0)
        a["calls"] += 1
    tot_p = sum(v["total"] for v in by_prov.values()) or 0
    def _share(v, tot):
        return round(v * 100 / tot, 1) if tot else 0
    breakdown_providers = []
    for pid, v in sorted(by_prov.items(), key=lambda kv: -kv[1]["total"]):
        models = []
        for mid, m in sorted((v["models"] or {}).items(), key=lambda kv: -kv[1]["total"]):
            models.append({**{k: m[k] for k in ("model", "input", "output", "total", "cost", "calls")},
                           "pct": _share(m["total"], tot_p), "cost": round(m["cost"], 6)})
        breakdown_providers.append({"provider": pid, "input": v["input"], "output": v["output"],
                                    "total": v["total"], "cost": round(v["cost"], 6), "calls": v["calls"],
                                    "pct": _share(v["total"], tot_p), "models": models})
    accuracy = []
    for actn, a in acc.items():
        var = None
        if a["est"]:
            var = round((a["actual"] - a["est"]) * 100 / a["est"], 1)
        accuracy.append({**a, "variance_pct": var})
    # month cost at per-model rates when recorded; existing `cost` still uses global settings rates
    model_cost = sum(float(e.get("actual_cost") or 0) for e in m_es)
    providers = sorted({(e.get("provider") or "") for e in data if e.get("provider")})
    actions = sorted({(e.get("action") or "") for e in data if e.get("action")})
    return {"settings": st,
            "today": {**t_sum, "pct": round(t_sum["total"] * 100 / lim, 1)},
            "month": {**m_sum, "runs": runs, "label": now.strftime("%b"), "cost": round(cost, 4),
                      "cost_model": round(model_cost, 4)},
            "daily": days, "breakdown": breakdown, "rows": rows,
            "models": sorted({e["model"] for e in data if e.get("model")}), "count": len(sel),
            "total_rows": total_rows, "page": page, "page_size": ps or total_rows, "pages": pages if ps else 1,
            "providers": providers, "actions": actions,
            "breakdown_providers": breakdown_providers, "accuracy": accuracy}


def export_csv(d_from="", d_to="", mode="", model="", provider="", action="") -> str:
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(["time", "batch_id", "run_id", "ticket", "title", "source", "mode", "action", "model",
                "input_tokens", "output_tokens", "total_tokens", "mock",
                "provider", "est_input", "est_output", "est_cost", "actual_cost", "rate_source"])
    for e in sorted((e for e in _load() if _match(e, d_from, d_to, mode, model, provider, action)), key=lambda x: x["ts"]):
        w.writerow([e["ts"], e.get("batch_rid", ""), e.get("rid", ""), e.get("story_id", ""), e.get("title", ""),
                    e.get("source", ""), e.get("mode", ""), e["action"], e["model"], e["input"], e["output"], e["total"],
                    "yes" if e.get("mock") else "",
                    e.get("provider", ""), e.get("est_input") or 0, e.get("est_output") or 0,
                    e.get("est_cost") or 0, e.get("actual_cost") or 0, e.get("rate_source") or "legacy_global"])
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
