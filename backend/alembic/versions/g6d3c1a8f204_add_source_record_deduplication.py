"""allow idempotent imports from source portal databases"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "g6d3c1a8f204"
down_revision: Union[str, Sequence[str], None] = "f4a8c1d2e609"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("sync_records")}
    if "source_record_id" not in columns:
        op.add_column(
            "sync_records",
            sa.Column("source_record_id", sa.String(120), nullable=True),
        )

    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("sync_records")}
    if "uq_sync_records_instance_source_id" not in indexes:
        op.create_index(
            "uq_sync_records_instance_source_id",
            "sync_records",
            ["instance_code", "source_record_id"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("sync_records")}
    if "uq_sync_records_instance_source_id" in indexes:
        op.drop_index("uq_sync_records_instance_source_id", table_name="sync_records")
    columns = {column["name"] for column in sa.inspect(bind).get_columns("sync_records")}
    if "source_record_id" in columns:
        op.drop_column("sync_records", "source_record_id")
