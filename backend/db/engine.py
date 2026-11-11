"""SQLite engine, WAL/foreign_keys/busy_timeout, Alembic upgrade, first-start JSON import."""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from ..config import ROOT_DIR

log = logging.getLogger("atg.db")

DB_PATH = Path(__file__).resolve().parent.parent / "app.db"
ALEMBIC_INI = ROOT_DIR / "alembic.ini"

_engine: Engine | None = None
_SessionLocal: sessionmaker | None = None
_ready = False
_initializing = False
_init_lock = threading.RLock()


def _sqlite_url(path: Path) -> str:
    return "sqlite:///" + path.resolve().as_posix()


def _apply_pragmas(dbapi_conn, _connection_record=None) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.close()


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        eng = create_engine(
            _sqlite_url(DB_PATH),
            echo=False,
            future=True,
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        event.listen(eng, "connect", _apply_pragmas)
        _engine = eng
        _SessionLocal = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    return _engine


def session_scope() -> Session:
    init_db()
    assert _SessionLocal is not None
    return _SessionLocal()


def _run_alembic() -> None:
    from alembic import command
    from alembic.config import Config

    if not ALEMBIC_INI.is_file():
        raise RuntimeError(f"Alembic config not found: {ALEMBIC_INI}")
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("sqlalchemy.url", _sqlite_url(DB_PATH))
    # script_location in alembic.ini is relative to the ini file (repo root)
    command.upgrade(cfg, "head")


def _product_is_empty(session: Session) -> bool:
    """True when no Phase 1 product rows or non-zero counters exist (tables may already exist)."""
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

    for model in (
        Project,
        RequirementFolder,
        Requirement,
        RequirementLink,
        RepoFolder,
        Case,
        Cycle,
        CycleItem,
        Execution,
        TokenLedger,
        PromptTemplate,
        AppSetting,
    ):
        if session.query(model).first() is not None:
            return False
    meta = session.query(PromptTemplateMeta).first()
    if meta is not None and (
        (meta.default_text and str(meta.default_text).strip())
        or (meta.default_used or 0) > 0
        or (meta.default_id and meta.default_id != "default")
    ):
        return False
    for c in session.query(Counter).all():
        # Any counter row (including the import marker, even when seq is 0) means we already imported or used the DB.
        return False
    return True


def init_db() -> None:
    """Run Alembic migrations and, if the DB has no product data, import leftover JSON once."""
    global _ready, _initializing
    if _ready:
        return
    with _init_lock:
        if _ready:
            return
        if _initializing:
            # Mid-init re-entry (e.g. a cleanup helper touching settings): engine/tables only.
            return
        _initializing = True
        try:
            get_engine()
            _run_alembic()
            from .import_json import import_legacy_json

            assert _SessionLocal is not None
            with _SessionLocal() as session:
                if _product_is_empty(session):
                    import_legacy_json(session)
                else:
                    log.info("SQLite already has product data at %s; skipping JSON import", DB_PATH)
            _ready = True
            log.info("SQLite ready at %s", DB_PATH)
        finally:
            _initializing = False
