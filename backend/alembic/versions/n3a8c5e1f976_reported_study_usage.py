"""Reported study usage and X-ray views; central database only."""
from alembic import op
import sqlalchemy as sa

revision = "n3a8c5e1f976"
down_revision = "m2f7b4d0e865"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("command_study_usage",
        sa.Column("portal_code",sa.String(50),sa.ForeignKey("command_portals.code"),primary_key=True),
        sa.Column("source_id",sa.String(80),primary_key=True),
        sa.Column("source_reference",sa.String(180),nullable=False),
        sa.Column("client_code",sa.String(80),nullable=False),sa.Column("center_id",sa.String(160)),
        sa.Column("service",sa.String(120),nullable=False),sa.Column("status",sa.String(30),nullable=False),
        sa.Column("workflow",sa.String(30),nullable=False),sa.Column("view_count",sa.Integer),sa.Column("view_source",sa.String(40)),
        sa.Column("received_at",sa.DateTime(timezone=True),nullable=False),sa.Column("reported_at",sa.DateTime(timezone=True)),
        sa.Column("occurred_at",sa.DateTime(timezone=True),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False),
        sa.Column("duration_ms",sa.Float))
    for name,fields in [("portal",["portal_code","occurred_at"]),("client",["client_code","occurred_at"]),("center",["portal_code","center_id","occurred_at"]),("service",["occurred_at","service"])]:
        op.create_index(f"ix_command_studies_{name}_time","command_study_usage",fields)


def downgrade():
    op.drop_table("command_study_usage")
