"""Dashboard (additive, read-only): GET /api/dashboard aggregates real data from the Test Case Repo,
Test Runs (cycles / executions / defect keys) and token usage. Nothing is written."""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Query

from . import test_repo, test_runs, token_usage

log = logging.getLogger("atg")
router = APIRouter()
RES = ["Pass", "Fail", "Blocked", "Not run"]


def _day(ts) -> str:
    return str(ts or "")[:10]


def _in(ts, d_from, d_to) -> bool:
    d = _day(ts)
    if d_from and (not d or d < d_from):
        return False
    if d_to and (not d or d > d_to):
        return False
    return True


def _bucket(st: str) -> str:
    return st if st in ("Pass", "Fail", "Blocked") else "Not run"


@router.get("/api/dashboard")
def dashboard(cycle: str = "", story: str = "", folder: str = "",
              d_from: str = Query("", alias="from"), d_to: str = Query("", alias="to")):
    return build(cycle, story, folder, (d_from or "")[:10], (d_to or "")[:10])


def _token_summary(tu, d_from: str = "", d_to: str = "") -> Dict[str, Any]:
    """Additive dashboard cards: per-model cost, usage by provider/model, near-limit banners.

    Existing `tiles` and `ai.cost` stay on the workspace-wide global rates. Near-limit
    warnings fire only when the user has set a daily token or cost cap in Settings
    (blank = no warning). Costs here use recorded per-model rates when present.
    """
    from datetime import datetime, timedelta
    from . import token_registry as reg
    now = datetime.now()
    today = now.date().isoformat()
    start = d_from or (now.date() - timedelta(days=13)).isoformat()
    end = d_to or today
    window, today_rows = [], []
    for e in tu or []:
        day = (e.get("ts") or "")[:10]
        if not day:
            continue
        if start <= day <= end:
            window.append(e)
        if day == today:
            today_rows.append(e)

    def _agg(rows):
        by: Dict[str, Any] = {}
        inp = out = tot = calls = 0
        cost = 0.0
        for e in rows:
            i, o, n = int(e.get("input") or 0), int(e.get("output") or 0), int(e.get("total") or 0)
            c = float(e.get("actual_cost") or 0)
            inp += i; out += o; tot += n; cost += c; calls += 1
            pid = (e.get("provider") or "") or "unknown"
            mid = e.get("model") or ""
            bp = by.setdefault(pid, {"provider": pid, "input": 0, "output": 0, "total": 0, "cost": 0.0, "calls": 0, "models": {}})
            bp["input"] += i; bp["output"] += o; bp["total"] += n; bp["cost"] += c; bp["calls"] += 1
            bm = bp["models"].setdefault(mid, {"model": mid, "input": 0, "output": 0, "total": 0, "cost": 0.0, "calls": 0})
            bm["input"] += i; bm["output"] += o; bm["total"] += n; bm["cost"] += c; bm["calls"] += 1
        share = tot or 0
        providers = []
        for pid, v in sorted(by.items(), key=lambda kv: -kv[1]["total"]):
            models = []
            for mid, m in sorted((v["models"] or {}).items(), key=lambda kv: -kv[1]["total"]):
                models.append({**m, "cost": round(m["cost"], 6),
                               "pct": round(m["total"] * 100 / share, 1) if share else 0})
            providers.append({"provider": pid, "input": v["input"], "output": v["output"],
                              "total": v["total"], "cost": round(v["cost"], 6), "calls": v["calls"],
                              "pct": round(v["total"] * 100 / share, 1) if share else 0, "models": models})
        return {"input": inp, "output": out, "total": tot, "cost": round(cost, 6), "calls": calls,
                "providers": providers}

    period = _agg(window)
    today_agg = _agg(today_rows)
    limits = reg.get_limits()
    near = []
    today_by = {p["provider"]: p for p in today_agg["providers"]}
    for pid, lim in limits.items():
        used = today_by.get(pid) or {"total": 0, "cost": 0.0}
        if lim.get("daily_tokens"):
            pct = used["total"] * 100 / lim["daily_tokens"] if lim["daily_tokens"] else 0
            if pct >= 80:
                near.append({"provider": pid, "metric": "tokens", "used": used["total"],
                             "limit": lim["daily_tokens"], "pct": round(pct, 1),
                             "href": f"#tokens?provider={pid}"})
        if lim.get("daily_cost"):
            pct = used["cost"] * 100 / lim["daily_cost"] if lim["daily_cost"] else 0
            if pct >= 80:
                near.append({"provider": pid, "metric": "cost", "used": round(used["cost"], 6),
                             "limit": lim["daily_cost"], "pct": round(pct, 1),
                             "href": f"#tokens?provider={pid}"})
    return {
        "from": start, "to": end, "today": today,
        "period": period, "today_usage": today_agg,
        "near_limit": near,
        "example_prices": True,
        "note": "Per-model costs use example prices from Settings until you edit them. Existing AI token totals still use the workspace-wide global rates.",
    }


def build(cycle: str = "", story: str = "", folder: str = "", d_from: str = "", d_to: str = "") -> Dict[str, Any]:
    repo = test_repo._load()
    runs = test_runs._load()
    folders = {f["id"]: f for f in repo["folders"]}
    sub = set(test_repo._desc_ids(repo, folder)) | {folder} if folder else None
    all_cases = repo["cases"]

    def case_ok(c):
        if story and (c.get("story") or "") != story:
            return False
        if sub is not None and c.get("folder_id") not in sub:
            return False
        return True

    cases = [c for c in all_cases if case_ok(c)]
    byid = {c["id"]: c for c in all_cases}
    # Deleted cases with execution history are soft-deleted as Archived; match the Repo
    # default and leave them out of inventory tiles / Section 1. Cycle history still
    # sees them via byid + case_ok (story/folder only).
    live = [c for c in cases if c.get("status") != "Archived"]
    live_statuses = [s for s in test_repo.STATUSES if s != "Archived"]

    # (1) cases per story / per folder by status (active cases only)
    def group(keyf):
        g: Dict[str, Dict[str, Any]] = {}
        for c in live:
            k, label = keyf(c)
            r = g.setdefault(k, {"key": k, "label": label, "total": 0, **{s: 0 for s in live_statuses}})
            r["total"] += 1
            st = c.get("status") if c.get("status") in live_statuses else "Draft"
            r[st] += 1
        return sorted(g.values(), key=lambda r: (r["key"] == "", r["label"]))
    by_story = group(lambda c: (c.get("story") or "", c.get("story") or "Not linked to a story"))
    by_folder = group(lambda c: (c.get("folder_id") or "", test_repo._folder_path(repo, c.get("folder_id")) or "(no folder)"))

    # cycles (filtered by cycle id; items filtered by story/folder)
    cyc_all = [c for c in runs["cycles"] if c.get("status") != "Archived"]
    cyc = [c for c in cyc_all if not cycle or c["id"] == cycle]
    execs = [e for e in runs["executions"] if _in(e.get("ts"), d_from, d_to)]
    progress, results, failed, testers = [], [], [], {}
    jira = test_repo._jira_base()
    for c in cyc:
        items = [it for it in c.get("items", []) if it["case_id"] in byid and case_ok(byid[it["case_id"]])]
        if d_from or d_to:   # date range: only count results last run inside the range
            cnt = {k: 0 for k in RES}
            for it in items:
                cnt[_bucket(it.get("status")) if it.get("last_run") and _in(it["last_run"], d_from, d_to) else "Not run"] += 1
        else:
            cnt = {k: 0 for k in RES}
            for it in items:
                cnt[_bucket(it.get("status"))] += 1
        tot = len(items)
        ex = tot - cnt["Not run"]
        base = {"id": c["id"], "name": c.get("name", ""), "start": c.get("start", ""), "end": c.get("end", ""), "status": c.get("status", "")}
        progress.append({**base, "total": tot, "executed": ex, "passed": cnt["Pass"], "failed": cnt["Fail"],
                         "blocked": cnt["Blocked"], "not_run": cnt["Not run"]})
        results.append({**base, "Pass": cnt["Pass"], "Fail": cnt["Fail"], "Blocked": cnt["Blocked"], "Not run": cnt["Not run"], "total": tot})
        for it in items:
            if it.get("status") != "Fail" or ((d_from or d_to) and not _in(it.get("last_run"), d_from, d_to)):
                continue
            cs = byid[it["case_id"]]
            last = next((e for e in reversed(runs["executions"]) if e.get("cycle_id") == c["id"] and e.get("item_key") == it["key"]), {})
            failed.append({"case_id": cs["id"], "title": cs.get("title", ""), "story": cs.get("story", ""), "cycle_id": c["id"],
                           "cycle": c.get("name", ""), "failed_on": it.get("last_run", ""), "tester": last.get("tester") or it.get("assignee", ""),
                           "defects": list(it.get("defects") or [])})
    cyc_ids = {c["id"] for c in cyc}
    for e in execs:
        if e.get("cycle_id") not in cyc_ids or e.get("case_id") not in byid or not case_ok(byid[e["case_id"]]):
            continue
        t = testers.setdefault(e.get("tester") or "(unassigned)", {"tester": e.get("tester") or "(unassigned)", "executed": 0, "passed": 0, "failed": 0, "blocked": 0})
        st = e.get("status")
        if st == "Not run":
            continue
        t["executed"] += 1
        if st in ("Pass", "Fail", "Blocked"):
            t[{"Pass": "passed", "Fail": "failed", "Blocked": "blocked"}[st]] += 1
    failed.sort(key=lambda r: r["failed_on"], reverse=True)

    # (6) AI vs manual + token usage per run / story
    src = {s: 0 for s in test_repo.SOURCES}
    for c in live:
        src[c.get("source") if c.get("source") in src else "Manual"] += 1
    try:
        tu = token_usage._load()
        st = token_usage.get_settings()
    except Exception:
        log.exception("dashboard token usage load failed")
        tu, st = [], {"token_rate_input": 0, "token_rate_output": 0}
    ai_by_story: Dict[str, int] = {}
    for c in live:
        if c.get("source") == "AI":
            ai_by_story[c.get("story") or ""] = ai_by_story.get(c.get("story") or "", 0) + 1
    tok: Dict[str, Dict[str, Any]] = {}
    for e in tu:
        if not _in(e.get("ts"), d_from, d_to) or (story and e.get("story_id") != story):
            continue
        k = e.get("story_id") or e.get("rid") or "(no story)"
        r = tok.setdefault(k, {"story": e.get("story_id") or "", "title": e.get("title") or "", "runs": set(), "models": set(),
                               "last": "", "input": 0, "output": 0, "total": 0})
        r["runs"].add(e.get("batch_rid") or e.get("rid") or e.get("ts"))
        r["models"].add(e.get("model") or "")
        r["last"] = max(r["last"], e.get("ts") or "")
        r["title"] = r["title"] or e.get("title") or ""
        for f in ("input", "output", "total"):
            r[f] += int(e.get(f) or 0)
    ri, ro = float(st.get("token_rate_input") or 0), float(st.get("token_rate_output") or 0)
    tokens = []
    for k, r in tok.items():
        tokens.append({"key": k, "story": r["story"], "title": r["title"], "runs": len(r["runs"]), "model": ", ".join(sorted(m for m in r["models"] if m)),
                       "last": r["last"], "input": r["input"], "output": r["output"], "total": r["total"],
                       "cases": ai_by_story.get(r["story"], 0) if r["story"] else 0,
                       "cost": round(r["input"] / 1e6 * ri + r["output"] / 1e6 * ro, 4)})
    tokens.sort(key=lambda r: r["last"], reverse=True)

    token_summary = _token_summary(tu, d_from, d_to)

    # tiles: pass rate across active cycles
    act = [p for p in progress if p.get("status") != "Archived"]
    ex_all = sum(p["executed"] for p in act)
    pas = sum(p["passed"] for p in act)
    return {"ok": True,
            "filters": {"cycle": cycle, "story": story, "folder": folder, "from": d_from, "to": d_to},
            "options": {"cycles": [{"id": c["id"], "name": c.get("name", "")} for c in cyc_all],
                        "stories": sorted({c.get("story") for c in all_cases if c.get("story")}),
                        "folders": [{"id": f["id"], "name": test_repo._folder_path(repo, f["id"])} for f in folders.values()]},
            "tiles": {"total_cases": len(live), "stories": len({c.get("story") for c in live if c.get("story")}),
                      "active_cycles": len(act), "active_cycle_names": [p["name"] for p in act][:4],
                      "pass_rate": round(pas * 100 / ex_all, 1) if ex_all else None, "passed": pas, "executed": ex_all,
                      "failed_no_defect": sum(1 for f in failed if not f["defects"]), "failed": len(failed)},
            "cases": {"by_story": by_story, "by_folder": by_folder, "statuses": live_statuses},
            "progress": progress, "results": results,
            "failed": failed, "jira_base": jira,
            "testers": sorted(testers.values(), key=lambda t: -t["executed"]),
            "ai": {"sources": src, "tokens": tokens, "rates": {"input": ri, "output": ro},
                   "total_tokens": sum(t["total"] for t in tokens), "cost": round(sum(t["cost"] for t in tokens), 4)},
            "token_summary": token_summary}
