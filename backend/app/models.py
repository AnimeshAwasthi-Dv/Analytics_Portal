from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ENUM
from sqlalchemy.orm import validates
from sqlalchemy.sql import func

from app.database import Base
from app.security import hash_api_key, is_api_key_hash


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    key_name = Column(String, unique=True, nullable=False)
    api_key = Column(String, nullable=False, index=True)

    @validates("api_key")
    def hash_api_key_on_assignment(self, _key: str, value: str) -> str:
        return value if is_api_key_hash(value) else hash_api_key(value)


class Instance(Base):
    __tablename__ = "instances"

    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    identifier = Column(String(120), nullable=False, unique=True)
    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class TrafficLog(Base):
    __tablename__ = "traffic_logs"
    __table_args__ = (
        Index("ix_traffic_logs_timestamp", "timestamp"),
        Index("ix_traffic_logs_instance_timestamp", "instance_id", "timestamp"),
        Index("ix_traffic_logs_route_timestamp", "route", "timestamp"),
    )

    id = Column(BigInteger, primary_key=True)
    instance_id = Column(
        Integer,
        ForeignKey("instances.id", ondelete="SET NULL"),
        nullable=True,
    )
    route = Column(String(255), nullable=False)
    method = Column(String(10), nullable=False)
    status_code = Column(Integer, nullable=False)
    request_size = Column(BigInteger, nullable=True)
    response_size = Column(BigInteger, nullable=True)
    processing_time = Column(Float, nullable=False)
    is_success = Column(Boolean, nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class SyncRecord(Base):
    __tablename__ = "sync_records"
    __table_args__ = (
        Index("ix_sync_records_synced_at_id", "synced_at", "id"),
        Index("uq_sync_records_instance_source_id", "instance_code", "source_record_id", unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)

    source_record_id = Column(String(120), nullable=True)

    instance_code = Column(
        String(50),
        nullable=False,
        index=True
    )

    modality = Column(String(50), nullable=True)

    study_description = Column(Text, nullable=True)

    processing_created_at = Column(
        DateTime(timezone=True),
        nullable=True
    )

    processing_completed_at = Column(
        DateTime(timezone=True),
        nullable=True
    )

    credits_used = Column(Integer, default=0)

    sync_status = Column(
        String(30),
        default="SYNCED"
    )

    synced_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )


class ModalityOption(Base):
    __tablename__ = "modality_options"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), nullable=False, unique=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class SyncLog(Base):
    __tablename__ = "sync_logs"
    __table_args__ = (
        Index("ix_sync_logs_event_instance", "event_type", "instance_code"),
    )

    id = Column(Integer, primary_key=True, index=True)

    instance_code = Column(
        String(50),
        nullable=False,
        index=True
    )

    event_type = Column(
        String(50),
        nullable=False
    )

    status = Column(
        String(30),
        nullable=False
    )

    message = Column(
        Text,
        nullable=True
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )


MARENGO_JOB_STATUS = ("QUEUED", "PROCESSING", "SUCCESS", "FAILED")
MARENGO_REVIEW_STATUS = ("PENDING", "IN_REVIEW", "SAVED", "APPROVED", "PUSHED", "FAILED")
MARENGO_RETURN_FORMAT = (
    "DICOM_ENCAPSULATED_PDF", "DICOM_SECONDARY_CAPTURE", "HL7", "HTML", "PDF", "DOCX",
)


class MarengoStudy(Base):
    """Analytics-safe study fields; report JSON and patient identifiers stay in Marengo."""
    __tablename__ = "marengo_studies"
    __table_args__ = (Index("ix_marengo_studies_modality_status", "modality", "status"),)

    instance_code = Column(String(50), primary_key=True)
    id = Column(String, primary_key=True)
    modality = Column(String, nullable=False)
    study_description = Column(Text, nullable=True)
    status = Column(ENUM(*MARENGO_JOB_STATUS, name="marengo_job_status", create_type=False), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    processing_completed_at = Column(DateTime, nullable=True)
    credits_used = Column(Integer, nullable=False, server_default="0")


class MarengoJob(Base):
    __tablename__ = "marengo_jobs"
    __table_args__ = (
        Index("ix_marengo_jobs_study_status", "study_id", "status"),
        Index("ix_marengo_jobs_status_created", "status", "created_at"),
    )

    instance_code = Column(String(50), primary_key=True)
    id = Column(String, primary_key=True)
    study_id = Column(String, nullable=True)
    service_name = Column(String, nullable=False)
    status = Column(ENUM(*MARENGO_JOB_STATUS, name="marengo_job_status", create_type=False), nullable=False, server_default="QUEUED")
    attempts = Column(Integer, nullable=False, server_default="0")
    has_error = Column(Boolean, nullable=False, server_default="false")
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False)


class MarengoReportReview(Base):
    __tablename__ = "marengo_report_reviews"
    __table_args__ = (
        Index("ix_marengo_report_reviews_modality_status", "modality", "status"),
        Index("ix_marengo_report_reviews_study", "study_id"),
    )

    instance_code = Column(String(50), primary_key=True)
    id = Column(String, primary_key=True)
    study_id = Column(String, nullable=True)
    service_name = Column(String, nullable=False)
    modality = Column(String, nullable=True)
    status = Column(ENUM(*MARENGO_REVIEW_STATUS, name="marengo_report_review_status", create_type=False), nullable=False, server_default="PENDING")
    output_format = Column(ENUM(*MARENGO_RETURN_FORMAT, name="marengo_return_format", create_type=False), nullable=False, server_default="DICOM_ENCAPSULATED_PDF")
    locked = Column(Boolean, nullable=False, server_default="false")
    generated_at = Column(DateTime, nullable=False, server_default=func.now())
    pushed_at = Column(DateTime, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False)


class MarengoUsageLog(Base):
    __tablename__ = "marengo_usage_logs"
    __table_args__ = (Index("ix_marengo_usage_logs_created", "created_at"),)

    instance_code = Column(String(50), primary_key=True)
    id = Column(String, primary_key=True)
    service_name = Column(String, nullable=False)
    credits_used = Column(Integer, nullable=False)
    success = Column(Boolean, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class LicensePlan(Base):
    __tablename__ = "license_plans"
    __table_args__ = (
        Index("ix_ai_license_plans_test_type", "test_type_id"),
        CheckConstraint("credits >= 0", name="ck_ai_license_plans_credits_nonnegative"),
        CheckConstraint("validity_days >= 0", name="ck_ai_license_plans_validity_nonnegative"),
        CheckConstraint("plan_cost >= 0", name="ck_ai_license_plans_cost_nonnegative"),
        {"schema": "ai"},
    )

    plan_id = Column(BigInteger, primary_key=True, autoincrement=True)
    test_type_id = Column(Integer, nullable=True)
    plan_name = Column(String, nullable=False)
    credits = Column(Integer, nullable=False, default=0, server_default="0")
    validity_days = Column(Integer, nullable=False, default=0, server_default="0")
    plan_cost = Column(Numeric, nullable=False, default=0, server_default="0")


class DesktopLicense(Base):
    __tablename__ = "license_detail"
    __table_args__ = (
        Index("ix_ai_license_detail_scope_status", "license_app_scope", "status"),
        Index("ix_ai_license_detail_plan", "plan_id"),
        Index("ix_ai_license_detail_key", "license_key"),
        UniqueConstraint("license_key", "app_version_type", name="uq_ai_license_detail_key_platform"),
        CheckConstraint("status IN ('A', 'U', 'CF', 'B')", name="ck_ai_license_detail_status"),
        CheckConstraint("app_version_type IN ('DCP', 'DXP', 'CXR')", name="ck_ai_license_detail_platform"),
        CheckConstraint("credit_left >= 0 AND credit_available_online >= 0 AND ct_credits >= 0", name="ck_ai_license_detail_credits"),
        CheckConstraint("activation_count >= 0 AND activation_attempt_count >= 0 AND successful_validation_count >= 0", name="ck_ai_license_detail_activations"),
        CheckConstraint("fraud_attempt_count >= 0", name="ck_ai_license_detail_fraud_attempts"),
        {"schema": "ai"},
    )

    license_id = Column(BigInteger, primary_key=True, autoincrement=True)
    license_key = Column(String, nullable=False)
    plan_id = Column(BigInteger, ForeignKey("ai.license_plans.plan_id", ondelete="RESTRICT"), nullable=False)
    status = Column(String, nullable=False, default="A", server_default="A")
    app_version_type = Column(String, nullable=False)
    license_app_scope = Column(String, nullable=True)
    credit_left = Column(Integer, nullable=False, default=0, server_default="0")
    credit_available_online = Column(Integer, nullable=False, default=0, server_default="0")
    ct_credits = Column(Integer, nullable=False, default=0, server_default="0")
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    system_hash = Column(String, nullable=True)
    mac_address = Column(String, nullable=True)
    last_sync = Column(DateTime, nullable=True)
    activation_count = Column(Integer, nullable=False, default=0, server_default="0")
    activation_attempt_count = Column(Integer, nullable=False, default=0, server_default="0")
    successful_validation_count = Column(Integer, nullable=False, default=0, server_default="0")
    last_validation_at = Column(DateTime, nullable=True)
    fraud_detected = Column(Boolean, nullable=False, default=False, server_default="false")
    fraud_attempt_count = Column(Integer, nullable=False, default=0, server_default="0")
    last_fraud_attempt = Column(DateTime, nullable=True)
    last_fraud_reason = Column(Text, nullable=True)
    rate_limit_triggered = Column(Boolean, nullable=False, default=False, server_default="false")
    fullname = Column(String, nullable=True)
    username = Column(String, nullable=True)
    mobile = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    vendor_name = Column(String, nullable=True)
    geo_location = Column(String, nullable=True)
    carried_forward_from = Column(BigInteger, ForeignKey("ai.license_detail.license_id"), nullable=True)
    carried_forward_to = Column(BigInteger, ForeignKey("ai.license_detail.license_id"), nullable=True)
    carry_forward_date = Column(DateTime, nullable=True)
    blocked_at = Column(DateTime, nullable=True)
    blocked_reason = Column(Text, nullable=True)
    error_logs = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
