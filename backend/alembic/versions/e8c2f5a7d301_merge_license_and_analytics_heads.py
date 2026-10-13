"""merge desktop license and analytics index heads"""
from typing import Sequence, Union


revision: str = "e8c2f5a7d301"
down_revision: Union[str, Sequence[str], None] = (
    "d7a1c9e4b502",
    "8fa1c6d24b73",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
