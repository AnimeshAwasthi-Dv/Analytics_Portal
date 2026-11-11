"""Private, user-owned assistant conversations in the central database."""
from alembic import op
import sqlalchemy as sa

revision = "o4b9d6f2a087"
down_revision = "n3a8c5e1f976"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("command_assistant_threads",
        sa.Column("id",sa.String(36),primary_key=True),
        sa.Column("owner_id",sa.Integer,sa.ForeignKey("users.id"),nullable=False),
        sa.Column("workspace",sa.String(50),nullable=False),
        sa.Column("title",sa.String(160),nullable=False),
        sa.Column("messages",sa.JSON,nullable=False),
        sa.Column("revision",sa.Integer,nullable=False,server_default="0"),
        sa.Column("busy_until",sa.DateTime(timezone=True)),
        sa.Column("created_at",sa.DateTime(timezone=True),nullable=False,server_default=sa.func.now()),
        sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False,server_default=sa.func.now()))
    op.create_index("ix_assistant_owner_updated","command_assistant_threads",["owner_id","updated_at"])


def downgrade():
    op.drop_table("command_assistant_threads")
