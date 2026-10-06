from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
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

class DatabaseConfig(Base):
    __tablename__ = "database_configs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    host = Column(String(255), nullable=False)
    port = Column(Integer, default=5432)
    database_name = Column(String(100), nullable=False)
    username = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class SourceInstance(Base):
    __tablename__ = "source_instances"

    id = Column(Integer, primary_key=True, index=True)

    instance_code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)

    status = Column(String(30), default="OFFLINE")

    last_heartbeat = Column(DateTime(timezone=True), nullable=True)

    total_synced = Column(Integer, default=0)
    total_failed = Column(Integer, default=0)

    api_key = Column(String(255), unique=True, nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

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