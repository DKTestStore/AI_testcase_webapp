"""One-time import of Phase 1 JSON files into an empty SQLite database.

The original JSON files are not modified or deleted. Cleanups that the JSON
loaders already apply (repo fver migration, token TU- backfill, Local project,
missing optional fields) run in memory before insert.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

log = logging.getLogger("atg.db")

BACKEND = Path(__file__).resolve().parent.parent
REPO_FILE = BACKEND / "test_repo" / "repo.json"
RUNS_FILE = BACKEND / "test_repo" / "runs.json"
REQ_FILE = BACKEND / "test_repo" / "requirements.json"
TOKEN_FILE = BACKEND / "token_usage.json"
SETTINGS_FILE = BACKEND / "app_settings.json"
TEMPLATES_FILE = BACKEND / "prompt_templates.json"


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        log.exception("Failed to read %s; treating as missing", path)
        return default


def _max_num(ids: Iterable[str], prefix: str) -> int:
    n = 0
    plen = len(prefix)
    for raw in ids:
        i = str(raw or "")
        if not i.startswith(prefix):
            continue
        rest = i[plen:]
        if rest.isdigit():
            n = max(n, int(rest))
    return n


def _prepare_repo(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    # Use the existing in-memory migration (do not write JSON).
    from ..test_repo import _migrate
    d = dict(raw)
    d.setdefault("seq", 0)
    d.setdefault("fseq", 0)
    d.setdefault("folders", [])
    d.setdefault("cases", [])
    if d.get("fver", 1) < 2 and (d["folders"] or d["cases"]):
        _migrate(d)
    d["fver"] = 2
    for c in d["cases"]:
        c.setdefault("activity", [])
        c.setdefault("comments", [])
        c.setdefault("attachments", [])
        c.setdefault("versions", [])
        c.setdefault("tags", [])
        c.setdefault("steps", [])
        c.setdefault("acs", [])
    d["seq"] = max(int(d.get("seq") or 0), _max_num((c.get("id") for c in d["cases"]), "TC-"))
    d["fseq"] = max(int(d.get("fseq") or 0), _max_num((f.get("id") for f in d["folders"]), "F"))
    return d


def _prepare_runs(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    d = dict(raw)
    d.setdefault("seq", 0)
    d.setdefault("eseq", 0)
    d.setdefault("cycles", [])
    d.setdefault("executions", [])
    d["seq"] = max(int(d.get("seq") or 0), _max_num((c.get("id") for c in d["cycles"]), "CY-"))
    d["eseq"] = max(int(d.get("eseq") or 0), _max_num((e.get("id") for e in d["executions"]), "EX-"))
    return d


def _prepare_requirements(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    from ..requirements_repo import _ensure_local
    d = dict(raw)
    d.setdefault("pseq", 0)
    d.setdefault("rseq", 0)
    d.setdefault("fseq", 0)
    d.setdefault("projects", [])
    d.setdefault("folders", [])
    d.setdefault("requirements", [])
    d.setdefault("links", [])
    _ensure_local(d)
    for r in d["requirements"]:
        r.setdefault("activity", [])
        r.setdefault("acs", [])
        # updated_by may be absent on imported-from-paste records; leave missing
        # unless already present (save writes "" if omitted).
    d["pseq"] = max(int(d.get("pseq") or 0), _max_num((p.get("id") for p in d["projects"]), "PRJ-"))
    d["rseq"] = max(int(d.get("rseq") or 0), _max_num((r.get("id") for r in d["requirements"]), "REQ-"))
    d["fseq"] = max(int(d.get("fseq") or 0), _max_num((f.get("id") for f in d["folders"]), "RF-"))
    return d


def _prepare_tokens(raw: Any) -> Optional[List[Dict[str, Any]]]:
    data = raw if isinstance(raw, list) else []
    if raw is None:
        return None
    if not TOKEN_FILE.is_file() and not data:
        return None
    from ..token_usage import _ensure_ids
    _ensure_ids(data)
    return data


def _prepare_settings(raw: Any) -> Optional[Dict[str, Any]]:
    if not SETTINGS_FILE.is_file():
        return None
    if not isinstance(raw, dict):
        return {}
    from .persist import SETTINGS_KEYS
    return {k: raw[k] for k in SETTINGS_KEYS if k in raw}


def _prepare_templates(raw: Any) -> Optional[Dict[str, Any]]:
    if not TEMPLATES_FILE.is_file():
        return None
    if isinstance(raw, dict) and isinstance(raw.get("templates"), list):
        return raw
    return {"default_id": "default", "templates": [], "default_used": 0}


def import_legacy_json(session: Session) -> Dict[str, int]:
    """Import any present Phase 1 JSON files into `session` (one transaction)."""
    from .persist import (
        save_app_settings,
        save_prompt_templates,
        save_repo,
        save_requirements,
        save_runs,
        save_token_ledger,
    )

    counts = {
        "projects": 0,
        "requirement_folders": 0,
        "requirements": 0,
        "links": 0,
        "repo_folders": 0,
        "cases": 0,
        "cycles": 0,
        "cycle_items": 0,
        "executions": 0,
        "token_rows": 0,
        "templates": 0,
        "settings_keys": 0,
    }

    repo = _prepare_repo(_read_json(REPO_FILE, {})) if REPO_FILE.is_file() else None
    runs = _prepare_runs(_read_json(RUNS_FILE, {})) if RUNS_FILE.is_file() else None
    reqs = _prepare_requirements(_read_json(REQ_FILE, {})) if REQ_FILE.is_file() else None
    tokens = _prepare_tokens(_read_json(TOKEN_FILE, []))
    settings = _prepare_settings(_read_json(SETTINGS_FILE, {}))
    templates = _prepare_templates(_read_json(TEMPLATES_FILE, {}))

    if not any(x is not None for x in (repo, runs, reqs, tokens, settings, templates)):
        log.info("No Phase 1 JSON files found to import")
        return counts

    try:
        if repo is not None:
            save_repo(repo, session=session, commit=False)
            counts["repo_folders"] = len(repo.get("folders") or [])
            counts["cases"] = len(repo.get("cases") or [])
        if runs is not None:
            save_runs(runs, session=session, commit=False)
            counts["cycles"] = len(runs.get("cycles") or [])
            counts["cycle_items"] = sum(len(c.get("items") or []) for c in (runs.get("cycles") or []))
            counts["executions"] = len(runs.get("executions") or [])
        if reqs is not None:
            save_requirements(reqs, session=session, commit=False)
            counts["projects"] = len(reqs.get("projects") or [])
            counts["requirement_folders"] = len(reqs.get("folders") or [])
            counts["requirements"] = len(reqs.get("requirements") or [])
            counts["links"] = len(reqs.get("links") or [])
        if tokens is not None:
            save_token_ledger(tokens, session=session, commit=False)
            counts["token_rows"] = len(tokens)
        if settings is not None:
            save_app_settings(settings, session=session, commit=False)
            counts["settings_keys"] = len(settings)
        if templates is not None:
            save_prompt_templates(templates, session=session, commit=False)
            counts["templates"] = len(templates.get("templates") or [])
        from .persist import _set_counter
        _set_counter(session, "_phase1_json_imported", 1)
        session.commit()
    except Exception:
        session.rollback()
        log.exception("JSON import into SQLite failed; original JSON files were not changed")
        raise

    log.info(
        "Imported Phase 1 JSON into %s: projects=%s requirement_folders=%s requirements=%s links=%s "
        "repo_folders=%s cases=%s cycles=%s cycle_items=%s executions=%s token_rows=%s templates=%s settings_keys=%s",
        BACKEND / "app.db",
        counts["projects"],
        counts["requirement_folders"],
        counts["requirements"],
        counts["links"],
        counts["repo_folders"],
        counts["cases"],
        counts["cycles"],
        counts["cycle_items"],
        counts["executions"],
        counts["token_rows"],
        counts["templates"],
        counts["settings_keys"],
    )
    return counts
