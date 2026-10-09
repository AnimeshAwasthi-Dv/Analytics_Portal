"""add traffic monitoring tables

Revision ID: a91c2d7f6b10
Revises: 4bed7716e903
Create Date: 2026-10-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a91c2d7f6b10"
down_revision: Union[str, Sequence[str], None] = "4bed7716e903"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("instances"):
        op.create_table(
            "instances",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("identifier", sa.String(length=120), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("identifier"),
        )
    op.execute(
        "INSERT INTO instances (name, identifier, status) "
        "SELECT source.key_name, source.key_name, 'active' "
        "FROM api_keys AS source "
        "WHERE NOT EXISTS ("
        "SELECT 1 FROM instances WHERE identifier = source.key_name"
        ")"
    )
    inspector = sa.inspect(bind)
    if not inspector.has_table("traffic_logs"):
        op.create_table(
            "traffic_logs",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("instance_id", sa.Integer(), nullable=True),
            sa.Column("route", sa.String(length=255), nullable=False),
            sa.Column("method", sa.String(length=10), nullable=False),
            sa.Column("status_code", sa.Integer(), nullable=False),
            sa.Column("request_size", sa.BigInteger(), nullable=True),
            sa.Column("response_size", sa.BigInteger(), nullable=True),
            sa.Column("processing_time", sa.Float(), nullable=False),
            sa.Column("is_success", sa.Boolean(), nullable=False),
            sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["instance_id"], ["instances.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes("traffic_logs")
    }
    expected_indexes = {
        "ix_traffic_logs_timestamp": ["timestamp"],
        "ix_traffic_logs_instance_timestamp": ["instance_id", "timestamp"],
        "ix_traffic_logs_route_timestamp": ["route", "timestamp"],
    }
    for index_name, columns in expected_indexes.items():
        if index_name not in indexes:
            op.create_index(index_name, "traffic_logs", columns)


def downgrade() -> None:
    # These tables may have existed before this revision was recorded.
    pass