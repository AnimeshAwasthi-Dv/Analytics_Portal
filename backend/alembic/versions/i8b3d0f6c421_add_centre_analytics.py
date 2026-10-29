"""add nullable centre mapping to synced studies"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "i8b3d0f6c421"
down_revision: Union[str, Sequence[str], None] = "b1c8d4e7a209"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sync_records", sa.Column("source_study_uid", sa.String(length=120), nullable=True))
    op.add_column("sync_records", sa.Column("centre_id", sa.String(length=120), nullable=True))
    op.add_column("sync_records", sa.Column("centre_name", sa.String(length=255), nullable=True))
    op.create_index("ix_sync_records_source_study_uid", "sync_records", ["source_study_uid"])
    op.create_index("ix_sync_records_centre_id", "sync_records", ["centre_id"])
    op.add_column("marengo_studies", sa.Column("centre_id", sa.String(length=120), nullable=True))
    op.add_column("marengo_studies", sa.Column("centre_name", sa.String(length=255), nullable=True))
    op.create_index("ix_marengo_studies_centre", "marengo_studies", ["centre_id", "instance_code"])


def downgrade() -> None:
    op.drop_index("ix_marengo_studies_centre", table_name="marengo_studies")
    op.drop_column("marengo_studies", "centre_name")
    op.drop_column("marengo_studies", "centre_id")
    op.drop_index("ix_sync_records_centre_id", table_name="sync_records")
    op.drop_index("ix_sync_records_source_study_uid", table_name="sync_records")
    op.drop_column("sync_records", "centre_name")
    op.drop_column("sync_records", "centre_id")
    op.drop_column("sync_records", "source_study_uid")
