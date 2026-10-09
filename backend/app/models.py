from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.database import Base


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
    api_key = Column(String, nullable=False)


class Instance(Base):
    __tablename__ = "instances"

    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    identifier = Column(String(120), nullable=False, unique=True)
    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
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

    id = Column(Integer, primary_key=True, index=True)

    instance_code = Column(
        String(50),
        nullable=False,
        index=True
    )

    modality = Column(String(50), nullable=True)

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