"""Phase 1 SQLite schema for repo, runs, requirements, tokens, settings, templates.

Revision ID: 001_phase1_initial
Revises:
Create Date: 2026-11-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001_phase1_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "counters",
        sa.Column("name", sa.String(64), primary_key=True),
        sa.Column("value", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=True),
    )
    op.create_table(
        "projects",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("key", sa.String(20), nullable=False),
        sa.Column("name", sa.String(200), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("jira_project_key", sa.String(40), nullable=False, server_default=""),
        sa.Column("qtest_project_id", sa.String(40), nullable=False, server_default=""),
        sa.Column("zephyr_project_key", sa.String(40), nullable=False, server_default=""),
        sa.Column("created", sa.String(40), nullable=False, server_default=""),
        sa.Column("updated", sa.String(40), nullable=False, server_default=""),
        sa.Column("system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("key"),
    )
    op.create_table(
        "requirement_folders",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False, server_default=""),
        sa.Column("parent", sa.String(32), sa.ForeignKey("requirement_folders.id"), nullable=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "requirements",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("folder_id", sa.String(32), sa.ForeignKey("requirement_folders.id"), nullable=True),
        sa.Column("title", sa.String(300), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("acs", sa.JSON(), nullable=False),
        sa.Column("type", sa.String(30), nullable=False, server_default="Story"),
        sa.Column("source", sa.String(30), nullable=False, server_default="Manual"),
        sa.Column("jira_key", sa.String(40), nullable=False, server_default=""),
        sa.Column("priority", sa.String(30), nullable=False, server_default="Medium"),
        sa.Column("status", sa.String(30), nullable=False, server_default="Draft"),
        sa.Column("created", sa.String(40), nullable=False, server_default=""),
        sa.Column("updated", sa.String(40), nullable=False, server_default=""),
        sa.Column("updated_by", sa.String(100), nullable=False, server_default=""),
        sa.Column("activity", sa.JSON(), nullable=False),
    )
    op.create_table(
        "requirement_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("requirement_id", sa.String(32), sa.ForeignKey("requirements.id"), nullable=False),
        sa.Column("case_id", sa.String(32), nullable=False),
        sa.Column("created", sa.String(40), nullable=False, server_default=""),
        sa.UniqueConstraint("requirement_id", "case_id", name="uq_requirement_links"),
    )
    op.create_table(
        "repo_folders",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, server_default=""),
        sa.Column("parent", sa.String(32), sa.ForeignKey("repo_folders.id"), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "cases",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("title", sa.String(300), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("precondition", sa.Text(), nullable=False, server_default=""),
        sa.Column("priority", sa.String(30), nullable=False, server_default="Medium"),
        sa.Column("type", sa.String(30), nullable=False, server_default=""),
        sa.Column("story", sa.String(60), nullable=False, server_default=""),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("acs", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="Draft"),
        sa.Column("source", sa.String(30), nullable=False, server_default="Manual"),
        sa.Column("folder_id", sa.String(32), nullable=False, server_default=""),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created", sa.String(40), nullable=False, server_default=""),
        sa.Column("updated", sa.String(40), nullable=False, server_default=""),
        sa.Column("last_result", sa.String(40), nullable=False, server_default=""),
        sa.Column("last_run", sa.String(40), nullable=False, server_default=""),
        sa.Column("versions", sa.JSON(), nullable=False),
        sa.Column("activity", sa.JSON(), nullable=False),
        sa.Column("comments", sa.JSON(), nullable=False),
        sa.Column("attachments", sa.JSON(), nullable=False),
    )
    op.create_table(
        "cycles",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("release", sa.String(200), nullable=False, server_default=""),
        sa.Column("sprint", sa.String(200), nullable=False, server_default=""),
        sa.Column("build", sa.String(200), nullable=False, server_default=""),
        sa.Column("env", sa.String(200), nullable=False, server_default=""),
        sa.Column("start", sa.String(200), nullable=False, server_default=""),
        sa.Column("end", sa.String(200), nullable=False, server_default=""),
        sa.Column("assignee", sa.String(200), nullable=False, server_default=""),
        sa.Column("owner", sa.String(200), nullable=False, server_default=""),
        sa.Column("status", sa.String(30), nullable=False, server_default="Active"),
        sa.Column("created", sa.String(40), nullable=False, server_default=""),
        sa.Column("source", sa.String(40), nullable=False, server_default=""),
    )
    op.create_table(
        "cycle_items",
        sa.Column("key", sa.String(32), primary_key=True),
        sa.Column("cycle_id", sa.String(32), sa.ForeignKey("cycles.id"), nullable=False),
        sa.Column("case_id", sa.String(32), nullable=False, server_default=""),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("assignee", sa.String(200), nullable=False, server_default=""),
        sa.Column("status", sa.String(30), nullable=False, server_default="Not run"),
        sa.Column("last_run", sa.String(40), nullable=False, server_default=""),
        sa.Column("defects", sa.JSON(), nullable=False),
        sa.Column("executions", sa.JSON(), nullable=False),
    )
    op.create_table(
        "executions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("cycle_id", sa.String(32), sa.ForeignKey("cycles.id"), nullable=False),
        sa.Column("item_key", sa.String(32), nullable=False, server_default=""),
        sa.Column("case_id", sa.String(32), nullable=False, server_default=""),
        sa.Column("case_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("ts", sa.String(40), nullable=False, server_default=""),
        sa.Column("tester", sa.String(100), nullable=False, server_default=""),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("auto_status", sa.String(30), nullable=False, server_default=""),
        sa.Column("status", sa.String(30), nullable=False, server_default=""),
        sa.Column("override_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("comments", sa.Text(), nullable=False, server_default=""),
        sa.Column("duration", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("defects", sa.JSON(), nullable=False),
        sa.Column("build", sa.String(200), nullable=False, server_default=""),
        sa.Column("env", sa.String(200), nullable=False, server_default=""),
    )
    op.create_table(
        "token_ledger",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("ts", sa.String(40), nullable=False, server_default=""),
        sa.Column("action", sa.String(80), nullable=False, server_default=""),
        sa.Column("mode", sa.String(40), nullable=False, server_default=""),
        sa.Column("rid", sa.String(80), nullable=False, server_default=""),
        sa.Column("run_id", sa.String(80), nullable=False, server_default=""),
        sa.Column("batch_rid", sa.String(80), nullable=False, server_default=""),
        sa.Column("batch_id", sa.String(80), nullable=False, server_default=""),
        sa.Column("story_id", sa.String(80), nullable=False, server_default=""),
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(40), nullable=False, server_default=""),
        sa.Column("model", sa.String(120), nullable=False, server_default=""),
        sa.Column("mock", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("input", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider", sa.String(80), nullable=False, server_default=""),
        sa.Column("template", sa.String(80), nullable=True),
    )
    op.create_table(
        "prompt_templates",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False, server_default=""),
        sa.Column("description", sa.String(300), nullable=False, server_default=""),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("options", sa.JSON(), nullable=False),
        sa.Column("builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.String(40), nullable=False, server_default=""),
        sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "prompt_template_meta",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("default_id", sa.String(64), nullable=False, server_default="default"),
        sa.Column("default_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("default_text", sa.Text(), nullable=True),
        sa.Column("default_updated_at", sa.String(40), nullable=True),
    )


def downgrade() -> None:
    for table in (
        "prompt_template_meta",
        "prompt_templates",
        "token_ledger",
        "executions",
        "cycle_items",
        "cycles",
        "cases",
        "repo_folders",
        "requirement_links",
        "requirements",
        "requirement_folders",
        "projects",
        "app_settings",
        "counters",
    ):
        op.drop_table(table)
