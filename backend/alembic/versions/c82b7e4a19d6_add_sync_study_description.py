"""add study description to sync records

Revision ID: c82b7e4a19d6
Revises: e6f4b2a7c913
Create Date: 2026-10-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c82b7e4a19d6"
down_revision: Union[str, Sequence[str], None] = "e6f4b2a7c913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("sync_records")
    }
    if "study_description" not in columns:
        op.add_column(
            "sync_records",
            sa.Column("study_description", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("sync_records")
    }
    if "study_description" in columns:
        op.drop_column("sync_records", "study_description")
