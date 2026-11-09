"""Requirement Repo + Projects (additive feature).

Storage: backend/test_repo/requirements.json
  {
    "pseq": int, "rseq": int, "fseq": int,
    "projects": [...],
    "folders": [...],          # requirement folders (project-scoped)
    "requirements": [...],     # REQ-####
    "links": [{"requirement_id","case_id"}]   # many-to-many
  }

Existing test cases keep their free-text `story` field untouched.
Default project key "Local" holds legacy/unscoped data.
Delete = archive (status Archived); archived hidden by default.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Query

from . import test_repo, test_runs
from .services import ServiceError
from .test_repo import _s, locked, load_json, now, write_json

REQ_FILE = test_repo.DATA_DIR / "requirements.json"
router = APIRouter()

REQ_TYPES = ["Story", "Epic", "Feature"]
REQ_SOURCES = ["Manual", "Jira"]
REQ_STATUSES = ["Draft", "Ready", "Approved", "Archived"]
LOCAL_KEY = "Local"


def _empty() -> Dict[str, Any]:
    return {"pseq": 0, "rseq": 0, "fseq": 0, "projects": [], "folders": [], "requirements": [], "links": []}


def _load() -> Dict[str, Any]:
    d = load_json(REQ_FILE, {})
    for k, v in _empty().items():
        d.setdefault(k, v if not isinstance(v, list) else list(v) if not d.get(k) else d[k])
    d.setdefault("pseq", 0); d.setdefault("rseq", 0); d.setdefault("fseq", 0)
    d.setdefault("projects", []); d.setdefault("folders", [])
    d.setdefault("requirements", []); d.setdefault("links", [])
    _ensure_local(d)
    return d


def _save(d: Dict[str, Any]) -> None:
    write_json(REQ_FILE, d)


def _ensure_local(d: Dict[str, Any]) -> None:
    if any((p.get("key") or "").upper() == LOCAL_KEY.upper() for p in d["projects"]):
        return
    d["pseq"] += 1
    d["projects"].append({
        "id": f"PRJ-{d['pseq']:04d}",
        "key": LOCAL_KEY,
        "name": "Unscoped / legacy",
        "description": "Default bucket for cases without a project mapping.",
        "jira_project_key": "",
        "qtest_project_id": "",
        "zephyr_project_key": "",
        "created": now(),
        "updated": now(),
        "system": True,
    })


def _proj(d, pid: str = "", key: str = "") -> Dict[str, Any]:
    if pid:
        p = next((x for x in d["projects"] if x["id"] == pid), None)
        if p:
            return p
    if key:
        p = next((x for x in d["projects"] if (x.get("key") or "").upper() == key.upper()), None)
        if p:
            return p
    raise ServiceError("Project not found.", 404)


def _req(d, rid: str) -> Dict[str, Any]:
    r = next((x for x in d["requirements"] if x["id"] == rid), None)
    if not r:
        raise ServiceError("Requirement not found.", 404)
    return r


def _folder(d, fid: str):
    return next((f for f in d["folders"] if f["id"] == fid), None)


def _norm_key(k: str) -> str:
    k = re.sub(r"[^A-Za-z0-9]", "", (k or "").strip())
    if not k:
        raise ServiceError("Project key is required (letters/digits, e.g. EXPO).")
    return k.upper()[:20]


def _acs(raw) -> List[str]:
    if isinstance(raw, str):
        parts = re.split(r"[\n\r]+|;", raw)
        return [_s(p, 500) for p in parts if _s(p)][:50]
    return [_s(a, 500) for a in (raw or []) if _s(a)][:50]


def _event(r: Dict[str, Any], typ: str, text: str = "", **meta) -> None:
    ev = {"ts": now(), "type": typ, "text": _s(text, 500)}
    ev.update({k: v for k, v in meta.items() if v not in (None, "")})
    act = r.setdefault("activity", [])
    act.append(ev)
    if len(act) > 100:
        del act[: len(act) - 100]


# ------------------------------------------------------------------ coverage helpers

def _case_by_id() -> Dict[str, Dict[str, Any]]:
    return {c["id"]: c for c in test_repo._load()["cases"]}


def _last_result_for(case_id: str) -> Dict[str, str]:
    """Best-effort last cycle result for a case from test_runs data."""
    try:
        rd = test_runs._load()
    except Exception:
        return {"result": "", "cycle_id": "", "cycle_name": ""}
    # prefer most recent execution
    exs = [e for e in rd.get("executions", []) if e.get("case_id") == case_id]
    if exs:
        exs.sort(key=lambda e: e.get("ts") or e.get("created") or "", reverse=True)
        e = exs[0]
        cid = e.get("cycle_id", "")
        name = next((c["name"] for c in rd.get("cycles", []) if c["id"] == cid), "")
        return {"result": e.get("status") or e.get("result") or "", "cycle_id": cid, "cycle_name": name}
    # fallback: item status on cycles
    best = None
    for c in rd.get("cycles", []):
        if c.get("status") == "Archived":
            continue
        for it in c.get("items", []) or []:
            if it.get("case_id") == case_id and it.get("status") and it.get("status") != "Not run":
                cand = (it.get("last_run") or c.get("created") or "", c, it)
                if not best or cand[0] > best[0]:
                    best = cand
    if best:
        _, c, it = best
        return {"result": it.get("status", ""), "cycle_id": c["id"], "cycle_name": c.get("name", "")}
    return {"result": "", "cycle_id": "", "cycle_name": ""}


def _link_ids(d, rid: str) -> List[str]:
    return [l["case_id"] for l in d["links"] if l.get("requirement_id") == rid]


def _coverage(d, r: Dict[str, Any], cases: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Coverage: % of linked non-archived cases that are Ready or last result Pass."""
    cases = cases or _case_by_id()
    ids = _link_ids(d, r["id"])
    linked = [cases[i] for i in ids if i in cases and cases[i].get("status") != "Archived"]
    ready = [c for c in linked if c.get("status") == "Ready"]
    last = {"result": "", "cycle_id": "", "cycle_name": ""}
    good = set()
    for c in linked:
        lr = _last_result_for(c["id"])
        if lr.get("result"):
            if not last["result"] or (lr.get("cycle_id") or "") >= (last.get("cycle_id") or ""):
                last = lr
        if c.get("status") == "Ready" or lr.get("result") == "Pass":
            good.add(c["id"])
    n = len(linked)
    pct = int(round(100 * len(good) / n)) if n else 0
    gap = n == 0
    return {
        "linked": n,
        "ready": len(ready),
        "coverage_pct": pct,
        "last_result": last.get("result") or ("Gap" if gap else ""),
        "last_cycle_id": last.get("cycle_id", ""),
        "last_cycle_name": last.get("cycle_name", ""),
        "gap": gap,
        "case_ids": ids,
    }


def _summary(d, r: Dict[str, Any], cases=None) -> Dict[str, Any]:
    cov = _coverage(d, r, cases)
    return {
        "id": r["id"],
        "project_id": r.get("project_id", ""),
        "folder_id": r.get("folder_id", ""),
        "title": r.get("title", ""),
        "type": r.get("type", "Story"),
        "source": r.get("source", "Manual"),
        "jira_key": r.get("jira_key", ""),
        "priority": r.get("priority", "Medium"),
        "status": r.get("status", "Draft"),
        "updated": r.get("updated", ""),
        "created": r.get("created", ""),
        **cov,
    }


# ================================================================== PROJECTS

@router.get("/api/projects")
def list_projects():
    d = _load()
    cases = _case_by_id()
    out = []
    for p in d["projects"]:
        reqs = [r for r in d["requirements"] if r.get("project_id") == p["id"] and r.get("status") != "Archived"]
        linked_cases = set()
        for r in reqs:
            linked_cases.update(_link_ids(d, r["id"]))
        # cycles that mention any linked case
        try:
            rd = test_runs._load()
            n_cyc = sum(1 for c in rd.get("cycles", [])
                        if c.get("status") != "Archived"
                        and any(it.get("case_id") in linked_cases for it in c.get("items", []) or []))
        except Exception:
            n_cyc = 0
        out.append({
            **p,
            "requirements": len(reqs),
            "test_cases": len(linked_cases),
            "cycles": n_cyc,
        })
    return {"ok": True, "projects": out}


@router.post("/api/projects")
def create_project(data: Dict[str, Any] = Body(...)):
    with locked(REQ_FILE):
        d = _load()
        key = _norm_key(data.get("key", ""))
        if any((p.get("key") or "").upper() == key for p in d["projects"]):
            raise ServiceError(f"Project key “{key}” already exists.")
        name = _s(data.get("name"), 200) or key
        d["pseq"] += 1
        p = {
            "id": f"PRJ-{d['pseq']:04d}",
            "key": key,
            "name": name,
            "description": _s(data.get("description"), 2000),
            "jira_project_key": _s(data.get("jira_project_key"), 40),
            "qtest_project_id": _s(data.get("qtest_project_id"), 40),
            "zephyr_project_key": _s(data.get("zephyr_project_key"), 40),
            "created": now(),
            "updated": now(),
            "system": False,
        }
        d["projects"].append(p)
        _save(d)
    return {"ok": True, "project": p}


@router.get("/api/projects/{pid}")
def get_project(pid: str):
    d = _load()
    return {"ok": True, "project": _proj(d, pid=pid)}


@router.put("/api/projects/{pid}")
def update_project(pid: str, data: Dict[str, Any] = Body(...)):
    with locked(REQ_FILE):
        d = _load()
        p = _proj(d, pid=pid)
        if p.get("system") and data.get("key") and _norm_key(data["key"]) != LOCAL_KEY.upper():
            raise ServiceError("Cannot rename the system Local project key.")
        for k in ("name", "description", "jira_project_key", "qtest_project_id", "zephyr_project_key"):
            if k in data:
                p[k] = _s(data.get(k), 2000 if k == "description" else 200)
        if "key" in data and not p.get("system"):
            key = _norm_key(data["key"])
            if any(x["id"] != pid and (x.get("key") or "").upper() == key for x in d["projects"]):
                raise ServiceError(f"Project key “{key}” already exists.")
            p["key"] = key
        p["updated"] = now()
        _save(d)
    return {"ok": True, "project": p}


# ================================================================== FOLDERS

def _folder_tree(d, project_id: str) -> List[Dict[str, Any]]:
    folders = [f for f in d["folders"] if f.get("project_id") == project_id]
    reqs = [r for r in d["requirements"] if r.get("project_id") == project_id and r.get("status") != "Archived"]

    def count(fid: str) -> int:
        ids = {fid}
        # descendants
        changed = True
        while changed:
            changed = False
            for f in folders:
                if f.get("parent") in ids and f["id"] not in ids:
                    ids.add(f["id"]); changed = True
        return sum(1 for r in reqs if r.get("folder_id") in ids)

    out = []
    for f in sorted(folders, key=lambda x: (x.get("order", 0), x["name"].lower())):
        out.append({**f, "count": count(f["id"])})
    return out


@router.get("/api/requirements/folders")
def list_folders(project_id: str = Query(...)):
    d = _load()
    _proj(d, pid=project_id)
    return {"ok": True, "folders": _folder_tree(d, project_id)}


@router.post("/api/requirements/folders")
def create_folder(data: Dict[str, Any] = Body(...)):
    with locked(REQ_FILE):
        d = _load()
        pid = _s(data.get("project_id"), 40)
        _proj(d, pid=pid)
        name = _s(data.get("name"), 200)
        if not name:
            raise ServiceError("Folder name is required.")
        parent = _s(data.get("parent"), 40)
        if parent and (not _folder(d, parent) or _folder(d, parent).get("project_id") != pid):
            raise ServiceError("Parent folder not found in this project.")
        d["fseq"] += 1
        fid = f"RF-{d['fseq']:04d}"
        order = max([f.get("order", 0) for f in d["folders"] if f.get("project_id") == pid and f.get("parent", "") == parent] or [0]) + 1
        f = {"id": fid, "name": name, "parent": parent, "project_id": pid, "order": order, "description": _s(data.get("description"), 500)}
        d["folders"].append(f)
        _save(d)
    return {"ok": True, "folder": f, "folders": _folder_tree(d, pid)}


@router.put("/api/requirements/folders/{fid}")
def update_folder(fid: str, data: Dict[str, Any] = Body(...)):
    with locked(REQ_FILE):
        d = _load()
        f = _folder(d, fid)
        if not f:
            raise ServiceError("Folder not found.", 404)
        if "name" in data:
            f["name"] = _s(data.get("name"), 200) or f["name"]
        if "description" in data:
            f["description"] = _s(data.get("description"), 500)
        if "parent" in data:
            parent = _s(data.get("parent"), 40)
            if parent:
                pf = _folder(d, parent)
                if not pf or pf.get("project_id") != f.get("project_id"):
                    raise ServiceError("Parent folder not found in this project.")
                if parent == fid:
                    raise ServiceError("Folder cannot be its own parent.")
            f["parent"] = parent
        _save(d)
    return {"ok": True, "folder": f}


@router.delete("/api/requirements/folders/{fid}")
def delete_folder(fid: str, move_to: str = Query("")):
    with locked(REQ_FILE):
        d = _load()
        f = _folder(d, fid)
        if not f:
            raise ServiceError("Folder not found.", 404)
        pid = f["project_id"]
        # collect subtree
        gone = {fid}
        changed = True
        while changed:
            changed = False
            for x in d["folders"]:
                if x.get("parent") in gone and x["id"] not in gone:
                    gone.add(x["id"]); changed = True
        target = move_to if move_to and _folder(d, move_to) and _folder(d, move_to).get("project_id") == pid else ""
        for r in d["requirements"]:
            if r.get("folder_id") in gone:
                r["folder_id"] = target
                r["updated"] = now()
        d["folders"] = [x for x in d["folders"] if x["id"] not in gone]
        _save(d)
    return {"ok": True, "folders": _folder_tree(d, pid)}


# ================================================================== REQUIREMENTS

@router.get("/api/requirements")
def list_requirements(
    project_id: str = Query(...),
    folder_id: str = Query(""),
    q: str = Query(""),
    type: str = Query(""),
    priority: str = Query(""),
    status: str = Query(""),
    include_archived: bool = Query(False),
):
    d = _load()
    _proj(d, pid=project_id)
    cases = _case_by_id()
    folder_ids = None
    if folder_id:
        folders = [f for f in d["folders"] if f.get("project_id") == project_id]
        folder_ids = {folder_id}
        changed = True
        while changed:
            changed = False
            for f in folders:
                if f.get("parent") in folder_ids and f["id"] not in folder_ids:
                    folder_ids.add(f["id"]); changed = True
    rows = []
    ql = q.strip().lower()
    for r in d["requirements"]:
        if r.get("project_id") != project_id:
            continue
        if not include_archived and r.get("status") == "Archived":
            continue
        if folder_ids is not None and r.get("folder_id") not in folder_ids:
            continue
        if type and r.get("type") != type:
            continue
        if priority and r.get("priority") != priority:
            continue
        if status and r.get("status") != status:
            continue
        if ql:
            blob = " ".join([r.get("id", ""), r.get("title", ""), r.get("jira_key", ""), r.get("description", "")]).lower()
            if ql not in blob:
                continue
        rows.append(_summary(d, r, cases))
    rows.sort(key=lambda x: x.get("id", ""))
    return {"ok": True, "requirements": rows, "folders": _folder_tree(d, project_id), "total": len(rows)}


def _clean_req(data: Dict[str, Any], base: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    r = dict(base or {})
    title = _s(data.get("title"), 300) if "title" in data or not base else r.get("title", "")
    if not title:
        raise ServiceError("Title is required.")
    r["title"] = title
    if "description" in data or not base:
        r["description"] = _s(data.get("description"), 8000)
    if "acs" in data or "acceptance_criteria" in data or not base:
        r["acs"] = _acs(data.get("acs", data.get("acceptance_criteria")))
    typ = _s(data.get("type"), 30) if "type" in data or not base else r.get("type", "Story")
    r["type"] = typ if typ in REQ_TYPES else "Story"
    src = _s(data.get("source"), 30) if "source" in data or not base else r.get("source", "Manual")
    r["source"] = src if src in REQ_SOURCES else "Manual"
    if "jira_key" in data or not base:
        r["jira_key"] = _s(data.get("jira_key"), 40).upper()
    if "priority" in data or not base:
        r["priority"] = _s(data.get("priority") or "Medium", 30)
    if "status" in data or not base:
        st = _s(data.get("status") or "Draft", 30)
        r["status"] = st if st in REQ_STATUSES else "Draft"
    if "folder_id" in data or not base:
        r["folder_id"] = _s(data.get("folder_id"), 40)
    return r


@router.post("/api/requirements")
def create_requirement(data: Dict[str, Any] = Body(...)):
    with locked(REQ_FILE):
        d = _load()
        pid = _s(data.get("project_id"), 40)
        _proj(d, pid=pid)
        r = _clean_req(data)
        if r.get("folder_id") and (not _folder(d, r["folder_id"]) or _folder(d, r["folder_id"]).get("project_id") != pid):
            raise ServiceError("Folder not found in this project.")
        # 1:1 jira_key uniqueness within project (non-empty)
        jk = r.get("jira_key") or ""
        if jk and any(x.get("project_id") == pid and (x.get("jira_key") or "").upper() == jk and x.get("status") != "Archived" for x in d["requirements"]):
            raise ServiceError(f"Jira key {jk} is already linked to another requirement in this project.")
        d["rseq"] += 1
        rid = f"REQ-{d['rseq']:04d}"
        ts = now()
        r.update({"id": rid, "project_id": pid, "created": ts, "updated": ts, "activity": []})
        _event(r, "created", "Created")
        d["requirements"].append(r)
        # optional auto-link
        linked = []
        if data.get("auto_link") and jk:
            linked = _do_auto_link(d, r)
        _save(d)
    return {"ok": True, "requirement": _detail(d, r), "auto_linked": linked}


# ================================================================== IMPORT

@router.post("/api/requirements/import")
def import_requirements(data: Dict[str, Any] = Body(...)):
    """Import requirements from a pasted list and/or Jira keys via existing fetch_jira.

    Body:
      project_id: required
      folder_id: optional
      items: [{jira_key, title?, description?, acs?, priority?, type?}]
      fetch_jira: bool — when true, call services.fetch_jira for each key missing a title
      auto_link: bool — opt-in link cases where case.story == jira_key
    """
    from . import services as svc

    pid = _s(data.get("project_id"), 40)
    folder_id = _s(data.get("folder_id"), 40)
    fetch = bool(data.get("fetch_jira"))
    auto = bool(data.get("auto_link"))
    items = data.get("items") or []
    # also accept raw text: lines "KEY | title" or just KEY
    raw = data.get("text") or ""
    if raw and not items:
        for line in str(raw).splitlines():
            line = line.strip()
            if not line:
                continue
            if "|" in line:
                k, t = line.split("|", 1)
                items.append({"jira_key": k.strip(), "title": t.strip()})
            else:
                items.append({"jira_key": line})

    created, skipped, errors = [], [], []
    with locked(REQ_FILE):
        d = _load()
        _proj(d, pid=pid)
        if folder_id and (not _folder(d, folder_id) or _folder(d, folder_id).get("project_id") != pid):
            raise ServiceError("Folder not found in this project.")
        existing_keys = {(x.get("jira_key") or "").upper() for x in d["requirements"]
                         if x.get("project_id") == pid and x.get("status") != "Archived" and x.get("jira_key")}

        for it in items:
            if not isinstance(it, dict):
                continue
            jk = _s(it.get("jira_key") or it.get("key"), 40).upper()
            title = _s(it.get("title"), 300)
            desc = _s(it.get("description"), 8000)
            acs = _acs(it.get("acs") or it.get("acceptance_criteria"))
            if fetch and jk:
                try:
                    j = svc.fetch_jira(jk)
                    title = title or _s(j.get("summary"), 300)
                    desc = desc or _s(j.get("description") or j.get("feature_text"), 8000)
                    if not acs and j.get("acceptance_criteria"):
                        acs = _acs(j.get("acceptance_criteria"))
                    jk = _s(j.get("issue_key") or jk, 40).upper()
                except ServiceError as ex:
                    errors.append({"jira_key": jk, "error": str(ex)})
                    if not title:
                        continue
                except Exception as ex:
                    errors.append({"jira_key": jk, "error": str(ex)})
                    if not title:
                        continue
            if not title:
                title = jk or "Untitled requirement"
            if jk and jk in existing_keys:
                skipped.append(jk)
                continue
            d["rseq"] += 1
            rid = f"REQ-{d['rseq']:04d}"
            ts = now()
            r = {
                "id": rid, "project_id": pid, "folder_id": folder_id,
                "title": title, "description": desc, "acs": acs,
                "type": _s(it.get("type"), 30) if _s(it.get("type"), 30) in REQ_TYPES else "Story",
                "source": "Jira" if jk else "Manual",
                "jira_key": jk, "priority": _s(it.get("priority") or "Medium", 30),
                "status": "Draft", "created": ts, "updated": ts, "activity": [],
            }
            _event(r, "created", f"Imported ({'Jira' if jk else 'paste'})")
            d["requirements"].append(r)
            if jk:
                existing_keys.add(jk)
            linked = _do_auto_link(d, r) if auto and jk else []
            created.append({"id": rid, "jira_key": jk, "auto_linked": linked})
        _save(d)
    return {"ok": True, "created": created, "skipped": skipped, "errors": errors}


# ================================================================== TRACEABILITY

@router.get("/api/requirements/traceability")
def traceability(
    project_id: str = Query(...),
    cycle_id: str = Query(""),
    folder_id: str = Query(""),
    gaps_only: bool = Query(False),
):
    d = _load()
    _proj(d, pid=project_id)
    cases = _case_by_id()
    # optional folder filter
    folder_ids = None
    if folder_id:
        folders = [f for f in d["folders"] if f.get("project_id") == project_id]
        folder_ids = {folder_id}
        changed = True
        while changed:
            changed = False
            for f in folders:
                if f.get("parent") in folder_ids and f["id"] not in folder_ids:
                    folder_ids.add(f["id"]); changed = True

    # cycle item map
    cycle_status: Dict[str, str] = {}
    cycle_name = ""
    if cycle_id:
        try:
            rd = test_runs._load()
            cyc = next((c for c in rd.get("cycles", []) if c["id"] == cycle_id), None)
            if cyc:
                cycle_name = cyc.get("name", "")
                for it in cyc.get("items", []) or []:
                    cycle_status[it.get("case_id")] = it.get("status") or "Not run"
        except Exception:
            pass

    # all case ids linked to any req in project (for columns)
    reqs = [r for r in d["requirements"]
            if r.get("project_id") == project_id and r.get("status") != "Archived"
            and (folder_ids is None or r.get("folder_id") in folder_ids)]
    case_ids_ordered = []
    seen = set()
    rows = []
    for r in sorted(reqs, key=lambda x: x["id"]):
        ids = _link_ids(d, r["id"])
        cells = {}
        for cid in ids:
            if cid not in seen:
                seen.add(cid); case_ids_ordered.append(cid)
            if cycle_id:
                if cid in cycle_status:
                    cells[cid] = cycle_status[cid]
                else:
                    cells[cid] = "Linked"  # linked but not in this cycle
            else:
                lr = _last_result_for(cid)
                cells[cid] = lr.get("result") or "Linked"
        cov = _coverage(d, r, cases)
        gap = cov["gap"]
        if gaps_only and not gap:
            continue
        rows.append({
            "id": r["id"], "title": r.get("title", ""), "jira_key": r.get("jira_key", ""),
            "coverage_pct": cov["coverage_pct"], "gap": gap, "cells": cells, "case_ids": ids,
        })

    columns = [{"id": cid, "title": (cases.get(cid) or {}).get("title", cid)} for cid in case_ids_ordered]
    return {
        "ok": True,
        "project_id": project_id,
        "cycle_id": cycle_id,
        "cycle_name": cycle_name,
        "columns": columns,
        "rows": rows,
        "gaps": sum(1 for r in rows if r["gap"]),
    }


@router.get("/api/requirements/generate-context/{rid}")
def generate_context(rid: str):
    """Payload to prefill the existing Generate flow for a requirement."""
    d = _load()
    r = _req(d, rid)
    acs = r.get("acs") or []
    ac_block = "\n".join(f"- {a}" for a in acs) if acs else "(none)"
    feature = (
        f"Requirement {r['id']}: {r.get('title', '')}\n\n"
        f"{r.get('description') or ''}\n\n"
        f"Acceptance criteria:\n{ac_block}\n"
    )
    return {
        "ok": True,
        "requirement_id": rid,
        "story_id": r.get("jira_key") or "",
        "feature_text": feature,
        "title": r.get("title", ""),
    }

@router.get("/api/requirements/{rid}")
def get_requirement(rid: str):
    d = _load()
    r = _req(d, rid)
    return {"ok": True, "requirement": _detail(d, r)}


def _detail(d, r: Dict[str, Any]) -> Dict[str, Any]:
    cases = _case_by_id()
    cov = _coverage(d, r, cases)
    linked = []
    for cid in cov["case_ids"]:
        c = cases.get(cid)
        if not c:
            continue
        lr = _last_result_for(cid)
        linked.append({
            "id": c["id"], "title": c.get("title", ""), "status": c.get("status", ""),
            "priority": c.get("priority", ""), "story": c.get("story", ""),
            "last_result": lr.get("result", ""), "cycle_id": lr.get("cycle_id", ""),
            "cycle_name": lr.get("cycle_name", ""),
        })
    # cycles containing linked cases
    cycles = []
    try:
        rd = test_runs._load()
        ids = set(cov["case_ids"])
        for c in rd.get("cycles", []):
            if c.get("status") == "Archived":
                continue
            items = [it for it in c.get("items", []) or [] if it.get("case_id") in ids]
            if not items:
                continue
            counts = {"Pass": 0, "Fail": 0, "Not run": 0, "other": 0}
            for it in items:
                st = it.get("status") or "Not run"
                if st in counts:
                    counts[st] += 1
                else:
                    counts["other"] += 1
            cycles.append({"id": c["id"], "name": c.get("name", ""), "counts": counts, "items": len(items)})
    except Exception:
        pass
    return {
        **r,
        **cov,
        "linked_cases": linked,
        "cycles": cycles,
        "activity": list(reversed(r.get("activity") or []))[:50],
        "folder_path": _folder_path(d, r.get("folder_id", "")),
    }


def _folder_path(d, fid: str) -> str:
    parts = []
    seen = set()
    while fid and fid not in seen:
        seen.add(fid)
        f = _folder(d, fid)
        if not f:
            break
        parts.append(f["name"])
        fid = f.get("parent") or ""
    return " / ".join(reversed(parts))


@router.put("/api/requirements/{rid}")
def update_requirement(rid: str, data: Dict[str, Any] = Body(...)):
    with locked(REQ_FILE):
        d = _load()
        r = _req(d, rid)
        old_status = r.get("status")
        r2 = _clean_req(data, r)
        if r2.get("folder_id") and (not _folder(d, r2["folder_id"]) or _folder(d, r2["folder_id"]).get("project_id") != r.get("project_id")):
            raise ServiceError("Folder not found in this project.")
        jk = r2.get("jira_key") or ""
        if jk and any(x["id"] != rid and x.get("project_id") == r.get("project_id") and (x.get("jira_key") or "").upper() == jk and x.get("status") != "Archived" for x in d["requirements"]):
            raise ServiceError(f"Jira key {jk} is already linked to another requirement in this project.")
        r.update(r2)
        r["updated"] = now()
        if old_status != r.get("status"):
            _event(r, "status", f"{old_status} → {r.get('status')}")
        else:
            _event(r, "updated", "Updated")
        _save(d)
    return {"ok": True, "requirement": _detail(d, r)}


@router.delete("/api/requirements/{rid}")
def archive_requirement(rid: str):
    with locked(REQ_FILE):
        d = _load()
        r = _req(d, rid)
        r["status"] = "Archived"
        r["updated"] = now()
        _event(r, "archived", "Archived")
        _save(d)
    return {"ok": True, "requirement": _summary(d, r)}


# ================================================================== LINKS

def _do_auto_link(d, r: Dict[str, Any]) -> List[str]:
    jk = (r.get("jira_key") or "").strip().upper()
    if not jk:
        return []
    have = {(l["requirement_id"], l["case_id"]) for l in d["links"]}
    linked = []
    for c in test_repo._load()["cases"]:
        if (c.get("story") or "").strip().upper() != jk:
            continue
        if c.get("status") == "Archived":
            continue
        pair = (r["id"], c["id"])
        if pair in have:
            continue
        d["links"].append({"requirement_id": r["id"], "case_id": c["id"], "created": now()})
        have.add(pair)
        linked.append(c["id"])
    if linked:
        _event(r, "auto_link", f"Auto-linked {len(linked)} case(s) by story={jk}", cases=",".join(linked[:20]))
        r["updated"] = now()
    return linked


@router.post("/api/requirements/{rid}/links")
def link_cases(rid: str, data: Dict[str, Any] = Body(...)):
    with locked(REQ_FILE):
        d = _load()
        r = _req(d, rid)
        cases = _case_by_id()
        have = {(l["requirement_id"], l["case_id"]) for l in d["links"]}
        added = []
        for cid in data.get("case_ids") or []:
            cid = _s(cid, 40)
            if not cid or cid not in cases:
                continue
            pair = (rid, cid)
            if pair in have:
                continue
            d["links"].append({"requirement_id": rid, "case_id": cid, "created": now()})
            have.add(pair)
            added.append(cid)
        if added:
            _event(r, "link", f"Linked {len(added)} case(s)", cases=",".join(added[:20]))
            r["updated"] = now()
            _save(d)
    return {"ok": True, "added": added, "requirement": _detail(_load(), _req(_load(), rid))}


@router.delete("/api/requirements/{rid}/links/{case_id}")
def unlink_case(rid: str, case_id: str):
    with locked(REQ_FILE):
        d = _load()
        r = _req(d, rid)
        before = len(d["links"])
        d["links"] = [l for l in d["links"] if not (l.get("requirement_id") == rid and l.get("case_id") == case_id)]
        if len(d["links"]) != before:
            _event(r, "unlink", f"Unlinked {case_id}")
            r["updated"] = now()
            _save(d)
    return {"ok": True, "requirement": _detail(d, r)}


@router.post("/api/requirements/{rid}/auto-link")
def auto_link(rid: str):
    with locked(REQ_FILE):
        d = _load()
        r = _req(d, rid)
        linked = _do_auto_link(d, r)
        _save(d)
    return {"ok": True, "linked": linked, "requirement": _detail(d, r)}

