"""Inventory of controllable source services, subscriptions and on-prem assets."""
from alembic import op
from app.command_models import PortalResource

revision = "l1e6a3c9d754"
down_revision = "k0d5f2b8c643"
branch_labels = None
depends_on = None


def upgrade():
    PortalResource.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    PortalResource.__table__.drop(op.get_bind())
