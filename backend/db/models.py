"""SQLAlchemy 2.x models for Phase 1 product data and run history.

Foreign keys do not use ON DELETE CASCADE; archive/delete rules stay in application code.
Optional parent/folder ids are stored as NULL when the dict form uses "".
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import JSON


class Base(DeclarativeBase):
    pass


class Counter(Base):
    __tablename__ = "counters"
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    key: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    jira_project_key: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    qtest_project_id: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    zephyr_project_key: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    created: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    updated: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class RequirementFolder(Base):
    __tablename__ = "requirement_folders"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    parent: Mapped[Optional[str]] = mapped_column(
        String(32), ForeignKey("requirement_folders.id"), nullable=True
    )
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")


class Requirement(Base):
    __tablename__ = "requirements"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id"), nullable=False)
    folder_id: Mapped[Optional[str]] = mapped_column(
        String(32), ForeignKey("requirement_folders.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    acs: Mapped[Any] = mapped_column(JSON, nullable=False)
    type: Mapped[str] = mapped_column(String(30), nullable=False, default="Story")
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="Manual")
    jira_key: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    priority: Mapped[str] = mapped_column(String(30), nullable=False, default="Medium")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="Draft")
    created: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    updated: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    updated_by: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    activity: Mapped[Any] = mapped_column(JSON, nullable=False)


class RequirementLink(Base):
    """case_id is not a FK: unused cases can be deleted today even if a link remains."""
    __tablename__ = "requirement_links"
    __table_args__ = (UniqueConstraint("requirement_id", "case_id", name="uq_requirement_links"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    requirement_id: Mapped[str] = mapped_column(String(32), ForeignKey("requirements.id"), nullable=False)
    case_id: Mapped[str] = mapped_column(String(32), nullable=False)
    created: Mapped[str] = mapped_column(String(40), nullable=False, default="")


class RepoFolder(Base):
    __tablename__ = "repo_folders"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    parent: Mapped[Optional[str]] = mapped_column(
        String(32), ForeignKey("repo_folders.id"), nullable=True
    )
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")


class Case(Base):
    """folder_id has no FK: a case may briefly point at a missing folder in legacy data."""
    __tablename__ = "cases"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    precondition: Mapped[str] = mapped_column(Text, nullable=False, default="")
    priority: Mapped[str] = mapped_column(String(30), nullable=False, default="Medium")
    type: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    story: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    tags: Mapped[Any] = mapped_column(JSON, nullable=False)
    steps: Mapped[Any] = mapped_column(JSON, nullable=False)
    acs: Mapped[Any] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="Draft")
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="Manual")
    folder_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    updated: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    last_result: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    last_run: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    versions: Mapped[Any] = mapped_column(JSON, nullable=False)
    activity: Mapped[Any] = mapped_column(JSON, nullable=False)
    comments: Mapped[Any] = mapped_column(JSON, nullable=False)
    attachments: Mapped[Any] = mapped_column(JSON, nullable=False)


class Cycle(Base):
    __tablename__ = "cycles"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    release: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    sprint: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    build: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    env: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    start: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    end: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    assignee: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    owner: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="Active")
    created: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="")


class CycleItem(Base):
    """case_id is not a FK: cycles can retain items after a case is removed from the repo."""
    __tablename__ = "cycle_items"
    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    cycle_id: Mapped[str] = mapped_column(String(32), ForeignKey("cycles.id"), nullable=False)
    case_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    assignee: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="Not run")
    last_run: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    defects: Mapped[Any] = mapped_column(JSON, nullable=False)
    executions: Mapped[Any] = mapped_column(JSON, nullable=False)


class Execution(Base):
    """case_id is not a FK for the same reason as cycle_items."""
    __tablename__ = "executions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    cycle_id: Mapped[str] = mapped_column(String(32), ForeignKey("cycles.id"), nullable=False)
    item_key: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    case_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    case_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    ts: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    tester: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    steps: Mapped[Any] = mapped_column(JSON, nullable=False)
    auto_status: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="")
    override_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    comments: Mapped[str] = mapped_column(Text, nullable=False, default="")
    duration: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    defects: Mapped[Any] = mapped_column(JSON, nullable=False)
    build: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    env: Mapped[str] = mapped_column(String(200), nullable=False, default="")


class TokenLedger(Base):
    __tablename__ = "token_ledger"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    ts: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    action: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    mode: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    rid: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    run_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    batch_rid: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    batch_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    story_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    model: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    mock: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    input: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    provider: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    template: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    tags: Mapped[Any] = mapped_column(JSON, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    options: Mapped[Any] = mapped_column(JSON, nullable=False)
    builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class PromptTemplateMeta(Base):
    """Singleton row (id=1) for Default-prompt override and default_id."""
    __tablename__ = "prompt_template_meta"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    default_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    default_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    default_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    default_updated_at: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)


class HistoryEntry(Base):
    """One Run history index item (newest-first via descending position).

    Leftover fields such as children / rec are stored in extra so no data is lost.
    No FKs: FIFO and user-delete rules stay in application code.
    """
    __tablename__ = "history_entries"
    hid: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    rid: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    created: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    updated: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    story_id: Mapped[str] = mapped_column(Text, nullable=False, default="")
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reviewed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    extra: Mapped[Any] = mapped_column(JSON, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class HistorySnapshot(Base):
    """Full run or batch snapshot loaded lazily on Open / Excel."""
    __tablename__ = "history_snapshots"
    hid: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    payload: Mapped[Any] = mapped_column(JSON, nullable=False)


class HistorySeq(Base):
    """Per-browser daily sequence counters (seq / bseq). Trimmed to last 10 days in app code."""
    __tablename__ = "history_seq"
    hid: Mapped[str] = mapped_column(String(64), primary_key=True)
    key: Mapped[str] = mapped_column(String(16), primary_key=True)
    day: Mapped[str] = mapped_column(String(8), primary_key=True)
    n: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
