"""add api keys table

Revision ID: 4bed7716e903
Revises: ed608f36b583
Create Date: 2026-10-06 14:36:02.309090

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4bed7716e903"
down_revision: Union[str, Sequence[str], None] = "ed608f36b583"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("api_keys"):
        op.create_table(
            "api_keys",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("key_name", sa.String(), nullable=False),
            sa.Column("api_key", sa.String(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("key_name"),
        )
        inspector = sa.inspect(bind)

    if "ix_api_keys_id" not in {
        index["name"] for index in inspector.get_indexes("api_keys")
    }:
        op.create_index("ix_api_keys_id", "api_keys", ["id"], unique=False)

    if inspector.has_table("sync_logs"):
        sync_log_columns = {
            column["name"]: column for column in inspector.get_columns("sync_logs")
        }
        instance_code = sync_log_columns.get("instance_code")
        if instance_code and instance_code["nullable"]:
            with op.batch_alter_table("sync_logs") as batch_op:
                batch_op.alter_column(
                    "instance_code",
                    existing_type=sa.String(length=50),
                    nullable=False,
                )

        if "instance_code" in sync_log_columns and "ix_sync_logs_instance_code" not in {
            index["name"] for index in inspector.get_indexes("sync_logs")
        }:
            op.create_index(
                "ix_sync_logs_instance_code",
                "sync_logs",
                ["instance_code"],
                unique=False,
            )


def downgrade() -> None:
    # The base schema owns these tables and they may contain application data.
    pass
