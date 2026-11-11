"""Run history index, snapshots, and per-browser sequence counters.

Revision ID: 002_history
Revises: 001_phase1_initial
Create Date: 2026-11-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002_history"
down_revision: Union[str, None] = "001_phase1_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "history_entries",
        sa.Column("hid", sa.String(64), primary_key=True),
        sa.Column("run_id", sa.String(80), primary_key=True),
        sa.Column("rid", sa.String(80), nullable=False, server_default=""),
        sa.Column("kind", sa.String(20), nullable=False, server_default=""),
        sa.Column("created", sa.String(40), nullable=False, server_default=""),
        sa.Column("updated", sa.String(40), nullable=False, server_default=""),
        sa.Column("story_id", sa.Text(), nullable=False, server_default=""),
        sa.Column("title", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(40), nullable=False, server_default=""),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reviewed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(40), nullable=False, server_default=""),
        sa.Column("extra", sa.JSON(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_history_entries_hid_position", "history_entries", ["hid", "position"])
    op.create_table(
        "history_snapshots",
        sa.Column("hid", sa.String(64), primary_key=True),
        sa.Column("run_id", sa.String(80), primary_key=True),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_table(
        "history_seq",
        sa.Column("hid", sa.String(64), primary_key=True),
        sa.Column("key", sa.String(16), primary_key=True),
        sa.Column("day", sa.String(8), primary_key=True),
        sa.Column("n", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("history_seq")
    op.drop_table("history_snapshots")
    op.drop_index("ix_history_entries_hid_position", table_name="history_entries")
    op.drop_table("history_entries")
