"""store report patient names for the Marengo dashboard"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1c8d4e7a209"
down_revision: Union[str, Sequence[str], None] = (
    "f0a6d3c8b217",
    "h7a2c9e41b60",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "marengo_report_reviews",
        sa.Column("patient_name", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("marengo_report_reviews", "patient_name")
