"""Central expiring report/study shares; no source schema changes."""
from alembic import op
import sqlalchemy as sa
revision = "p5c0e7a3b198"
down_revision = "o4b9d6f2a087"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("command_public_shares",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("portal_code", sa.String(50), nullable=False),
        sa.Column("target_id", sa.String(180), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("include_viewer", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False))
    op.create_index("ix_command_public_shares_portal_code", "command_public_shares", ["portal_code"])

def downgrade():
    op.drop_table("command_public_shares")
