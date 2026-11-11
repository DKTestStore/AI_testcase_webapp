"""SQLite persistence for Phase 1 product data (repo, runs, requirements, tokens, settings, templates).

The live store is backend/app.db. Original JSON files are left in place as a backup
and are imported once when the database has no product data yet.
"""
from .engine import DB_PATH, get_engine, init_db, session_scope

# Re-exported persist API used by the store modules.
from .persist import (  # noqa: F401
    load_app_settings,
    load_prompt_templates,
    load_repo,
    load_requirements,
    load_runs,
    load_token_ledger,
    save_app_settings,
    save_prompt_templates,
    save_repo,
    save_requirements,
    save_runs,
    save_token_ledger,
    update_app_settings,
)

__all__ = [
    "DB_PATH",
    "get_engine",
    "init_db",
    "session_scope",
    "load_repo",
    "save_repo",
    "load_runs",
    "save_runs",
    "load_requirements",
    "save_requirements",
    "load_token_ledger",
    "save_token_ledger",
    "load_app_settings",
    "save_app_settings",
    "update_app_settings",
    "load_prompt_templates",
    "save_prompt_templates",
]
