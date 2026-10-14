"""remove legacy public license tables after migrating to the ai schema"""
from typing import Sequence, Union

from alembic import op


revision: str = "c3f7a2d91e54"
down_revision: Union[str, Sequence[str], None] = (
    "e8c2f5a7d301",
    "h7a2c9e41b60",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    # h7a2c9e41b60 creates/populates the canonical ai schema. Remove the old
    # public tables after that migration has copied their data.
    op.execute("DROP TABLE IF EXISTS public.license_events CASCADE")
    op.execute("DROP TABLE IF EXISTS public.desktop_licenses CASCADE")
    op.execute("DROP TABLE IF EXISTS public.license_plans CASCADE")


def downgrade() -> None:
    # Legacy license data was copied to ai.* before these tables were removed.
    pass
