"""allow idempotent imports from source portal databases"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "g6d3c1a8f204"
down_revision: Union[str, Sequence[str], None] = "f4a8c1d2e609"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sync_records", sa.Column("source_record_id", sa.String(120), nullable=True))
    op.create_index(
        "uq_sync_records_instance_source_id",
        "sync_records",
        ["instance_code", "source_record_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_sync_records_instance_source_id", table_name="sync_records")
    op.drop_column("sync_records", "source_record_id")
