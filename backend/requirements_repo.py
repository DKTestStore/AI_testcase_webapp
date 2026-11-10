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
Delete = archive (status Archived) by default; archived hidden by default.
Permanent delete is allowed only when the requirement has no linked test cases
and no executions. Folder delete never drops a subtree: empty folders can be
removed outright; otherwise contents must be moved (move_to or to_parent).
Activity events record ts + by ('local user', or a settings display name if one exists).
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


def _actor() -> str:
    """No auth in this app: use a settings display name if one was stored, else 'local user'."""
    try:
        from . import settings_store
        data = settings_store._app() if hasattr(settings_store, "_app") else {}
        for k in ("user_name", "display_name", "operator", "username"):
            v = str((data or {}).get(k) or "").strip()
            if v:
                return _s(v, 100)
    except Exception:
        pass
    return "local user"


def _event(r: Dict[str, Any], typ: str, text: str = "", **meta) -> None:
    ev = {"ts": now(), "type": typ, "text": _s(text, 500), "by": _s(meta.pop("by", None) or _actor(), 100)}
    ev.update({k: v for k, v in meta.items() if v not in (None, "")})
    act = r.setdefault("activity", [])
    act.append(ev)
    if len(act) > 100:
        del act[: len(act) - 100]


def _touch(r: Dict[str, Any]) -> None:
    r["updated"] = now()
    r["updated_by"] = _actor()


def _desc_folder_ids(d, fid: str) -> set:
    """Descendant folder ids of fid (not including fid itself)."""
    gone = {fid}
    changed = True
    while changed:
        changed = False
        for x in d["folders"]:
            if x.get("parent") in gone and x["id"] not in gone:
                gone.add(x["id"])
                changed = True
    gone.discard(fid)
    return gone


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
                if parent in _desc_folder_ids(d, fid):
                    raise ServiceError("Folder cannot be moved under its own subfolder.")
            f["parent"] = parent
        _save(d)
    return {"ok": True, "folder": f}


def _folder_delete_stats(d, f: Dict[str, Any]) -> Dict[str, Any]:
    fid = f["id"]
    kids = [x for x in d["folders"] if x.get("parent") == fid]
    desc = _desc_folder_ids(d, fid)
    reqs_direct = [r for r in d["requirements"] if r.get("folder_id") == fid]
    reqs_active = [r for r in reqs_direct if r.get("status") != "Archived"]
    reqs_desc = [r for r in d["requirements"] if r.get("folder_id") in desc and r.get("status") != "Archived"]
    parent = _folder(d, f.get("parent") or "")
    empty = not reqs_direct and not kids
    return {
        "folder_id": fid,
        "name": f.get("name", ""),
        "parent_id": f.get("parent") or "",
        "parent_name": parent["name"] if parent else "(root / unfiled)",
        "requirement_count": len(reqs_active),
        "requirement_total": len(reqs_direct),
        "descendant_requirement_count": len(reqs_desc),
        "subfolder_count": len(kids),
        "descendant_folder_count": len(desc),
        "empty": empty,
        "can_delete_empty": empty,
    }


@router.get("/api/requirements/folders/{fid}/delete-check")
def folder_delete_check(fid: str):
    d = _load()
    f = _folder(d, fid)
    if not f:
        raise ServiceError("Folder not found.", 404)
    return {"ok": True, **_folder_delete_stats(d, f)}


@router.delete("/api/requirements/folders/{fid}")
def delete_folder(fid: str, move_to: str = Query(""), to_parent: bool = Query(False)):
    """Delete a folder. Empty folders (no direct requirements, no subfolders) can be
    removed with no extra flags. Otherwise the client must pass move_to=<id> or
    to_parent=true. Subfolders are reparented, never deleted with the parent.
    """
    with locked(REQ_FILE):
        d = _load()
        f = _folder(d, fid)
        if not f:
            raise ServiceError("Folder not found.", 404)
        pid = f["project_id"]
        stats = _folder_delete_stats(d, f)
        if stats["empty"]:
            d["folders"] = [x for x in d["folders"] if x["id"] != fid]
            _save(d)
            return {"ok": True, "deleted": fid, "moved": 0, "reparented": 0, "folders": _folder_tree(d, pid)}

        if to_parent:
            target = f.get("parent") or ""
        elif move_to:
            if move_to in ("__root__", "__unfiled__"):
                target = ""
            elif move_to == fid:
                raise ServiceError("Cannot move contents into the folder being deleted.")
            else:
                tf = _folder(d, move_to)
                if not tf or tf.get("project_id") != pid:
                    raise ServiceError("Destination folder not found in this project.")
                if move_to in _desc_folder_ids(d, fid):
                    raise ServiceError("Cannot move contents into a subfolder of the folder being deleted.")
                target = move_to
        else:
            raise ServiceError(
                f"Folder is not empty ({stats['requirement_count']} requirement(s), "
                f"{stats['subfolder_count']} subfolder(s)). Pass move_to=<folder id> or "
                "to_parent=true, or delete only when empty.",
                409,
            )

        n_moved = 0
        for r in d["requirements"]:
            if r.get("folder_id") == fid:
                r["folder_id"] = target
                _touch(r)
                n_moved += 1
        n_reparent = 0
        for x in d["folders"]:
            if x.get("parent") == fid:
                x["parent"] = target
                n_reparent += 1
        d["folders"] = [x for x in d["folders"] if x["id"] != fid]
        _save(d)
    return {"ok": True, "deleted": fid, "moved": n_moved, "reparented": n_reparent, "folders": _folder_tree(d, pid)}


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
        r.update({"id": rid, "project_id": pid, "created": ts, "updated": ts, "updated_by": _actor(), "activity": []})
        _event(r, "created", "Created")
        d["requirements"].append(r)
        # optional auto-link + explicit case_ids
        linked = []
        if data.get("auto_link") and jk:
            linked = _do_auto_link(d, r)
        extra = _add_links(d, r, data.get("case_ids") or [])
        for cid in extra:
            if cid not in linked:
                linked.append(cid)
        _save(d)
    return {"ok": True, "requirement": _detail(d, r), "auto_linked": linked}


@router.post("/api/requirements/bulk")
def bulk_requirements(data: Dict[str, Any] = Body(...)):
    """Bulk move, change status, or archive. Body: {ids, op: move|status|archive, folder_id?, status?}."""
    ids = [_s(x, 40) for x in (data.get("ids") or []) if _s(x, 40)]
    op = _s(data.get("op"), 30)
    if not ids:
        raise ServiceError("No requirement ids provided.")
    if op not in ("move", "status", "archive"):
        raise ServiceError("op must be move, status, or archive.")
    with locked(REQ_FILE):
        d = _load()
        byid = {r["id"]: r for r in d["requirements"]}
        updated = []
        if op == "move":
            fid = _s(data.get("folder_id"), 40)
            dest = None
            if fid:
                dest = _folder(d, fid)
                if not dest:
                    raise ServiceError("Folder not found.", 404)
            for rid in ids:
                r = byid.get(rid)
                if not r or r.get("status") == "Archived":
                    continue
                if dest and dest.get("project_id") != r.get("project_id"):
                    raise ServiceError(f"{rid} is not in the destination folder’s project.")
                r["folder_id"] = fid
                _touch(r)
                _event(r, "updated", f"Moved to folder {fid or '(unfiled)'}")
                updated.append(rid)
        elif op == "status":
            st = _s(data.get("status"), 30)
            if st not in REQ_STATUSES or st == "Archived":
                raise ServiceError("status must be Draft, Ready, or Approved (use archive to archive).")
            for rid in ids:
                r = byid.get(rid)
                if not r or r.get("status") == "Archived":
                    continue
                old_st = r.get("status")
                if old_st == st:
                    continue
                r["status"] = st
                _touch(r)
                _event(r, "status", f"{old_st} → {st}")
                updated.append(rid)
        else:
            for rid in ids:
                r = byid.get(rid)
                if not r or r.get("status") == "Archived":
                    continue
                r["status"] = "Archived"
                _touch(r)
                _event(r, "archived", "Archived")
                updated.append(rid)
        if updated:
            _save(d)
    return {"ok": True, "op": op, "updated": updated, "count": len(updated)}


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


def _delete_stats(d, r: Dict[str, Any]) -> Dict[str, Any]:
    ids = _link_ids(d, r["id"])
    exec_count = 0
    exec_cycles = []
    seen = set()
    try:
        rd = test_runs._load()
        for e in rd.get("executions", []):
            if e.get("case_id") in ids:
                exec_count += 1
                cid = e.get("cycle_id") or ""
                if cid and cid not in seen:
                    seen.add(cid)
                    name = next((c.get("name", "") for c in rd.get("cycles", []) if c["id"] == cid), "")
                    exec_cycles.append({"id": cid, "name": name})
        for c in rd.get("cycles", []):
            if c.get("status") == "Archived" or c["id"] in seen:
                continue
            if any(it.get("case_id") in ids for it in c.get("items") or []):
                seen.add(c["id"])
                exec_cycles.append({"id": c["id"], "name": c.get("name", "")})
    except Exception:
        pass
    return {
        "requirement_id": r["id"],
        "title": r.get("title", ""),
        "status": r.get("status", ""),
        "linked_cases": len(ids),
        "case_ids": ids,
        "executions": exec_count,
        "cycles": exec_cycles,
        "cycle_count": len(exec_cycles),
        "can_permanent_delete": len(ids) == 0 and exec_count == 0,
    }


@router.get("/api/requirements/{rid}/delete-check")
def requirement_delete_check(rid: str):
    d = _load()
    r = _req(d, rid)
    return {"ok": True, **_delete_stats(d, r)}


@router.post("/api/requirements/{rid}/duplicate")
def duplicate_requirement(rid: str):
    with locked(REQ_FILE):
        d = _load()
        src = _req(d, rid)
        d["rseq"] += 1
        nid = f"REQ-{d['rseq']:04d}"
        ts = now()
        r = {
            "id": nid,
            "project_id": src.get("project_id", ""),
            "folder_id": src.get("folder_id", ""),
            "title": _s((src.get("title") or "") + " (copy)", 300),
            "description": src.get("description", ""),
            "acs": list(src.get("acs") or []),
            "type": src.get("type", "Story") if src.get("type") in REQ_TYPES else "Story",
            "source": "Manual",
            "jira_key": "",
            "priority": src.get("priority") or "Medium",
            "status": "Draft",
            "created": ts,
            "updated": ts,
            "updated_by": _actor(),
            "activity": [],
        }
        _event(r, "created", f"Duplicated from {rid}")
        d["requirements"].append(r)
        _save(d)
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
        _touch(r)
        if old_status != r.get("status"):
            _event(r, "status", f"{old_status} → {r.get('status')}")
        else:
            _event(r, "updated", "Updated")
        _save(d)
    return {"ok": True, "requirement": _detail(d, r)}


@router.delete("/api/requirements/{rid}")
def delete_requirement(rid: str, permanent: bool = Query(False)):
    """Archive by default (keeps history and links). Permanent delete is allowed
    only when delete-check reports zero linked cases and zero executions.
    """
    with locked(REQ_FILE):
        d = _load()
        r = _req(d, rid)
        stats = _delete_stats(d, r)
        if permanent:
            if not stats["can_permanent_delete"]:
                raise ServiceError(
                    f"Permanent delete is blocked: {stats['linked_cases']} linked test case(s), "
                    f"{stats['executions']} execution(s). Archive instead.",
                    409,
                )
            d["links"] = [l for l in d["links"] if l.get("requirement_id") != rid]
            d["requirements"] = [x for x in d["requirements"] if x["id"] != rid]
            _save(d)
            return {"ok": True, "deleted": rid, "permanent": True, **stats}
        r["status"] = "Archived"
        _touch(r)
        _event(r, "archived", "Archived")
        _save(d)
    return {"ok": True, "requirement": _summary(d, r), "permanent": False}


# ================================================================== LINKS

def _add_links(d, r: Dict[str, Any], case_ids) -> List[str]:
    cases = _case_by_id()
    have = {(l["requirement_id"], l["case_id"]) for l in d["links"]}
    added = []
    for cid in case_ids or []:
        cid = _s(cid, 40)
        if not cid or cid not in cases:
            continue
        if cases[cid].get("status") == "Archived":
            continue
        pair = (r["id"], cid)
        if pair in have:
            continue
        d["links"].append({"requirement_id": r["id"], "case_id": cid, "created": now()})
        have.add(pair)
        added.append(cid)
    if added:
        _event(r, "link", f"Linked {len(added)} case(s)", cases=",".join(added[:20]))
        _touch(r)
    return added


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
        _touch(r)
    return linked


@router.post("/api/requirements/{rid}/links")
def link_cases(rid: str, data: Dict[str, Any] = Body(...)):
    with locked(REQ_FILE):
        d = _load()
        r = _req(d, rid)
        added = _add_links(d, r, data.get("case_ids") or [])
        if added:
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
            _touch(r)
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

