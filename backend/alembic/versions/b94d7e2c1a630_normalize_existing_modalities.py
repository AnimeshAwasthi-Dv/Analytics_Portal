"""normalize existing records to the supported modality categories"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.modality import normalize_modality


revision: str = "b94d7e2c1a630"
down_revision: Union[str, Sequence[str], None] = "a64b2d81c930"
branch_labels = None
depends_on = None


def _normalize_table(select_sql: str, update_sql: str, description_key: str) -> None:
    connection = op.get_bind()
    rows = connection.execute(sa.text(select_sql)).mappings()
    batch = []
    for row in rows:
        normalized = normalize_modality(row["modality"], row[description_key])
        if normalized is None:
            # Keep an unfamiliar source label intact instead of blanking it.
            continue
        batch.append({
            "modality": normalized,
            **{key: row[key] for key in row.keys() if key not in {"modality", description_key}},
        })
        if len(batch) >= 1000:
            connection.execute(sa.text(update_sql), batch)
            batch.clear()
    if batch:
        connection.execute(sa.text(update_sql), batch)


def upgrade() -> None:
    _normalize_table(
        "SELECT id, modality, study_description FROM sync_records",
        "UPDATE sync_records SET modality = :modality WHERE id = :id",
        "study_description",
    )
    _normalize_table(
        "SELECT instance_code, id, modality, study_description FROM marengo_studies",
        "UPDATE marengo_studies SET modality = :modality WHERE instance_code = :instance_code AND id = :id",
        "study_description",
    )
    _normalize_table(
        "SELECT instance_code, id, modality, service_name FROM marengo_report_reviews",
        "UPDATE marengo_report_reviews SET modality = :modality WHERE instance_code = :instance_code AND id = :id",
        "service_name",
    )


def downgrade() -> None:
    # Normalized categories replace heterogeneous source labels; original values
    # cannot be reconstructed from the portal database.
    pass
