"""Automation Script library, Generate, and downloads (additive)."""
from __future__ import annotations

import io
import json
import logging
import re
import zipfile
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from . import script_options as so
from . import services, token_usage
from .config import env
from .db.engine import session_scope
from .db.models import AutomationScript, Counter, ScriptFolder, ScriptVersion
from .services import ServiceError

log = logging.getLogger("atg.automation")

router = APIRouter(prefix="/api/automation")

_SAFE_PATH = re.compile(r"^[A-Za-z0-9._\- /]+$")
_SAFE_ID = re.compile(r"^[\w.-]+$")


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


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


def _next(session: Session, name: str, prefix: str, width: int = 4) -> str:
    row = session.get(Counter, name)
    if row is None:
        row = Counter(name=name, value=0)
        session.add(row)
        session.flush()
    row.value = int(row.value or 0) + 1
    return f"{prefix}{row.value:0{width}d}"


def _folder_dict(f: ScriptFolder, count: int = 0) -> Dict[str, Any]:
    return {
        "id": f.id, "name": f.name, "parent": f.parent or "",
        "project": f.project or "", "order": f.order,
        "description": f.description or "", "count": count,
    }


def _script_summary(s: AutomationScript) -> Dict[str, Any]:
    files = s.files if isinstance(s.files, dict) else {}
    return {
        "id": s.id, "name": s.name, "folder_id": s.folder_id or "",
        "project": s.project or "", "linked_ids": list(s.linked_ids or []),
        "language": s.language or "", "types": list(s.types or []),
        "frameworks": list(s.frameworks or []),
        "model": s.model or "", "provider": s.provider or "",
        "tags": list(s.tags or []), "notes": s.notes or "",
        "version": int(s.version or 1), "file_count": len(files),
        "created": s.created or "", "updated": s.updated or "",
    }


def _script_detail(s: AutomationScript) -> Dict[str, Any]:
    d = _script_summary(s)
    d["files"] = s.files if isinstance(s.files, dict) else {}
    d["mapping"] = list(s.mapping or [])
    d["warnings"] = list(s.warnings or [])
    return d


def _counts_for(session: Session, folder_ids: List[str]) -> Dict[str, int]:
    out = {fid: 0 for fid in folder_ids}
    for s in session.query(AutomationScript).all():
        fid = s.folder_id or ""
        if fid in out:
            out[fid] += 1
    return out


def _descendants(session: Session, fid: str) -> set:
    kids = {f.id: f.parent or "" for f in session.query(ScriptFolder).all()}
    acc = {fid}
    changed = True
    while changed:
        changed = False
        for cid, parent in kids.items():
            if parent in acc and cid not in acc:
                acc.add(cid)
                changed = True
    return acc


def _folder_or_404(session: Session, fid: str) -> ScriptFolder:
    f = session.get(ScriptFolder, fid)
    if not f:
        raise ServiceError("Folder not found.", 404)
    return f


def _script_or_404(session: Session, sid: str) -> AutomationScript:
    s = session.get(AutomationScript, sid)
    if not s:
        raise ServiceError("Script not found.", 404)
    return s


def _as_files(val) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if isinstance(val, dict):
        for k, v in val.items():
            p = str(k).replace("\\", "/").lstrip("/")
            if p and ".." not in p:
                out[p] = v if isinstance(v, str) else str(v)
    elif isinstance(val, list):
        for it in val:
            if not isinstance(it, dict):
                continue
            p = str(it.get("path") or it.get("name") or "").replace("\\", "/").lstrip("/")
            if p and ".." not in p:
                out[p] = str(it.get("content") or it.get("text") or "")
    return out


# --------------------------------------------------------------------------- options / prefs (also on /api/settings/prefs)

@router.get("/options")
def get_options():
    return {"ok": True, **so.get_catalogue(), "prefs": so.get_automation_prefs()}


@router.put("/options")
def put_options(data: Dict[str, Any] = Body(...)):
    cat = so.set_catalogue(data or {})
    prefs = so.get_automation_prefs()
    if isinstance(data, dict) and "prefs" in data and isinstance(data.get("prefs"), dict):
        prefs = so.set_automation_prefs(data["prefs"])
    return {"ok": True, **cat, "prefs": prefs}


@router.post("/options/reset")
def reset_options():
    cat = so.set_catalogue({"reset": True})
    return {"ok": True, **cat, "prefs": so.get_automation_prefs()}


@router.get("/prefs")
def get_prefs():
    return {"ok": True, "prefs": so.get_automation_prefs()}


@router.put("/prefs")
def put_prefs(data: Dict[str, Any] = Body(...)):
    prefs = so.set_automation_prefs(data.get("prefs") if isinstance(data.get("prefs"), dict) else data)
    return {"ok": True, "prefs": prefs}


# --------------------------------------------------------------------------- folders

@router.get("/folders")
def list_folders():
    with _session() as session:
        rows = session.query(ScriptFolder).order_by(ScriptFolder.order, ScriptFolder.name).all()
        counts = _counts_for(session, [f.id for f in rows])
        # include unfiled count
        unfiled = session.query(AutomationScript).filter(
            (AutomationScript.folder_id == "") | (AutomationScript.folder_id.is_(None))
        ).count()
        return {"ok": True, "folders": [_folder_dict(f, counts.get(f.id, 0)) for f in rows],
                "unfiled": unfiled}


@router.post("/folders")
def create_folder(data: Dict[str, Any] = Body(...)):
    name = str(data.get("name") or "").strip()[:120]
    if not name:
        raise ServiceError("Folder name is required.")
    parent = str(data.get("parent") or data.get("parent_id") or "").strip()
    with _session() as session:
        if parent:
            _folder_or_404(session, parent)
        fid = _next(session, "script_fseq", "SF-")
        siblings = session.query(ScriptFolder).filter(ScriptFolder.parent == (parent or None)).all()
        order = int(data.get("order") or (max((f.order for f in siblings), default=-1) + 1))
        f = ScriptFolder(
            id=fid, name=name, parent=parent or None,
            project=str(data.get("project") or "")[:80],
            order=order, description=str(data.get("description") or "")[:500],
        )
        session.add(f)
        session.flush()
        return {"ok": True, "folder": _folder_dict(f, 0)}


@router.put("/folders/{fid}")
def update_folder(fid: str, data: Dict[str, Any] = Body(...)):
    with _session() as session:
        f = _folder_or_404(session, fid)
        if "name" in data:
            name = str(data.get("name") or "").strip()[:120]
            if not name:
                raise ServiceError("Folder name is required.")
            f.name = name
        if "description" in data:
            f.description = str(data.get("description") or "")[:500]
        if "project" in data:
            f.project = str(data.get("project") or "")[:80]
        if "parent" in data or "parent_id" in data:
            parent = str(data.get("parent") if "parent" in data else data.get("parent_id") or "").strip()
            if parent == fid:
                raise ServiceError("A folder cannot be its own parent.")
            if parent:
                _folder_or_404(session, parent)
                if fid in _descendants(session, parent) and parent != fid:
                    # parent is under fid — cycle
                    if parent in _descendants(session, fid):
                        raise ServiceError("Cannot move a folder into one of its descendants.")
            f.parent = parent or None
        if "order" in data:
            try:
                f.order = int(data.get("order"))
            except (TypeError, ValueError):
                pass
        session.flush()
        counts = _counts_for(session, [f.id])
        return {"ok": True, "folder": _folder_dict(f, counts.get(f.id, 0))}


@router.post("/folders/reorder")
def reorder_folders(data: Dict[str, Any] = Body(...)):
    order = data.get("order") or data.get("ids") or []
    if not isinstance(order, list):
        raise ServiceError("order must be a list of folder ids.")
    with _session() as session:
        for i, fid in enumerate(order):
            f = session.get(ScriptFolder, str(fid))
            if f:
                f.order = i
        return {"ok": True}


@router.delete("/folders/{fid}")
def delete_folder(fid: str, move_to: str = Query(""), recursive: bool = Query(False)):
    with _session() as session:
        f = _folder_or_404(session, fid)
        desc = _descendants(session, fid)
        children = [x for x in session.query(ScriptFolder).all() if x.id in desc and x.id != fid]
        scripts = [s for s in session.query(AutomationScript).all() if s.folder_id in desc]
        dest = (move_to or "").strip()
        if dest:
            if dest in desc:
                raise ServiceError("Cannot move items into a folder that will be deleted.")
            _folder_or_404(session, dest)
        if children and not recursive and not dest:
            raise ServiceError(
                f"Folder has {len(children)} subfolder(s) and {len(scripts)} script(s). "
                "Pass recursive=1 to delete the tree or move_to to relocate items."
            )
        if dest:
            for c in children:
                if (c.parent or "") == fid or c.parent in desc:
                    c.parent = dest
            for s in scripts:
                s.folder_id = dest
            for c in list(children):
                # only delete the root folder, keep relocated children
                pass
            session.delete(f)
        elif recursive:
            for s in scripts:
                _delete_script_row(session, s)
            # delete deepest first
            for c in sorted(children, key=lambda x: x.id, reverse=True):
                session.delete(c)
            session.delete(f)
        else:
            if scripts:
                raise ServiceError(
                    f"Folder has {len(scripts)} script(s). Move or delete them first, or pass move_to / recursive=1."
                )
            session.delete(f)
        return {"ok": True}


# --------------------------------------------------------------------------- scripts

def _apply_filters(rows: List[AutomationScript], q: str, folder: str, language: str,
                   tc: str, tag: str, framework: str) -> List[AutomationScript]:
    q = (q or "").strip().lower()
    folder = (folder or "").strip()
    language = (language or "").strip()
    tc = (tc or "").strip()
    tag = (tag or "").strip().lower()
    framework = (framework or "").strip().lower()
    out = []
    for s in rows:
        if folder == "__unfiled":
            if s.folder_id:
                continue
        elif folder and s.folder_id != folder:
            continue
        if language and s.language != language:
            continue
        if tc and tc not in (s.linked_ids or []):
            continue
        if tag and tag not in [str(x).lower() for x in (s.tags or [])]:
            continue
        if framework and framework not in [str(x).lower() for x in (s.frameworks or [])]:
            continue
        if q:
            blob = " ".join([
                s.id, s.name, s.language, s.notes or "", s.provider or "", s.model or "",
                " ".join(s.tags or []), " ".join(s.linked_ids or []), " ".join(s.frameworks or []),
                " ".join(s.types or []),
            ]).lower()
            if q not in blob:
                continue
        out.append(s)
    return out


@router.get("/scripts")
def list_scripts(
    q: str = Query(""),
    folder: str = Query(""),
    language: str = Query(""),
    tc: str = Query(""),
    tag: str = Query(""),
    framework: str = Query(""),
    include_descendants: bool = Query(False),
):
    with _session() as session:
        rows = session.query(AutomationScript).order_by(AutomationScript.updated.desc(), AutomationScript.id.desc()).all()
        folder_filter = folder
        if include_descendants and folder and folder != "__unfiled":
            ids = _descendants(session, folder)
            rows = [s for s in rows if s.folder_id in ids]
            folder_filter = ""
        filtered = _apply_filters(rows, q, folder_filter, language, tc, tag, framework)
        return {"ok": True, "scripts": [_script_summary(s) for s in filtered], "total": len(filtered)}


@router.get("/scripts/{sid}")
def get_script(sid: str):
    with _session() as session:
        return {"ok": True, "script": _script_detail(_script_or_404(session, sid))}


@router.post("/scripts")
def create_script(data: Dict[str, Any] = Body(...)):
    name = str(data.get("name") or "").strip()[:300]
    if not name:
        raise ServiceError("Script name is required.")
    files = _as_files(data.get("files"))
    if not files:
        raise ServiceError("At least one file is required.")
    with _session() as session:
        folder_id = str(data.get("folder_id") or data.get("folder") or "").strip()
        if folder_id:
            _folder_or_404(session, folder_id)
        sid = _next(session, "script_seq", "AS-")
        now = _now()
        s = AutomationScript(
            id=sid, name=name, folder_id=folder_id,
            project=str(data.get("project") or "")[:80],
            linked_ids=_str_list(data.get("linked_ids") or data.get("test_cases")),
            language=str(data.get("language") or "")[:80],
            types=_str_list(data.get("types")),
            frameworks=_str_list(data.get("frameworks")),
            model=str(data.get("model") or "")[:160],
            provider=str(data.get("provider") or "")[:40],
            tags=_str_list(data.get("tags")),
            notes=str(data.get("notes") or "")[:4000],
            version=1, files=files,
            mapping=data.get("mapping") if isinstance(data.get("mapping"), list) else [],
            warnings=data.get("warnings") if isinstance(data.get("warnings"), list) else [],
            created=now, updated=now,
        )
        session.add(s)
        session.flush()
        _add_version(session, s, note=str(data.get("version_note") or "Initial version"))
        return {"ok": True, "script": _script_detail(s)}


@router.put("/scripts/{sid}")
def update_script(sid: str, data: Dict[str, Any] = Body(...)):
    """Autosave (default): update the working copy without a new version.
    Pass new_version=true (or save_version) to also snapshot a version."""
    with _session() as session:
        s = _script_or_404(session, sid)
        if "name" in data:
            name = str(data.get("name") or "").strip()[:300]
            if not name:
                raise ServiceError("Script name is required.")
            s.name = name
        if "folder_id" in data or "folder" in data:
            folder_id = str(data.get("folder_id") if "folder_id" in data else data.get("folder") or "").strip()
            if folder_id:
                _folder_or_404(session, folder_id)
            s.folder_id = folder_id
        if "project" in data:
            s.project = str(data.get("project") or "")[:80]
        if "linked_ids" in data or "test_cases" in data:
            s.linked_ids = _str_list(data.get("linked_ids") or data.get("test_cases"))
        if "language" in data:
            s.language = str(data.get("language") or "")[:80]
        if "types" in data:
            s.types = _str_list(data.get("types"))
        if "frameworks" in data:
            s.frameworks = _str_list(data.get("frameworks"))
        if "model" in data:
            s.model = str(data.get("model") or "")[:160]
        if "provider" in data:
            s.provider = str(data.get("provider") or "")[:40]
        if "tags" in data:
            s.tags = _str_list(data.get("tags"))
        if "notes" in data:
            s.notes = str(data.get("notes") or "")[:4000]
        if "files" in data:
            files = _as_files(data.get("files"))
            if not files:
                raise ServiceError("At least one file is required.")
            s.files = files
        if "mapping" in data and isinstance(data.get("mapping"), list):
            s.mapping = data.get("mapping")
        if "warnings" in data and isinstance(data.get("warnings"), list):
            s.warnings = data.get("warnings")
        s.updated = _now()
        new_ver = bool(data.get("new_version") or data.get("save_version"))
        if new_ver:
            s.version = int(s.version or 1) + 1
            _add_version(session, s, note=str(data.get("version_note") or "Saved version"))
        session.flush()
        return {"ok": True, "script": _script_detail(s), "new_version": new_ver}


@router.post("/scripts/{sid}/versions")
def save_new_version(sid: str, data: Dict[str, Any] = Body(None)):
    data = data or {}
    data["new_version"] = True
    if "files" not in data:
        # keep current files
        pass
    return update_script(sid, data)


@router.post("/scripts/{sid}/duplicate")
def duplicate_script(sid: str, data: Dict[str, Any] = Body(None)):
    data = data or {}
    with _session() as session:
        src = _script_or_404(session, sid)
        new_id = _next(session, "script_seq", "AS-")
        now = _now()
        name = str(data.get("name") or (src.name + " (copy)"))[:300]
        folder_id = str(data.get("folder_id") or src.folder_id or "").strip()
        if folder_id:
            _folder_or_404(session, folder_id)
        s = AutomationScript(
            id=new_id, name=name, folder_id=folder_id, project=src.project,
            linked_ids=list(src.linked_ids or []), language=src.language,
            types=list(src.types or []), frameworks=list(src.frameworks or []),
            model=src.model, provider=src.provider, tags=list(src.tags or []),
            notes=src.notes or "", version=1, files=dict(src.files or {}),
            mapping=list(src.mapping or []), warnings=list(src.warnings or []),
            created=now, updated=now,
        )
        session.add(s)
        session.flush()
        _add_version(session, s, note="Duplicated from " + src.id)
        return {"ok": True, "script": _script_detail(s)}


@router.delete("/scripts/{sid}")
def delete_script(sid: str):
    with _session() as session:
        s = _script_or_404(session, sid)
        _delete_script_row(session, s)
        return {"ok": True}


@router.get("/scripts/{sid}/versions")
def list_versions(sid: str):
    with _session() as session:
        s = _script_or_404(session, sid)
        rows = (session.query(ScriptVersion)
                .filter(ScriptVersion.script_id == s.id)
                .order_by(ScriptVersion.version.desc()).all())
        return {"ok": True, "current": s.version, "versions": [
            {"version": r.version, "note": r.note or "", "created": r.created or "",
             "model": r.model or "", "provider": r.provider or "",
             "file_count": len(r.files or {})}
            for r in rows
        ]}


@router.get("/scripts/{sid}/versions/{n}")
def get_version(sid: str, n: int):
    with _session() as session:
        s = _script_or_404(session, sid)
        r = (session.query(ScriptVersion)
             .filter(ScriptVersion.script_id == s.id, ScriptVersion.version == n)
             .first())
        if not r:
            raise ServiceError("Version not found.", 404)
        return {"ok": True, "version": r.version, "note": r.note or "", "created": r.created or "",
                "model": r.model or "", "provider": r.provider or "",
                "files": r.files if isinstance(r.files, dict) else {},
                "current_files": s.files if isinstance(s.files, dict) else {}}


@router.get("/scripts/{sid}/download")
def download_script(sid: str, file: str = Query("")):
    with _session() as session:
        s = _script_or_404(session, sid)
        files = s.files if isinstance(s.files, dict) else {}
        if file:
            path = file.replace("\\", "/").lstrip("/")
            if path not in files:
                raise ServiceError("File not found in this script.", 404)
            data = (files[path] or "").encode("utf-8")
            name = path.split("/")[-1] or "file.txt"
            return StreamingResponse(io.BytesIO(data), media_type="text/plain; charset=utf-8",
                                     headers={"Content-Disposition": f'attachment; filename="{name}"'})
        buf = _zip_bytes(files)
        fname = re.sub(r"[^\w.-]+", "_", s.name or s.id) + ".zip"
        return StreamingResponse(io.BytesIO(buf), media_type="application/zip",
                                 headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/counts")
def script_counts(ids: str = Query("")):
    """Scripts count per test case ID (comma-separated). Empty ids → all linked counts."""
    wanted = [x.strip() for x in (ids or "").split(",") if x.strip()]
    with _session() as session:
        tally: Dict[str, int] = {}
        for s in session.query(AutomationScript).all():
            for tid in (s.linked_ids or []):
                if wanted and tid not in wanted:
                    continue
                tally[tid] = tally.get(tid, 0) + 1
        return {"ok": True, "counts": tally}


@router.post("/folders/mirror")
def mirror_repo_folders(data: Dict[str, Any] = Body(...)):
    """Create a script-folder path matching Test Case Repo folders (by id or name path)."""
    from . import test_repo
    repo = test_repo._load()
    folders = {f["id"]: f for f in (repo.get("folders") or [])}
    src_id = str(data.get("folder_id") or data.get("repo_folder_id") or "").strip()
    names = data.get("path") or data.get("names") or []
    if src_id and src_id in folders:
        names = _repo_path_names(folders, src_id)
    if not names:
        raise ServiceError("Provide a Test Case Repo folder id or a path of names.")
    with _session() as session:
        parent = None
        created = []
        for name in names:
            name = str(name).strip()[:120]
            if not name:
                continue
            existing = (session.query(ScriptFolder)
                        .filter(ScriptFolder.parent == parent, ScriptFolder.name == name)
                        .first())
            if existing:
                parent = existing.id
                created.append(_folder_dict(existing))
                continue
            fid = _next(session, "script_fseq", "SF-")
            sibs = session.query(ScriptFolder).filter(ScriptFolder.parent == parent).all()
            f = ScriptFolder(id=fid, name=name, parent=parent, project="",
                             order=max((x.order for x in sibs), default=-1) + 1, description="")
            session.add(f)
            session.flush()
            parent = f.id
            created.append(_folder_dict(f))
        return {"ok": True, "folders": created, "folder_id": parent or ""}


# --------------------------------------------------------------------------- generate + recordings

def list_recordings_impl(sess) -> Dict[str, Any]:
    items = []
    run = (sess or {}).get("run") or {}
    rec = run.get("recording") or {}
    if rec.get("rid"):
        items.append({
            "rid": rec.get("rid"), "name": (rec.get("setup") or {}).get("name") or rec.get("rid"),
            "created": rec.get("created") or "", "steps": rec.get("n_steps") or len(rec.get("steps") or []),
            "source": "current-run",
        })
    try:
        from .recorder import REC_DIR, key_of, rec_dirs
        key = key_of(sess) if sess else ""
        if key:
            for d in rec_dirs(key):
                rid = d.name
                if any(x["rid"] == rid for x in items):
                    continue
                meta = {}
                for name in ("meta.json", "recording.json", "draft.json"):
                    p = d / name
                    if p.is_file():
                        try:
                            meta = json.loads(p.read_text(encoding="utf-8"))
                            break
                        except Exception:
                            meta = {}
                setup = meta.get("setup") or {}
                items.append({
                    "rid": rid,
                    "name": setup.get("name") or meta.get("name") or rid,
                    "created": meta.get("created") or "",
                    "steps": meta.get("n_steps") or len(meta.get("steps") or []),
                    "source": "library",
                })
    except Exception:
        log.debug("list recordings failed", exc_info=True)
    return {"ok": True, "recordings": items}


def generate_impl(data: Dict[str, Any], sess) -> Dict[str, Any]:
    cases = _normalize_cases(data.get("test_cases") or data.get("cases") or [])
    if not cases:
        raise ServiceError("Select at least one test case.")
    language = str(data.get("language") or "").strip()
    if not language:
        raise ServiceError("Language is required.")
    types = _str_list(data.get("types"))
    frameworks = _str_list(data.get("frameworks"))
    if not types:
        raise ServiceError("Select at least one type (UI, API, Database, or Mobile).")
    if not frameworks:
        raise ServiceError("Select at least one framework.")
    cat = so.get_catalogue()
    hints = []
    for fid in frameworks:
        fw = so.find_framework(fid, cat)
        if fw and fw.get("hint"):
            hints.append(f"- {fw.get('name') or fid}: {fw['hint']}")
        elif fw:
            hints.append(f"- {fw.get('name') or fid}")
        else:
            hints.append(f"- {fid}")
    locators = []
    rid = str(data.get("recording_id") or data.get("rid") or "").strip()
    if rid:
        locators = _recording_selectors(sess, rid)
    ctx = data.get("context") if isinstance(data.get("context"), dict) else data
    additional = str(data.get("additional_context") or data.get("additional") or "").strip()
    use_pom = bool(data.get("use_pom") if "use_pom" in data else ctx.get("use_pom", True))
    include_assertions = bool(data.get("include_assertions") if "include_assertions" in data else ctx.get("include_assertions", True))
    one_file = bool(data.get("one_file_per_test") if "one_file_per_test" in data else ctx.get("one_file_per_test", False))
    lang_name = language
    for x in cat.get("languages") or []:
        if x.get("id") == language or x.get("name") == language:
            lang_name = x.get("name") or language
            language = x.get("id") or language
            break

    prompt = _build_prompt(
        cases, lang_name, language, types, frameworks, hints, ctx,
        additional, locators, use_pom, include_assertions, one_file,
    )
    provider = str(data.get("provider") or "").strip().lower() or None
    model = str(data.get("model") or "").strip() or None

    if env("ATG_MOCK_GEMINI", "") == "1":
        parsed = _mock_result(cases, language, types, frameworks)
        in_tok = out_tok = 0
        used_model = "mock"
        used_provider = "mock"
    else:
        if not provider:
            try:
                from . import settings_store
                provider = settings_store.get_default_provider()
            except Exception:
                provider = "gemini"
        system, user = prompt, ""
        if "\n\n---USER---\n" in prompt:
            system, user = prompt.split("\n\n---USER---\n", 1)
        else:
            user = prompt
            system = "You are an expert test-automation engineer. Return only the requested JSON."
        try:
            out = services._complete(provider, system, user, temperature=0.2, model_name=model)
            raw = out.get("text") or ""
            usage = out.get("usage") or {}
            in_tok = int(usage.get("input_tokens") or 0)
            out_tok = int(usage.get("output_tokens") or 0)
            used_model = usage.get("model_name") or model or ""
            used_provider = usage.get("provider") or usage.get("model") or provider or ""
        except ServiceError:
            raise
        except Exception as e:
            log.exception("automation generate failed")
            raise ServiceError(str(e) or "Generation failed.")
        parsed = _parse_generate(raw)
        if not parsed.get("files"):
            raise ServiceError("The model did not return any script files. Try again or pick another model.")

    files = _as_files(parsed.get("files"))
    mapping = parsed.get("mapping") if isinstance(parsed.get("mapping"), list) else []
    warnings = parsed.get("warnings") if isinstance(parsed.get("warnings"), list) else []
    if locators and not any("locator" in str(w).lower() or "selector" in str(w).lower() for w in warnings):
        warnings = list(warnings)
    try:
        token_usage.record(
            action="Automation script",
            usage={
                "provider": used_provider or provider or "",
                "model": used_provider or provider or "",
                "model_name": used_model or model or "",
                "input_tokens": in_tok,
                "output_tokens": out_tok,
                "total_tokens": in_tok + out_tok,
            },
            run=(sess or {}).get("run"),
        )
    except Exception:
        log.debug("token record failed", exc_info=True)
    return {
        "ok": True,
        "files": [{"path": p, "content": c} for p, c in files.items()],
        "files_map": files,
        "mapping": mapping,
        "warnings": warnings,
        "language": language,
        "types": types,
        "frameworks": frameworks,
        "linked_ids": [c.get("id") for c in cases if c.get("id")],
        "provider": used_provider or provider or "",
        "model": used_model or model or "",
        "usage": {"input": in_tok, "output": out_tok},
        "recording_id": rid,
    }


def compose_estimate(data: Dict[str, Any]) -> Dict[str, str]:
    """Return {system, user} (or a single blob) for /api/tokens/estimate compose kind=automation."""
    cases = _normalize_cases(data.get("test_cases") or data.get("cases") or [])
    language = str(data.get("language") or "").strip() or "Java"
    types = _str_list(data.get("types")) or ["ui"]
    frameworks = _str_list(data.get("frameworks")) or ["playwright"]
    cat = so.get_catalogue()
    hints = []
    for fid in frameworks:
        fw = so.find_framework(fid, cat)
        if fw and fw.get("hint"):
            hints.append(f"- {fw.get('name') or fid}: {fw['hint']}")
    ctx = data.get("context") if isinstance(data.get("context"), dict) else data
    additional = str(data.get("additional_context") or data.get("additional") or "").strip()
    use_pom = bool(data.get("use_pom") if "use_pom" in data else True)
    include_assertions = bool(data.get("include_assertions") if "include_assertions" in data else True)
    one_file = bool(data.get("one_file_per_test") if "one_file_per_test" in data else False)
    locators = []
    prompt = _build_prompt(
        cases, language, language, types, frameworks, hints, ctx,
        additional, locators, use_pom, include_assertions, one_file,
    )
    # split system / user if we used the two-block form
    if "\n\n---USER---\n" in prompt:
        sys, user = prompt.split("\n\n---USER---\n", 1)
        return {"system": sys, "user": user}
    return {"prompt": prompt}


# --------------------------------------------------------------------------- helpers

def _str_list(val) -> List[str]:
    if val is None:
        return []
    if isinstance(val, str):
        return [x.strip() for x in val.split(",") if x.strip()]
    if isinstance(val, list):
        return [str(x).strip() for x in val if str(x).strip()]
    return []


def _add_version(session: Session, s: AutomationScript, note: str = "") -> ScriptVersion:
    v = ScriptVersion(
        script_id=s.id, version=int(s.version or 1),
        files=dict(s.files or {}), note=(note or "")[:500],
        model=s.model or "", provider=s.provider or "", created=_now(),
    )
    session.add(v)
    return v


def _delete_script_row(session: Session, s: AutomationScript) -> None:
    session.query(ScriptVersion).filter(ScriptVersion.script_id == s.id).delete()
    session.delete(s)


def _zip_bytes(files: Dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path, content in files.items():
            p = path.replace("\\", "/").lstrip("/")
            if not p or ".." in p:
                continue
            zf.writestr(p, content or "")
    return buf.getvalue()


def _repo_path_names(folders: Dict[str, Any], fid: str) -> List[str]:
    names = []
    seen = set()
    cur = fid
    while cur and cur in folders and cur not in seen:
        seen.add(cur)
        f = folders[cur]
        names.append(f.get("name") or cur)
        cur = f.get("parent") or ""
    names.reverse()
    return names


def _normalize_cases(raw) -> List[Dict[str, Any]]:
    out = []
    if not isinstance(raw, list):
        return out
    for c in raw:
        if not isinstance(c, dict):
            continue
        steps = c.get("steps") or []
        clean_steps = []
        for s in steps:
            if isinstance(s, dict):
                clean_steps.append({
                    "description": s.get("description") or s.get("step") or s.get("action") or "",
                    "expected": s.get("expected") or s.get("expected_result") or "",
                    "data": s.get("data") or s.get("test_data") or "",
                })
            else:
                clean_steps.append({"description": str(s), "expected": "", "data": ""})
        out.append({
            "id": str(c.get("id") or c.get("tc_id") or ""),
            "name": str(c.get("name") or c.get("title") or ""),
            "description": str(c.get("description") or ""),
            "precondition": str(c.get("precondition") or c.get("preconditions") or ""),
            "priority": str(c.get("priority") or ""),
            "type": str(c.get("type") or ""),
            "steps": clean_steps,
        })
    return out


def _recording_selectors(sess, rid: str) -> List[Dict[str, Any]]:
    if not rid or not _SAFE_ID.match(rid):
        return []
    blobs: List[Dict[str, Any]] = []
    run = (sess or {}).get("run") or {}
    rec = run.get("recording") or {}
    if rec.get("rid") == rid:
        blobs.append(rec)
    try:
        from .recorder import REC_DIR, key_of
        roots = []
        key = ""
        try:
            key = key_of(sess) if sess else ""
        except Exception:
            key = ""
        if key:
            roots.append(REC_DIR / key / rid)
        # also search sibling keys for this rid (same user machine, session-scoped)
        if REC_DIR.is_dir():
            for p in REC_DIR.glob("*/" + rid):
                if p not in roots:
                    roots.append(p)
        for root in roots:
            if not root.is_dir():
                continue
            for name in ("meta.json", "recording.json", "draft.json"):
                p = root / name
                if p.is_file():
                    try:
                        blobs.append(json.loads(p.read_text(encoding="utf-8")))
                    except Exception:
                        pass
    except Exception:
        log.debug("recording lookup failed", exc_info=True)
    locs = []
    seen = set()
    for blob in blobs:
        for s in blob.get("steps") or []:
            if not isinstance(s, dict):
                continue
            loc = s.get("loc") if isinstance(s.get("loc"), dict) else {}
            entry = {
                "kind": s.get("kind") or "",
                "desc": s.get("desc") or "",
                "css": loc.get("css") or "",
                "testid": loc.get("testid") or loc.get("test_id") or "",
                "role": loc.get("role") or "",
                "name": loc.get("name") or s.get("name") or "",
                "text": loc.get("text") or "",
            }
            key = json.dumps(entry, sort_keys=True)
            if key in seen:
                continue
            if any(entry[k] for k in ("css", "testid", "role", "name", "text")):
                seen.add(key)
                locs.append(entry)
    return locs[:80]


def _build_prompt(cases, lang_name, language, types, frameworks, hints, ctx,
                  additional, locators, use_pom, include_assertions, one_file) -> str:
    ctx = ctx or {}
    def _c(*keys, default=""):
        for k in keys:
            v = ctx.get(k)
            if v is not None and str(v).strip():
                return str(v).strip()
        return default
    ui_url = _c("ui_base_url", "base_url")
    api_url = _c("api_base_url")
    api_auth = _c("api_auth", "auth_type", default="none")
    db_type = _c("db_type")
    db_conn = _c("db_connection", "db_connection_placeholder")
    mob_plat = _c("mobile_platform", "platform")
    mob_dev = _c("mobile_device", "device")
    mob_app = _c("mobile_app", "app")
    sys = (
        "You are an expert test-automation engineer. Generate complete, runnable automated tests "
        "from the supplied manual test cases.\n"
        "Return ONLY a JSON object with this shape (no markdown fences around the JSON):\n"
        '{ "files": [ {"path": "relative/path.ext", "content": "full file contents"} ],\n'
        '  "mapping": [ {"tc_id": "TC001", "function": "test_fn_or_name", "file": "path"} ],\n'
        '  "warnings": ["optional notes about assumptions or missing data"] }\n'
        "Rules:\n"
        "- Use only the requested language and frameworks.\n"
        "- Group files in folders by type when several types are selected (ui/, api/, db/, mobile/).\n"
        "- Follow each framework's AI prompt hint below.\n"
        "- Do not invent secrets; use placeholders for credentials and connection strings.\n"
        "- Mapping must cover every supplied test case id.\n"
        "- If information is missing, make a reasonable assumption and add a warning.\n"
    )
    user_parts = [
        f"Language: {lang_name} (id: {language})",
        "Types: " + ", ".join(types),
        "Frameworks: " + ", ".join(frameworks),
        "Framework guidance:\n" + ("\n".join(hints) if hints else "(none)"),
        f"Page Object Model: {'yes' if use_pom else 'no'}",
        f"Include assertions: {'yes' if include_assertions else 'no'}",
        f"One file per test case: {'yes' if one_file else 'no'}",
    ]
    if "ui" in types:
        user_parts.append(f"UI base URL: {ui_url or '(not provided)'}")
    if "api" in types:
        user_parts.append(f"API base URL: {api_url or '(not provided)'}; auth type: {api_auth or 'none'}")
    if "database" in types:
        user_parts.append(f"Database type: {db_type or '(not provided)'}; connection placeholder: {db_conn or '(not provided)'}")
    if "mobile" in types:
        user_parts.append(f"Mobile platform: {mob_plat or '(not provided)'}; device: {mob_dev or '(not provided)'}; app: {mob_app or '(not provided)'}")
    if locators:
        lines = []
        for loc in locators:
            bit = ", ".join(f"{k}={v}" for k, v in loc.items() if v and k != "desc")
            lines.append(f"- {loc.get('kind') or 'step'} {loc.get('desc') or ''}: {bit}")
        user_parts.append("Recorded locators (prefer these over invented selectors):\n" + "\n".join(lines))
    if additional:
        user_parts.append("Additional context from the user:\n" + additional)
    # compact test cases
    tc_lines = []
    for c in cases:
        tc_lines.append(f"### {c.get('id') or ''} — {c.get('name') or ''}")
        if c.get("description"):
            tc_lines.append("Description: " + c["description"])
        if c.get("precondition"):
            tc_lines.append("Precondition: " + c["precondition"])
        if c.get("priority"):
            tc_lines.append("Priority: " + c["priority"])
        for i, s in enumerate(c.get("steps") or [], 1):
            tc_lines.append(f"  Step {i}: {s.get('description') or ''}")
            if s.get("expected"):
                tc_lines.append(f"    Expected: {s['expected']}")
            if s.get("data"):
                tc_lines.append(f"    Data: {s['data']}")
    user_parts.append("Test cases:\n" + "\n".join(tc_lines))
    return sys + "\n\n---USER---\n" + "\n\n".join(user_parts)


def _parse_generate(raw: str) -> Dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
        if text.endswith("```"):
            text = text[: text.rfind("```")].rstrip()
    i, j = text.find("{"), text.rfind("}")
    if i >= 0 and j > i:
        text = text[i : j + 1]
    try:
        data = json.loads(text)
    except Exception:
        # salvage: treat the whole raw output as a single file
        return {"files": [{"path": "output.txt", "content": raw or ""}],
                "mapping": [], "warnings": ["Model output was not valid JSON; saved as output.txt."]}
    if not isinstance(data, dict):
        return {"files": [], "mapping": [], "warnings": ["Model output was not a JSON object."]}
    files = data.get("files")
    if isinstance(files, dict):
        data["files"] = [{"path": k, "content": v} for k, v in files.items()]
    elif not isinstance(files, list):
        data["files"] = []
    if not isinstance(data.get("mapping"), list):
        data["mapping"] = []
    if not isinstance(data.get("warnings"), list):
        data["warnings"] = []
    return data


def _mock_result(cases, language, types, frameworks) -> Dict[str, Any]:
    ext = { "java": ".java", "python": ".py", "dotnet": ".cs", "javascript": ".js",
            "typescript": ".ts", "robot": ".robot" }.get(language, ".txt")
    files = []
    mapping = []
    type_dir = {"ui": "ui", "api": "api", "database": "db", "mobile": "mobile"}
    folders = [type_dir.get(t, t) for t in types] or ["tests"]
    first = folders[0]
    for c in cases:
        cid = c.get("id") or "TC"
        slug = re.sub(r"[^A-Za-z0-9]+", "_", cid).strip("_") or "case"
        path = f"{first}/{slug}{ext}"
        body = (
            f"// Autogenerated mock for {cid} — {c.get('name') or ''}\n"
            f"// Language: {language}; frameworks: {', '.join(frameworks)}\n"
            f"// Replace this mock by running without ATG_MOCK_GEMINI.\n"
        )
        if language == "python":
            body = (
                f'def test_{slug.lower()}():\n'
                f'    """{c.get("name") or cid}"""\n'
                f'    # frameworks: {", ".join(frameworks)}\n'
                f'    assert True\n'
            )
        elif language == "robot":
            body = f"*** Test Cases ***\n{c.get('name') or cid}\n    Log    {cid}\n"
        files.append({"path": path, "content": body})
        mapping.append({"tc_id": cid, "function": f"test_{slug.lower()}", "file": path})
    warnings = []
    if "database" in types:
        warnings.append("Used a placeholder connection string; replace it before running.")
    return {"files": files, "mapping": mapping, "warnings": warnings}


# Wire FastAPI routes that need the session after `current` is importable.

def attach(current) -> APIRouter:
    """Re-bind generate / recordings with the app's current-session dependency."""

    @router.post("/generate")
    def _gen(data: Dict[str, Any] = Body(...), sess=Depends(current)):
        return generate_impl(data, sess)

    @router.get("/recordings")
    def _recs(sess=Depends(current)):
        return list_recordings_impl(sess)

    from . import framework as framework_api
    from . import runner as runner_api
    framework_api.attach(router, current)
    runner_api.attach(router, current)

    return router
