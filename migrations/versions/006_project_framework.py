"""Add project frameworks, file versions, locators, TC sync, and run history.

Revision ID: 006_project_framework
Revises: 005_automation_scripts
Create Date: 2026-11-18

New tables only. Existing automation_scripts / script_folders / script_versions
are unchanged. Folder templates and runner settings live in app_settings JSON
(prefs), not in these tables. Framework file contents are stored here — never
in the application .env.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "006_project_framework"
down_revision: Union[str, None] = "005_automation_scripts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_frameworks",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project", sa.String(80), nullable=False, server_default=""),
        sa.Column("language", sa.String(80), nullable=False, server_default=""),
        sa.Column("framework", sa.String(80), nullable=False, server_default=""),
        sa.Column("types", sa.JSON, nullable=False),
        sa.Column("options", sa.JSON, nullable=False),
        sa.Column("created", sa.String(40), nullable=False, server_default=""),
        sa.Column("updated", sa.String(40), nullable=False, server_default=""),
        sa.UniqueConstraint("project", "language", name="uq_project_framework_lang"),
    )
    op.create_table(
        "framework_files",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("framework_id", sa.String(32), sa.ForeignKey("project_frameworks.id"), nullable=False),
        sa.Column("path", sa.String(400), nullable=False, server_default=""),
        sa.Column("is_dir", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("content", sa.Text, nullable=False, server_default=""),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("updated", sa.String(40), nullable=False, server_default=""),
        sa.Column("updated_by", sa.String(80), nullable=False, server_default=""),
        sa.UniqueConstraint("framework_id", "path", name="uq_framework_file_path"),
    )
    op.create_table(
        "framework_file_versions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("file_id", sa.Integer, sa.ForeignKey("framework_files.id"), nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("content", sa.Text, nullable=False, server_default=""),
        sa.Column("author", sa.String(80), nullable=False, server_default=""),
        sa.Column("note", sa.Text, nullable=False, server_default=""),
        sa.Column("created", sa.String(40), nullable=False, server_default=""),
        sa.UniqueConstraint("file_id", "version", name="uq_framework_file_version"),
    )
    op.create_table(
        "framework_locators",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("framework_id", sa.String(32), sa.ForeignKey("project_frameworks.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False, server_default=""),
        sa.Column("strategy", sa.String(40), nullable=False, server_default="css"),
        sa.Column("value", sa.String(500), nullable=False, server_default=""),
        sa.Column("page", sa.String(160), nullable=False, server_default=""),
        sa.Column("status", sa.String(40), nullable=False, server_default="Draft"),
    )
    op.create_table(
        "framework_assertions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("framework_id", sa.String(32), sa.ForeignKey("project_frameworks.id"), nullable=False),
        sa.Column("tc_id", sa.String(40), nullable=False, server_default=""),
        sa.Column("typ", sa.String(80), nullable=False, server_default=""),
        sa.Column("target", sa.String(200), nullable=False, server_default=""),
        sa.Column("expected", sa.String(500), nullable=False, server_default=""),
    )
    op.create_table(
        "framework_mappings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("framework_id", sa.String(32), sa.ForeignKey("project_frameworks.id"), nullable=False),
        sa.Column("file_path", sa.String(400), nullable=False, server_default=""),
        sa.Column("tc_id", sa.String(40), nullable=False, server_default=""),
        sa.Column("mapping", sa.JSON, nullable=False),
        sa.Column("rows", sa.JSON, nullable=False),
    )
    op.create_table(
        "tc_script_map",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("tc_id", sa.String(40), nullable=False, server_default=""),
        sa.Column("framework_id", sa.String(32), sa.ForeignKey("project_frameworks.id"), nullable=False),
        sa.Column("file_path", sa.String(400), nullable=False, server_default=""),
        sa.Column("script_id", sa.String(32), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="ready"),
        sa.Column("steps_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("generated_at", sa.String(40), nullable=False, server_default=""),
        sa.Column("updated", sa.String(40), nullable=False, server_default=""),
        sa.UniqueConstraint("tc_id", "framework_id", "file_path", name="uq_tc_script_map"),
    )
    op.create_table(
        "automation_runs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("framework_id", sa.String(32), sa.ForeignKey("project_frameworks.id"), nullable=False),
        sa.Column("scope", sa.JSON, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("command", sa.String(500), nullable=False, server_default=""),
        sa.Column("env", sa.JSON, nullable=False),
        sa.Column("headless", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("started", sa.String(40), nullable=False, server_default=""),
        sa.Column("finished", sa.String(40), nullable=False, server_default=""),
        sa.Column("log", sa.Text, nullable=False, server_default=""),
        sa.Column("summary", sa.JSON, nullable=False),
        sa.Column("artifacts_dir", sa.String(400), nullable=False, server_default=""),
        sa.Column("exit_code", sa.Integer, nullable=True),
    )
    op.create_table(
        "automation_run_results",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.String(32), sa.ForeignKey("automation_runs.id"), nullable=False),
        sa.Column("tc_id", sa.String(40), nullable=False, server_default=""),
        sa.Column("name", sa.String(300), nullable=False, server_default=""),
        sa.Column("file", sa.String(400), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default=""),
        sa.Column("duration_ms", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error", sa.Text, nullable=False, server_default=""),
        sa.Column("stack", sa.Text, nullable=False, server_default=""),
        sa.Column("screenshot", sa.String(400), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("automation_run_results")
    op.drop_table("automation_runs")
    op.drop_table("tc_script_map")
    op.drop_table("framework_mappings")
    op.drop_table("framework_assertions")
    op.drop_table("framework_locators")
    op.drop_table("framework_file_versions")
    op.drop_table("framework_files")
    op.drop_table("project_frameworks")
