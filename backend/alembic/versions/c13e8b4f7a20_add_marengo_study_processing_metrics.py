"""store Marengo study completion time and usage credits"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c13e8b4f7a20"
down_revision: Union[str, Sequence[str], None] = "b94d7e2c1a630"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "marengo_studies",
        sa.Column("processing_completed_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "marengo_studies",
        sa.Column("credits_used", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("marengo_studies", "credits_used")
    op.drop_column("marengo_studies", "processing_completed_at")
