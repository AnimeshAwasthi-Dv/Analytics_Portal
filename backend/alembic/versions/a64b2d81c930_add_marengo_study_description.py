"""store Marengo usage service names as study descriptions"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a64b2d81c930"
down_revision: Union[str, Sequence[str], None] = "f2a6c8d1e903"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("marengo_studies", sa.Column("study_description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("marengo_studies", "study_description")
