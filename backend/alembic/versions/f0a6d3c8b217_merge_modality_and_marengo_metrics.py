"""merge analytics and existing database migration heads"""

from typing import Sequence, Union


revision: str = "f0a6d3c8b217"
down_revision: Union[str, Sequence[str], None] = (
    "c13e8b4f7a20",
    "e8c2f5a7d301",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
