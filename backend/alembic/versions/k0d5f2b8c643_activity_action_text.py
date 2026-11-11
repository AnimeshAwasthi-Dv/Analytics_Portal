"""Accommodate full source audit action identifiers."""
import sqlalchemy as sa
from alembic import op

revision = "k0d5f2b8c643"
down_revision = "j9c4e1a7b532"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("command_user_activity", "action", type_=sa.Text(), existing_type=sa.String(120))


def downgrade():
    # Avoid truncating imported source actions.
    pass
