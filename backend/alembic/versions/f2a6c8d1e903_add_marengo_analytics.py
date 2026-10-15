"""add Marengo analytics source tables without patient report payloads"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM


revision: str = "f2a6c8d1e903"
down_revision: Union[str, Sequence[str], None] = "c3f7a2d91e54"
branch_labels = None
depends_on = None

job_status = ENUM("QUEUED", "PROCESSING", "SUCCESS", "FAILED", name="marengo_job_status", create_type=False)
review_status = ENUM(
    "PENDING", "IN_REVIEW", "SAVED", "APPROVED", "PUSHED", "FAILED",
    name="marengo_report_review_status", create_type=False,
)
return_format = ENUM(
    "DICOM_ENCAPSULATED_PDF", "DICOM_SECONDARY_CAPTURE", "HL7", "HTML", "PDF", "DOCX",
    name="marengo_return_format", create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    job_status.create(bind, checkfirst=True)
    review_status.create(bind, checkfirst=True)
    return_format.create(bind, checkfirst=True)

    op.create_table(
        "marengo_studies",
        sa.Column("instance_code", sa.String(length=50), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("modality", sa.String(), nullable=False),
        sa.Column("status", job_status, nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("instance_code", "id"),
    )
    op.create_index("ix_marengo_studies_modality_status", "marengo_studies", ["modality", "status"])

    op.create_table(
        "marengo_jobs",
        sa.Column("instance_code", sa.String(length=50), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("study_id", sa.String(), nullable=True),
        sa.Column("service_name", sa.String(), nullable=False),
        sa.Column("status", job_status, server_default="QUEUED", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("has_error", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("instance_code", "id"),
    )
    op.create_index("ix_marengo_jobs_study_status", "marengo_jobs", ["study_id", "status"])
    op.create_index("ix_marengo_jobs_status_created", "marengo_jobs", ["status", "created_at"])

    op.create_table(
        "marengo_report_reviews",
        sa.Column("instance_code", sa.String(length=50), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("study_id", sa.String(), nullable=True),
        sa.Column("service_name", sa.String(), nullable=False),
        sa.Column("modality", sa.String(), nullable=True),
        sa.Column("status", review_status, server_default="PENDING", nullable=False),
        sa.Column("output_format", return_format, server_default="DICOM_ENCAPSULATED_PDF", nullable=False),
        sa.Column("locked", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("generated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("pushed_at", sa.DateTime(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("instance_code", "id"),
    )
    op.create_index("ix_marengo_report_reviews_modality_status", "marengo_report_reviews", ["modality", "status"])
    op.create_index("ix_marengo_report_reviews_study", "marengo_report_reviews", ["study_id"])

    op.create_table(
        "marengo_usage_logs",
        sa.Column("instance_code", sa.String(length=50), nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("service_name", sa.String(), nullable=False),
        sa.Column("credits_used", sa.Integer(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("instance_code", "id"),
    )
    op.create_index("ix_marengo_usage_logs_created", "marengo_usage_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_marengo_usage_logs_created", table_name="marengo_usage_logs")
    op.drop_table("marengo_usage_logs")
    op.drop_index("ix_marengo_report_reviews_study", table_name="marengo_report_reviews")
    op.drop_index("ix_marengo_report_reviews_modality_status", table_name="marengo_report_reviews")
    op.drop_table("marengo_report_reviews")
    op.drop_index("ix_marengo_jobs_status_created", table_name="marengo_jobs")
    op.drop_index("ix_marengo_jobs_study_status", table_name="marengo_jobs")
    op.drop_table("marengo_jobs")
    op.drop_index("ix_marengo_studies_modality_status", table_name="marengo_studies")
    op.drop_table("marengo_studies")
    bind = op.get_bind()
    return_format.drop(bind, checkfirst=True)
    review_status.drop(bind, checkfirst=True)
    job_status.drop(bind, checkfirst=True)
