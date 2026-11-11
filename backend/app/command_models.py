"""Central registry and analytics. Source IDs are always namespaced by portal."""
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.sql import func
from app.database import Base


class TeamRole(Base):
    __tablename__ = "command_team_roles"
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    role = Column(String(30), nullable=False, default="viewer")


class Portal(Base):
    __tablename__ = "command_portals"
    code = Column(String(50), primary_key=True)
    name = Column(String(120), nullable=False)
    client_code = Column(String(80), nullable=False)
    kind = Column(String(30), nullable=False)
    profile = Column(String(30), nullable=False, default="prisma")
    last_synced_at = Column(DateTime(timezone=True))
    sync_error = Column(String(200))
    watermark = Column(DateTime(timezone=True))


class Center(Base):
    __tablename__ = "command_centers"
    portal_code = Column(String(50), ForeignKey("command_portals.code"), primary_key=True)
    source_id = Column(String(160), primary_key=True)
    name = Column(String(255), nullable=False)
    client_code = Column(String(80), nullable=False, index=True)
    source_code = Column(String(120))
    source_status = Column(String(30))


class ServiceEvent(Base):
    __tablename__ = "command_service_events"
    __table_args__ = (
        Index("ix_command_events_portal_time", "portal_code", "occurred_at"),
        Index("ix_command_events_client_time", "client_code", "occurred_at"),
        Index("ix_command_events_center_time", "portal_code", "center_id", "occurred_at"),
        Index("ix_command_events_time_service", "occurred_at", "service"),
    )
    portal_code = Column(String(50), ForeignKey("command_portals.code"), primary_key=True)
    source_id = Column(String(180), primary_key=True)
    client_code = Column(String(80), nullable=False)
    center_id = Column(String(160))
    service = Column(String(120), nullable=False)
    status = Column(String(30), nullable=False)
    # Only a verified source attribution is accepted; never infer the submitter from center membership.
    actor_id = Column(String(160))
    actor_name = Column(String(160))
    duration_ms = Column(Float)
    credits = Column(Integer, nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class StudyFact(Base):
    """Business usage: one study per portal/client/UID, separate from job attempts."""
    __tablename__ = "command_study_usage"
    __table_args__ = (
        Index("ix_command_studies_portal_time", "portal_code", "occurred_at"),
        Index("ix_command_studies_client_time", "client_code", "occurred_at"),
        Index("ix_command_studies_center_time", "portal_code", "center_id", "occurred_at"),
        Index("ix_command_studies_service_time", "occurred_at", "service"),
    )
    portal_code = Column(String(50), ForeignKey("command_portals.code"), primary_key=True)
    source_id = Column(String(80), primary_key=True)
    source_reference = Column(String(180), nullable=False)
    client_code = Column(String(80), nullable=False)
    center_id = Column(String(160))
    service = Column(String(120), nullable=False)
    status = Column(String(30), nullable=False)
    workflow = Column(String(30), nullable=False)
    view_count = Column(Integer)
    view_source = Column(String(40))
    received_at = Column(DateTime(timezone=True), nullable=False)
    reported_at = Column(DateTime(timezone=True))
    occurred_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)
    duration_ms = Column(Float)


class ControlCommand(Base):
    __tablename__ = "command_controls"
    __table_args__ = (UniqueConstraint("request_key", name="uq_command_request_key"),)
    id = Column(Integer, primary_key=True)
    request_key = Column(String(80), nullable=False)
    portal_code = Column(String(50), ForeignKey("command_portals.code"), nullable=False)
    action = Column(String(40), nullable=False)
    target_id = Column(String(160), nullable=False)
    enabled = Column(Boolean, nullable=False)
    reason = Column(String(500), nullable=False)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(30), nullable=False, default="pending")
    result = Column(String(255))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    completed_at = Column(DateTime(timezone=True))


class UsageFact(Base):
    __tablename__ = "command_usage"
    __table_args__ = (Index("ix_command_usage_time_scope", "occurred_at", "portal_code", "client_code"),)
    portal_code = Column(String(50), ForeignKey("command_portals.code"), primary_key=True)
    source_id = Column(String(180), primary_key=True)
    client_code = Column(String(80), nullable=False)
    center_id = Column(String(160))
    service = Column(String(120), nullable=False)
    credits = Column(Integer, nullable=False)
    success = Column(Boolean, nullable=False)
    occurred_at = Column(DateTime(timezone=True), nullable=False)


class PortalResource(Base):
    __tablename__ = "command_resources"
    __table_args__ = (Index("ix_command_resources_directory", "resource_type", "name", "portal_code", "source_id"),)
    portal_code = Column(String(50), ForeignKey("command_portals.code"), primary_key=True)
    resource_type = Column(String(30), primary_key=True)
    source_id = Column(String(160), primary_key=True)
    name = Column(String(255), nullable=False)
    center_id = Column(String(160))
    enabled = Column(Boolean, nullable=False)
    details = Column(JSON, nullable=False, default=dict)


class UserActivity(Base):
    __tablename__ = "command_user_activity"
    __table_args__ = (Index("ix_command_activity_time_scope", "occurred_at", "portal_code", "client_code"),)
    portal_code = Column(String(50), ForeignKey("command_portals.code"), primary_key=True)
    source_id = Column(String(180), primary_key=True)
    client_code = Column(String(80), nullable=False)
    center_id = Column(String(160))
    actor_id = Column(String(160), nullable=False)
    actor_name = Column(String(160))
    action = Column(Text, nullable=False)
    occurred_at = Column(DateTime(timezone=True), nullable=False)


class AuditEntry(Base):
    __tablename__ = "command_audit"
    __table_args__ = (Index("ix_command_audit_created", "created_at"),)
    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String(80), nullable=False)
    target = Column(String(180), nullable=False)
    details = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AssistantThread(Base):
    __tablename__ = "command_assistant_threads"
    __table_args__ = (Index("ix_assistant_owner_updated", "owner_id", "updated_at"),)
    id = Column(String(36), primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    workspace = Column(String(50), nullable=False)
    title = Column(String(160), nullable=False, default="New conversation")
    messages = Column(JSON, nullable=False, default=list)
    revision = Column(Integer, nullable=False, default=0)
    busy_until = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
