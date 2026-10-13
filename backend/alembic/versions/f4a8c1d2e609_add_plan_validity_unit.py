"""store license plan validity units"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f4a8c1d2e609"
down_revision: Union[str, Sequence[str], None] = "e8c2f5a7d301"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("license_plans", sa.Column("validity_unit", sa.String(12), nullable=False, server_default="DAYS"))
    op.add_column("desktop_licenses", sa.Column("credits_total", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("desktop_licenses", "credits_total")
    op.drop_column("license_plans", "validity_unit")
