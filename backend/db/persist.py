"""Load/save the same dict shapes the JSON stores used, from/to SQLite."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from .engine import init_db, session_scope

# When called from first-start import (inside init_db), pass session=... and commit=False.
from .models import (
    AppSetting,
    Case,
    Counter,
    Cycle,
    CycleItem,
    Execution,
    Project,
    PromptTemplate,
    PromptTemplateMeta,
    RepoFolder,
    Requirement,
    RequirementFolder,
    RequirementLink,
    TokenLedger,
)

SETTINGS_KEYS = (
    "history_limit",
    "dup_threshold",
    "token_daily_limit",
    "token_rate_input",
    "token_rate_output",
)

REPO_SEQ = "repo_seq"
REPO_FSEQ = "repo_fseq"
RUNS_SEQ = "runs_seq"
RUNS_ESEQ = "runs_eseq"
REQ_PSEQ = "req_pseq"
REQ_RSEQ = "req_rseq"
REQ_FSEQ = "req_fseq"



def _sess(session: Optional[Session] = None):
    """Yield (session, owns). owns=True means we opened it and must commit/close."""
    if session is not None:
        return session, False
    init_db()
    return session_scope(), True


def _s(v: Any, default: str = "") -> str:
    if v is None:
        return default
    return str(v)


def _empty_to_none(v: Any) -> Optional[str]:
    s = _s(v)
    return s if s else None


def _none_to_empty(v: Any) -> str:
    return "" if v is None else str(v)


def _json_list(v: Any) -> list:
    return list(v) if isinstance(v, list) else []


def _json_obj(v: Any, default: Any) -> Any:
    return default if v is None else v


def _get_counter(session: Session, name: str, default: int = 0) -> int:
    row = session.get(Counter, name)
    return int(row.value) if row is not None else default


def _set_counter(session: Session, name: str, value: int) -> None:
    row = session.get(Counter, name)
    if row is None:
        session.add(Counter(name=name, value=int(value)))
    else:
        row.value = int(value)


def _defer_fks(session: Session) -> None:
    session.execute(text("PRAGMA defer_foreign_keys=ON"))


def _replace_rows(session: Session, model, rows: Iterable[Any]) -> None:
    session.query(model).delete()
    for row in rows:
        session.add(row)


# --------------------------------------------------------------------------- repo
def load_repo(*, session: Optional[Session] = None) -> Dict[str, Any]:
    session, owns = _sess(session)
    try:
        folders = []
        for f in session.query(RepoFolder).all():
            folders.append({
                "id": f.id,
                "name": f.name or "",
                "parent": _none_to_empty(f.parent),
                "order": int(f.order or 0),
                "description": f.description or "",
            })
        cases = []
        for c in session.query(Case).all():
            cases.append({
                "id": c.id,
                "title": c.title or "",
                "description": c.description or "",
                "precondition": c.precondition or "",
                "priority": c.priority or "Medium",
                "type": c.type or "",
                "story": c.story or "",
                "tags": _json_list(c.tags),
                "steps": _json_list(c.steps),
                "acs": _json_list(c.acs),
                "status": c.status or "Draft",
                "source": c.source or "Manual",
                "folder_id": c.folder_id or "",
                "version": int(c.version or 1),
                "created": c.created or "",
                "updated": c.updated or "",
                "last_result": c.last_result or "",
                "last_run": c.last_run or "",
                "versions": _json_list(c.versions),
                "activity": _json_list(c.activity),
                "comments": _json_list(c.comments),
                "attachments": _json_list(c.attachments),
            })
        return {
            "seq": _get_counter(session, REPO_SEQ),
            "fseq": _get_counter(session, REPO_FSEQ),
            "folders": folders,
            "cases": cases,
            "fver": 2,
        }
    finally:
        if owns:
            session.close()


def save_repo(d: Dict[str, Any], *, session: Optional[Session] = None, commit: bool = True) -> None:
    session, owns = _sess(session)
    try:
        _defer_fks(session)
        _replace_rows(session, RepoFolder, [
            RepoFolder(
                id=_s(f.get("id")),
                name=_s(f.get("name")),
                parent=_empty_to_none(f.get("parent")),
                order=int(f.get("order") or 0),
                description=_s(f.get("description")),
            )
            for f in (d.get("folders") or []) if _s(f.get("id"))
        ])
        _replace_rows(session, Case, [
            Case(
                id=_s(c.get("id")),
                title=_s(c.get("title")),
                description=_s(c.get("description")),
                precondition=_s(c.get("precondition")),
                priority=_s(c.get("priority") or "Medium"),
                type=_s(c.get("type")),
                story=_s(c.get("story")),
                tags=_json_list(c.get("tags")),
                steps=_json_list(c.get("steps")),
                acs=_json_list(c.get("acs")),
                status=_s(c.get("status") or "Draft"),
                source=_s(c.get("source") or "Manual"),
                folder_id=_s(c.get("folder_id")),
                version=int(c.get("version") or 1),
                created=_s(c.get("created")),
                updated=_s(c.get("updated")),
                last_result=_s(c.get("last_result")),
                last_run=_s(c.get("last_run")),
                versions=_json_list(c.get("versions")),
                activity=_json_list(c.get("activity")),
                comments=_json_list(c.get("comments")),
                attachments=_json_list(c.get("attachments")),
            )
            for c in (d.get("cases") or []) if _s(c.get("id"))
        ])
        _set_counter(session, REPO_SEQ, int(d.get("seq") or 0))
        _set_counter(session, REPO_FSEQ, int(d.get("fseq") or 0))
        if commit or owns:
            session.commit()
    finally:
        if owns:
            session.close()


# --------------------------------------------------------------------------- runs
_CYCLE_FIELDS = ("name", "description", "release", "sprint", "build", "env", "start", "end", "assignee", "owner")


def load_runs(*, session: Optional[Session] = None) -> Dict[str, Any]:
    session, owns = _sess(session)
    try:
        items_by: Dict[str, List[dict]] = {}
        for it in session.query(CycleItem).all():
            items_by.setdefault(it.cycle_id, []).append({
                "key": it.key,
                "case_id": it.case_id or "",
                "order": int(it.order or 0),
                "assignee": it.assignee or "",
                "status": it.status or "Not run",
                "last_run": it.last_run or "",
                "defects": _json_list(it.defects),
                "executions": _json_list(it.executions),
            })
        cycles = []
        for c in session.query(Cycle).all():
            items = items_by.get(c.id, [])
            items.sort(key=lambda i: i.get("order") or 0)
            row = {k: _s(getattr(c, k, "")) for k in _CYCLE_FIELDS}
            row.update({
                "id": c.id,
                "status": c.status or "Active",
                "created": c.created or "",
                "source": c.source or "",
                "items": items,
            })
            cycles.append(row)
        executions = []
        for e in session.query(Execution).all():
            executions.append({
                "id": e.id,
                "cycle_id": e.cycle_id,
                "item_key": e.item_key or "",
                "case_id": e.case_id or "",
                "case_version": int(e.case_version or 1),
                "ts": e.ts or "",
                "tester": e.tester or "",
                "steps": _json_list(e.steps),
                "auto_status": e.auto_status or "",
                "status": e.status or "",
                "override_reason": e.override_reason or "",
                "comments": e.comments or "",
                "duration": int(e.duration or 0),
                "defects": _json_list(e.defects),
                "build": e.build or "",
                "env": e.env or "",
            })
        return {
            "seq": _get_counter(session, RUNS_SEQ),
            "eseq": _get_counter(session, RUNS_ESEQ),
            "cycles": cycles,
            "executions": executions,
        }
    finally:
        if owns:
            session.close()


def save_runs(d: Dict[str, Any], *, session: Optional[Session] = None, commit: bool = True) -> None:
    session, owns = _sess(session)
    try:
        _defer_fks(session)
        # children first when not deferred would fail; deferred lets us replace all
        session.query(Execution).delete()
        session.query(CycleItem).delete()
        session.query(Cycle).delete()
        for c in (d.get("cycles") or []):
            cid = _s(c.get("id"))
            if not cid:
                continue
            session.add(Cycle(
                id=cid,
                **{k: _s(c.get(k)) for k in _CYCLE_FIELDS},
                status=_s(c.get("status") or "Active"),
                created=_s(c.get("created")),
                source=_s(c.get("source")),
            ))
            for it in (c.get("items") or []):
                key = _s(it.get("key"))
                if not key:
                    continue
                session.add(CycleItem(
                    key=key,
                    cycle_id=cid,
                    case_id=_s(it.get("case_id")),
                    order=int(it.get("order") or 0),
                    assignee=_s(it.get("assignee")),
                    status=_s(it.get("status") or "Not run"),
                    last_run=_s(it.get("last_run")),
                    defects=_json_list(it.get("defects")),
                    executions=_json_list(it.get("executions")),
                ))
        for e in (d.get("executions") or []):
            eid = _s(e.get("id"))
            if not eid:
                continue
            session.add(Execution(
                id=eid,
                cycle_id=_s(e.get("cycle_id")),
                item_key=_s(e.get("item_key")),
                case_id=_s(e.get("case_id")),
                case_version=int(e.get("case_version") or 1),
                ts=_s(e.get("ts")),
                tester=_s(e.get("tester")),
                steps=_json_list(e.get("steps")),
                auto_status=_s(e.get("auto_status")),
                status=_s(e.get("status")),
                override_reason=_s(e.get("override_reason")),
                comments=_s(e.get("comments")),
                duration=int(e.get("duration") or 0),
                defects=_json_list(e.get("defects")),
                build=_s(e.get("build")),
                env=_s(e.get("env")),
            ))
        _set_counter(session, RUNS_SEQ, int(d.get("seq") or 0))
        _set_counter(session, RUNS_ESEQ, int(d.get("eseq") or 0))
        if commit or owns:
            session.commit()
    finally:
        if owns:
            session.close()


# --------------------------------------------------------------------------- requirements
def load_requirements(*, session: Optional[Session] = None) -> Dict[str, Any]:
    session, owns = _sess(session)
    try:
        projects = []
        for p in session.query(Project).all():
            projects.append({
                "id": p.id,
                "key": p.key or "",
                "name": p.name or "",
                "description": p.description or "",
                "jira_project_key": p.jira_project_key or "",
                "qtest_project_id": p.qtest_project_id or "",
                "zephyr_project_key": p.zephyr_project_key or "",
                "created": p.created or "",
                "updated": p.updated or "",
                "system": bool(p.system),
            })
        folders = []
        for f in session.query(RequirementFolder).all():
            folders.append({
                "id": f.id,
                "name": f.name or "",
                "parent": _none_to_empty(f.parent),
                "project_id": f.project_id,
                "order": int(f.order or 0),
                "description": f.description or "",
            })
        requirements = []
        for r in session.query(Requirement).all():
            rec = {
                "id": r.id,
                "project_id": r.project_id or "",
                "folder_id": _none_to_empty(r.folder_id),
                "title": r.title or "",
                "description": r.description or "",
                "acs": _json_list(r.acs),
                "type": r.type or "Story",
                "source": r.source or "Manual",
                "jira_key": r.jira_key or "",
                "priority": r.priority or "Medium",
                "status": r.status or "Draft",
                "created": r.created or "",
                "updated": r.updated or "",
                "activity": _json_list(r.activity),
            }
            # Preserve updated_by when present (import records may historically omit it).
            if r.updated_by:
                rec["updated_by"] = r.updated_by
            requirements.append(rec)
        links = [
            {"requirement_id": l.requirement_id, "case_id": l.case_id, "created": l.created or ""}
            for l in session.query(RequirementLink).all()
        ]
        return {
            "pseq": _get_counter(session, REQ_PSEQ),
            "rseq": _get_counter(session, REQ_RSEQ),
            "fseq": _get_counter(session, REQ_FSEQ),
            "projects": projects,
            "folders": folders,
            "requirements": requirements,
            "links": links,
        }
    finally:
        if owns:
            session.close()


def save_requirements(d: Dict[str, Any], *, session: Optional[Session] = None, commit: bool = True) -> None:
    session, owns = _sess(session)
    try:
        _defer_fks(session)
        session.query(RequirementLink).delete()
        session.query(Requirement).delete()
        session.query(RequirementFolder).delete()
        session.query(Project).delete()
        for p in (d.get("projects") or []):
            pid = _s(p.get("id"))
            if not pid:
                continue
            session.add(Project(
                id=pid,
                key=_s(p.get("key")),
                name=_s(p.get("name")),
                description=_s(p.get("description")),
                jira_project_key=_s(p.get("jira_project_key")),
                qtest_project_id=_s(p.get("qtest_project_id")),
                zephyr_project_key=_s(p.get("zephyr_project_key")),
                created=_s(p.get("created")),
                updated=_s(p.get("updated")),
                system=bool(p.get("system")),
            ))
        for f in (d.get("folders") or []):
            fid = _s(f.get("id"))
            if not fid:
                continue
            session.add(RequirementFolder(
                id=fid,
                name=_s(f.get("name")),
                parent=_empty_to_none(f.get("parent")),
                project_id=_s(f.get("project_id")),
                order=int(f.get("order") or 0),
                description=_s(f.get("description")),
            ))
        for r in (d.get("requirements") or []):
            rid = _s(r.get("id"))
            if not rid:
                continue
            session.add(Requirement(
                id=rid,
                project_id=_s(r.get("project_id")),
                folder_id=_empty_to_none(r.get("folder_id")),
                title=_s(r.get("title")),
                description=_s(r.get("description")),
                acs=_json_list(r.get("acs")),
                type=_s(r.get("type") or "Story"),
                source=_s(r.get("source") or "Manual"),
                jira_key=_s(r.get("jira_key")),
                priority=_s(r.get("priority") or "Medium"),
                status=_s(r.get("status") or "Draft"),
                created=_s(r.get("created")),
                updated=_s(r.get("updated")),
                updated_by=_s(r.get("updated_by")),
                activity=_json_list(r.get("activity")),
            ))
        for l in (d.get("links") or []):
            if not _s(l.get("requirement_id")) or not _s(l.get("case_id")):
                continue
            session.add(RequirementLink(
                requirement_id=_s(l.get("requirement_id")),
                case_id=_s(l.get("case_id")),
                created=_s(l.get("created")),
            ))
        _set_counter(session, REQ_PSEQ, int(d.get("pseq") or 0))
        _set_counter(session, REQ_RSEQ, int(d.get("rseq") or 0))
        _set_counter(session, REQ_FSEQ, int(d.get("fseq") or 0))
        if commit or owns:
            session.commit()
    finally:
        if owns:
            session.close()


# --------------------------------------------------------------------------- token ledger
_TOKEN_STR = ("ts", "action", "mode", "rid", "run_id", "batch_rid", "batch_id", "story_id", "title", "source", "model", "provider")


def load_token_ledger(*, session: Optional[Session] = None) -> List[Dict[str, Any]]:
    session, owns = _sess(session)
    try:
        out = []
        for e in session.query(TokenLedger).all():
            rec = {
                "id": e.id,
                "ts": e.ts or "",
                "action": e.action or "",
                "mode": e.mode or "",
                "rid": e.rid or "",
                "run_id": e.run_id or "",
                "batch_rid": e.batch_rid or "",
                "batch_id": e.batch_id or "",
                "story_id": e.story_id or "",
                "title": e.title or "",
                "source": e.source or "",
                "model": e.model or "",
                "mock": bool(e.mock),
                "input": int(e.input or 0),
                "output": int(e.output or 0),
                "total": int(e.total or 0),
                "provider": e.provider or "",
                "est_input": int(getattr(e, "est_input", 0) or 0),
                "est_output": int(getattr(e, "est_output", 0) or 0),
                "est_cost": float(getattr(e, "est_cost", 0) or 0),
                "actual_cost": float(getattr(e, "actual_cost", 0) or 0),
                "rate_source": getattr(e, "rate_source", None) or "legacy_global",
            }
            if e.template:
                rec["template"] = e.template
            out.append(rec)
        return out
    finally:
        if owns:
            session.close()


def save_token_ledger(data: List[Dict[str, Any]], *, session: Optional[Session] = None, commit: bool = True) -> None:
    session, owns = _sess(session)
    try:
        session.query(TokenLedger).delete()
        seen = set()
        for e in data or []:
            if not isinstance(e, dict):
                continue
            eid = _s(e.get("id")).strip()
            if not eid or eid in seen:
                continue
            seen.add(eid)
            session.add(TokenLedger(
                id=eid,
                ts=_s(e.get("ts")),
                action=_s(e.get("action")),
                mode=_s(e.get("mode")),
                rid=_s(e.get("rid")),
                run_id=_s(e.get("run_id")),
                batch_rid=_s(e.get("batch_rid")),
                batch_id=_s(e.get("batch_id")),
                story_id=_s(e.get("story_id")),
                title=_s(e.get("title")),
                source=_s(e.get("source")),
                model=_s(e.get("model")),
                mock=bool(e.get("mock")),
                input=int(e.get("input") or 0),
                output=int(e.get("output") or 0),
                total=int(e.get("total") or 0),
                provider=_s(e.get("provider")),
                template=(_s(e.get("template"))[:80] or None) if e.get("template") else None,
                est_input=int(e.get("est_input") or 0),
                est_output=int(e.get("est_output") or 0),
                est_cost=float(e.get("est_cost") or 0),
                actual_cost=float(e.get("actual_cost") or 0),
                rate_source=(_s(e.get("rate_source")) or "legacy_global")[:20],
            ))
        if commit or owns:
            session.commit()
    finally:
        if owns:
            session.close()


# --------------------------------------------------------------------------- app settings
def load_app_settings(*, session: Optional[Session] = None) -> Dict[str, Any]:
    session, owns = _sess(session)
    try:
        out: Dict[str, Any] = {}
        for row in session.query(AppSetting).all():
            if row.key in SETTINGS_KEYS:
                out[row.key] = row.value
        return out
    finally:
        if owns:
            session.close()


def save_app_settings(data: Dict[str, Any], *, session: Optional[Session] = None, commit: bool = True) -> None:
    """Replace the five known keys; extra keys in `data` are ignored."""
    session, owns = _sess(session)
    try:
        session.query(AppSetting).delete()
        for k in SETTINGS_KEYS:
            if k in (data or {}):
                session.add(AppSetting(key=k, value=data[k]))
        if commit or owns:
            session.commit()
    finally:
        if owns:
            session.close()


def update_app_settings(values: Dict[str, Any], *, session: Optional[Session] = None, commit: bool = True) -> Dict[str, Any]:
    """Merge known keys into the settings table (shared by settings_store and token_usage)."""
    session, owns = _sess(session)
    try:
        for k, v in (values or {}).items():
            if k not in SETTINGS_KEYS:
                continue
            row = session.get(AppSetting, k)
            if row is None:
                session.add(AppSetting(key=k, value=v))
            else:
                row.value = v
        if commit or owns:
            session.commit()
        return load_app_settings(session=session) if not owns else load_app_settings()
    finally:
        if owns:
            session.close()


# --------------------------------------------------------------------------- prompt templates
def load_prompt_templates(*, session: Optional[Session] = None) -> Optional[Dict[str, Any]]:
    """Return the catalog dict, or None if no templates and no meta have been stored yet."""
    session, owns = _sess(session)
    try:
        templates = []
        for t in session.query(PromptTemplate).all():
            templates.append({
                "id": t.id,
                "name": t.name or "",
                "description": t.description or "",
                "tags": _json_list(t.tags),
                "text": t.text or "",
                "options": _json_obj(t.options, {}),
                "builtin": bool(t.builtin),
                "updated_at": t.updated_at or "",
                "used": int(t.used or 0),
            })
        meta = session.get(PromptTemplateMeta, 1)
        if not templates and meta is None:
            return None
        d: Dict[str, Any] = {
            "default_id": (meta.default_id if meta else "default") or "default",
            "templates": templates,
            "default_used": int(meta.default_used) if meta else 0,
        }
        if meta and meta.default_text:
            d["default_text"] = meta.default_text
        if meta and meta.default_updated_at:
            d["default_updated_at"] = meta.default_updated_at
        return d
    finally:
        if owns:
            session.close()


def save_prompt_templates(d: Dict[str, Any], *, session: Optional[Session] = None, commit: bool = True) -> None:
    session, owns = _sess(session)
    try:
        session.query(PromptTemplate).delete()
        for t in (d.get("templates") or []):
            tid = _s(t.get("id"))
            if not tid:
                continue
            session.add(PromptTemplate(
                id=tid,
                name=_s(t.get("name")),
                description=_s(t.get("description")),
                tags=_json_list(t.get("tags")),
                text=_s(t.get("text")),
                options=_json_obj(t.get("options"), {}),
                builtin=bool(t.get("builtin")),
                updated_at=_s(t.get("updated_at")),
                used=int(t.get("used") or 0),
            ))
        meta = session.get(PromptTemplateMeta, 1)
        if meta is None:
            meta = PromptTemplateMeta(id=1)
            session.add(meta)
        meta.default_id = _s(d.get("default_id") or "default") or "default"
        meta.default_used = int(d.get("default_used") or 0)
        text = d.get("default_text")
        meta.default_text = text if isinstance(text, str) and text.strip() else None
        meta.default_updated_at = _s(d.get("default_updated_at")) or None
        if commit or owns:
            session.commit()
    finally:
        if owns:
            session.close()
