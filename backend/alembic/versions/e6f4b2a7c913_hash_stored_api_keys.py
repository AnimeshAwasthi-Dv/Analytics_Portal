"""hash stored API keys

Revision ID: e6f4b2a7c913
Revises: d13e6f5a9b20
Create Date: 2026-10-09

"""
import hashlib
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e6f4b2a7c913"
down_revision: Union[str, Sequence[str], None] = "d13e6f5a9b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    api_keys = sa.table(
        "api_keys",
        sa.column("id", sa.Integer()),
        sa.column("api_key", sa.String()),
    )
    for key_id, stored_key in bind.execute(
        sa.select(api_keys.c.id, api_keys.c.api_key)
    ):
        digest = stored_key.removeprefix("sha256$")
        is_hash = (
            stored_key.startswith("sha256$")
            and len(digest) == 64
            and digest == digest.lower()
            and all(character in "0123456789abcdef" for character in digest)
        )
        if not is_hash:
            digest = hashlib.sha256(stored_key.encode("utf-8")).hexdigest()
            bind.execute(
                api_keys.update()
                .where(api_keys.c.id == key_id)
                .values(api_key=f"sha256${digest}")
            )

    indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes("api_keys")
    }
    if "ix_api_keys_api_key" not in indexes:
        op.create_index(
            "ix_api_keys_api_key",
            "api_keys",
            ["api_key"],
            unique=False,
        )


def downgrade() -> None:
    raise RuntimeError(
        "Hashed API keys cannot be converted back to their original secrets"
    )
