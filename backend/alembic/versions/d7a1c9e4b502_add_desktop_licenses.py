"""add desktop license plans, keys and activity"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d7a1c9e4b502"
down_revision: Union[str, Sequence[str], None] = "f19b3c5d7a20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "license_plans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("service", sa.String(20), nullable=False),
        sa.Column("credits", sa.Integer(), nullable=False),
        sa.Column("validity_days", sa.Integer(), nullable=True),
        sa.Column("fixed_end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cost", sa.Float(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_license_plans_service_active", "license_plans", ["service", "is_active"])
    op.create_table(
        "desktop_licenses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("license_key", sa.String(32), nullable=False, unique=True),
        sa.Column("service", sa.String(20), nullable=False),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("plan_id", sa.Integer(), sa.ForeignKey("license_plans.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="Available"),
        sa.Column("full_name", sa.String(160)), sa.Column("username", sa.String(120)),
        sa.Column("mobile", sa.String(20)), sa.Column("vendor", sa.String(160)), sa.Column("location", sa.String(160)),
        sa.Column("latitude", sa.Float()), sa.Column("longitude", sa.Float()),
        sa.Column("credits_remaining", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True)), sa.Column("ends_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_desktop_licenses_license_key", "desktop_licenses", ["license_key"], unique=True)
    op.create_index("ix_desktop_licenses_service_status", "desktop_licenses", ["service", "status"])
    op.create_index("ix_desktop_licenses_plan", "desktop_licenses", ["plan_id"])
    op.create_table(
        "license_events",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("license_id", sa.Integer(), sa.ForeignKey("desktop_licenses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(30), nullable=False),
        sa.Column("credits_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_license_events_license_created", "license_events", ["license_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_license_events_license_created", table_name="license_events")
    op.drop_table("license_events")
    op.drop_index("ix_desktop_licenses_plan", table_name="desktop_licenses")
    op.drop_index("ix_desktop_licenses_service_status", table_name="desktop_licenses")
    op.drop_index("ix_desktop_licenses_license_key", table_name="desktop_licenses")
    op.drop_table("desktop_licenses")
    op.drop_index("ix_license_plans_service_active", table_name="license_plans")
    op.drop_table("license_plans")
