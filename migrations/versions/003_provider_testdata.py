"""Add provider fields on run history entries (model, model_name).

Revision ID: 003_provider_testdata
Revises: 002_history
Create Date: 2026-11-14

Case type already exists; per-step test_data lives in the cases.steps JSON, so
no case-table columns are added. Existing rows keep an empty string default
(no data loss).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003_provider_testdata"
down_revision: Union[str, None] = "002_history"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("history_entries", sa.Column("model", sa.String(40), nullable=False, server_default=""))
    op.add_column("history_entries", sa.Column("model_name", sa.String(120), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("history_entries", "model_name")
    op.drop_column("history_entries", "model")
