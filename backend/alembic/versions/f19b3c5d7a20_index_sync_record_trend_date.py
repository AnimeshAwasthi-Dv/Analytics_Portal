"""index sync record processing date for analytics

Revision ID: f19b3c5d7a20
Revises: c82b7e4a19d6
Create Date: 2026-10-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f19b3c5d7a20"
down_revision: Union[str, Sequence[str], None] = "c82b7e4a19d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    indexes = {
        index["name"]
        for index in sa.inspect(op.get_bind()).get_indexes("sync_records")
    }
    if "ix_sync_records_processing_created_at" not in indexes:
        op.create_index(
            "ix_sync_records_processing_created_at",
            "sync_records",
            ["processing_created_at"],
        )


def downgrade() -> None:
    indexes = {
        index["name"]
        for index in sa.inspect(op.get_bind()).get_indexes("sync_records")
    }
    if "ix_sync_records_processing_created_at" in indexes:
        op.drop_index(
            "ix_sync_records_processing_created_at",
            table_name="sync_records",
        )
