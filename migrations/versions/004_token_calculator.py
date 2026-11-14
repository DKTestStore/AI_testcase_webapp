"""Add estimate / rate columns on the token ledger (additive).

Revision ID: 004_token_calculator
Revises: 003_provider_testdata
Create Date: 2026-11-14

Existing rows stay intact: new columns default to 0 / 'legacy_global' so
historical cost continues to use the workspace-wide global rates. No data
loss. JSON backups (token_ledger.bak.json) are unchanged by this migration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004_token_calculator"
down_revision: Union[str, None] = "003_provider_testdata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("token_ledger", sa.Column("est_input", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("token_ledger", sa.Column("est_output", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("token_ledger", sa.Column("est_cost", sa.Float(), nullable=False, server_default="0"))
    op.add_column("token_ledger", sa.Column("actual_cost", sa.Float(), nullable=False, server_default="0"))
    op.add_column("token_ledger", sa.Column("rate_source", sa.String(20), nullable=False, server_default="legacy_global"))


def downgrade() -> None:
    op.drop_column("token_ledger", "rate_source")
    op.drop_column("token_ledger", "actual_cost")
    op.drop_column("token_ledger", "est_cost")
    op.drop_column("token_ledger", "est_output")
    op.drop_column("token_ledger", "est_input")
