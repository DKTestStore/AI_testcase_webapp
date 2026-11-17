"""Add automation script folders, scripts, and versions (additive).

Revision ID: 005_automation_scripts
Revises: 004_token_calculator
Create Date: 2026-11-17

New tables only. Existing product data is unchanged. Script option catalogues
and Generate defaults live in app_settings JSON (prefs), not in these tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "005_automation_scripts"
down_revision: Union[str, None] = "004_token_calculator"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "script_folders",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, server_default=""),
        sa.Column("parent", sa.String(32), sa.ForeignKey("script_folders.id"), nullable=True),
        sa.Column("project", sa.String(80), nullable=False, server_default=""),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )
    op.create_table(
        "automation_scripts",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(300), nullable=False, server_default=""),
        sa.Column("folder_id", sa.String(32), nullable=False, server_default=""),
        sa.Column("project", sa.String(80), nullable=False, server_default=""),
        sa.Column("linked_ids", sa.JSON(), nullable=False),
        sa.Column("language", sa.String(80), nullable=False, server_default=""),
        sa.Column("types", sa.JSON(), nullable=False),
        sa.Column("frameworks", sa.JSON(), nullable=False),
        sa.Column("model", sa.String(160), nullable=False, server_default=""),
        sa.Column("provider", sa.String(40), nullable=False, server_default=""),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("files", sa.JSON(), nullable=False),
        sa.Column("mapping", sa.JSON(), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("created", sa.String(40), nullable=False, server_default=""),
        sa.Column("updated", sa.String(40), nullable=False, server_default=""),
    )
    op.create_table(
        "script_versions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("script_id", sa.String(32), sa.ForeignKey("automation_scripts.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("files", sa.JSON(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("model", sa.String(160), nullable=False, server_default=""),
        sa.Column("provider", sa.String(40), nullable=False, server_default=""),
        sa.Column("created", sa.String(40), nullable=False, server_default=""),
        sa.UniqueConstraint("script_id", "version", name="uq_script_version"),
    )


def downgrade() -> None:
    op.drop_table("script_versions")
    op.drop_table("automation_scripts")
    op.drop_table("script_folders")
