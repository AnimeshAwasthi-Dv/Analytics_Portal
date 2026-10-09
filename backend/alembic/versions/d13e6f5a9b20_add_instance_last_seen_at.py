"""add instance heartbeat timestamp

Revision ID: d13e6f5a9b20
Revises: b7c4d2a91e60
Create Date: 2026-10-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d13e6f5a9b20"
down_revision: Union[str, Sequence[str], None] = "b7c4d2a91e60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("instances")
    }
    if "last_seen_at" not in columns:
        op.add_column(
            "instances",
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    columns = {
        column["name"] for column in sa.inspect(op.get_bind()).get_columns("instances")
    }
    if "last_seen_at" in columns:
        op.drop_column("instances", "last_seen_at")
