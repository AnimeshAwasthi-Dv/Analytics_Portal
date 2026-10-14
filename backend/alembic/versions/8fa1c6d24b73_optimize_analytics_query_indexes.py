"""add indexes for analytics and sync log aggregation

Revision ID: 8fa1c6d24b73
Revises: f19b3c5d7a20
Create Date: 2026-10-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8fa1c6d24b73"
down_revision: Union[str, Sequence[str], None] = "f19b3c5d7a20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    sync_record_indexes = {
        index["name"]
        for index in sa.inspect(bind).get_indexes("sync_records")
    }
    if "ix_sync_records_synced_at_id" not in sync_record_indexes:
        op.create_index(
            "ix_sync_records_synced_at_id",
            "sync_records",
            ["synced_at", "id"],
        )

    sync_log_indexes = {
        index["name"]
        for index in sa.inspect(bind).get_indexes("sync_logs")
    }
    if "ix_sync_logs_event_instance" not in sync_log_indexes:
        op.create_index(
            "ix_sync_logs_event_instance",
            "sync_logs",
            ["event_type", "instance_code"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    sync_log_indexes = {
        index["name"]
        for index in sa.inspect(bind).get_indexes("sync_logs")
    }
    if "ix_sync_logs_event_instance" in sync_log_indexes:
        op.drop_index(
            "ix_sync_logs_event_instance",
            table_name="sync_logs",
        )

    sync_record_indexes = {
        index["name"]
        for index in sa.inspect(bind).get_indexes("sync_records")
    }
    if "ix_sync_records_synced_at_id" in sync_record_indexes:
        op.drop_index(
            "ix_sync_records_synced_at_id",
            table_name="sync_records",
        )
