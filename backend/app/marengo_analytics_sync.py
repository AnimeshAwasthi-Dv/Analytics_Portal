"""Sync privacy-minimized analytics from the Marengo PostgreSQL schema."""

from __future__ import annotations

import logging
import os
import re
import hashlib
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Engine

from app.database import SessionLocal
from app.models import (
    Instance,
    MarengoJob,
    MarengoReportReview,
    MarengoStudy,
    MarengoUsageLog,
    SyncLog,
)
if TYPE_CHECKING:
    from app.source_sync import Source

logger = logging.getLogger("portal-marengo-analytics")
_verified_source_fingerprints: set[str] = set()

SOURCE_TABLES = {
    "studies": MarengoStudy,
    "jobs": MarengoJob,
    "report_reviews": MarengoReportReview,
    "usage_logs": MarengoUsageLog,
}

# The live schema is checked before any SELECT is run. These expectations come
# from the supplied schema snapshot and are intentionally independent of the
# PACS and API Control profiles.
SOURCE_COLUMNS: dict[str, dict[str, tuple[str, bool, str | None]]] = {
    "studies": {
        "id": ("TEXT", False, None), "clientId": ("TEXT", False, None),
        "studyUid": ("TEXT", False, None), "accession": ("TEXT", True, None),
        "modality": ("TEXT", False, None), "status": ("JobStatus", False, None),
        "aiResponse": ("JSONB", True, None), "reportJson": ("JSONB", True, None),
        "createdAt": ("TIMESTAMP", False, "current_timestamp"), "patientId": ("TEXT", True, None),
    },
    "jobs": {
        "id": ("TEXT", False, None), "clientId": ("TEXT", False, None),
        "studyId": ("TEXT", True, None), "serviceName": ("TEXT", False, None),
        "status": ("JobStatus", False, "queued"), "attempts": ("INTEGER", False, "0"),
        "error": ("TEXT", True, None), "latencyMs": ("INTEGER", True, None),
        "createdAt": ("TIMESTAMP", False, "current_timestamp"), "updatedAt": ("TIMESTAMP", False, None),
    },
    "report_reviews": {
        "id": ("TEXT", False, None), "clientId": ("TEXT", False, None),
        "studyId": ("TEXT", True, None), "radiologistId": ("TEXT", True, None),
        "serviceName": ("TEXT", False, None), "patientName": ("TEXT", True, None),
        "patientId": ("TEXT", True, None), "studyUid": ("TEXT", True, None),
        "accession": ("TEXT", True, None), "modality": ("TEXT", True, None),
        "status": ("ReportReviewStatus", False, "pending"),
        "outputFormat": ("ReturnFormat", False, "dicom_encapsulated_pdf"),
        "aiReportJson": ("JSONB", False, None), "editedReportJson": ("JSONB", False, None),
        "locked": ("BOOLEAN", False, "false"),
        "generatedAt": ("TIMESTAMP", False, "current_timestamp"),
        "pushedAt": ("TIMESTAMP", True, None), "reviewedAt": ("TIMESTAMP", True, None),
        "approvedAt": ("TIMESTAMP", True, None),
        "createdAt": ("TIMESTAMP", False, "current_timestamp"),
        "updatedAt": ("TIMESTAMP", False, None), "patientProfileId": ("TEXT", True, None),
    },
    "usage_logs": {
        "id": ("TEXT", False, None), "clientId": ("TEXT", False, None),
        "serviceName": ("TEXT", False, None), "studyUid": ("TEXT", True, None),
        "creditsUsed": ("INTEGER", False, None), "success": ("BOOLEAN", False, None),
        "message": ("TEXT", False, None), "createdAt": ("TIMESTAMP", False, "current_timestamp"),
    },
}

SOURCE_ENUMS = {
    "JobStatus": ("QUEUED", "PROCESSING", "SUCCESS", "FAILED"),
    "ReportReviewStatus": ("PENDING", "IN_REVIEW", "SAVED", "APPROVED", "PUSHED", "FAILED"),
    "ReturnFormat": ("DICOM_ENCAPSULATED_PDF", "DICOM_SECONDARY_CAPTURE", "HL7", "HTML", "PDF", "DOCX"),
}

SOURCE_SELECTS = {
    "studies": text('''SELECT id, modality, status, "createdAt" AS created_at
                       FROM public.studies WHERE id > :after_id ORDER BY id LIMIT :limit'''),
    "jobs": text('''SELECT id, "studyId" AS study_id, "serviceName" AS service_name, status,
                           attempts, (error IS NOT NULL AND BTRIM(error) <> '') AS has_error,
                           "latencyMs" AS latency_ms, "createdAt" AS created_at, "updatedAt" AS updated_at
                    FROM public.jobs WHERE id > :after_id ORDER BY id LIMIT :limit'''),
    "report_reviews": text('''SELECT id, "studyId" AS study_id, "serviceName" AS service_name,
                                    modality, status, "outputFormat" AS output_format, locked,
                                    "generatedAt" AS generated_at, "pushedAt" AS pushed_at,
                                    "reviewedAt" AS reviewed_at, "approvedAt" AS approved_at,
                                    "createdAt" AS created_at, "updatedAt" AS updated_at
                             FROM public.report_reviews WHERE id > :after_id ORDER BY id LIMIT :limit'''),
    "usage_logs": text('''SELECT id, "serviceName" AS service_name, "creditsUsed" AS credits_used,
                                success, "createdAt" AS created_at
                         FROM public.usage_logs WHERE id > :after_id ORDER BY id LIMIT :limit'''),
}

SOURCE_LOOKUPS = {
    "studies": text('''SELECT id, modality, status, "createdAt" AS created_at
                       FROM public.studies WHERE id = :source_id'''),
    "jobs": text('''SELECT id, "studyId" AS study_id, "serviceName" AS service_name, status,
                           attempts, (error IS NOT NULL AND BTRIM(error) <> '') AS has_error,
                           "latencyMs" AS latency_ms, "createdAt" AS created_at, "updatedAt" AS updated_at
                    FROM public.jobs WHERE id = :source_id'''),
    "report_reviews": text('''SELECT id, "studyId" AS study_id, "serviceName" AS service_name,
                                    modality, status, "outputFormat" AS output_format, locked,
                                    "generatedAt" AS generated_at, "pushedAt" AS pushed_at,
                                    "reviewedAt" AS reviewed_at, "approvedAt" AS approved_at,
                                    "createdAt" AS created_at, "updatedAt" AS updated_at
                             FROM public.report_reviews WHERE id = :source_id'''),
    "usage_logs": text('''SELECT id, "serviceName" AS service_name, "creditsUsed" AS credits_used,
                                success, "createdAt" AS created_at
                         FROM public.usage_logs WHERE id = :source_id'''),
}


def _normalize_default(value: Any) -> str | None:
    if value is None:
        return None
    default = str(value).lower().strip()
    default = re.sub(r"::[\w\"]+", "", default)
    default = default.replace('"', "").replace("'", "").replace("(", "").replace(")", "")
    return re.sub(r"\s+", "", default)


def verify_source_schema(engine: Engine) -> None:
    inspector = inspect(engine)
    errors: list[str] = []
    for table, expected_columns in SOURCE_COLUMNS.items():
        try:
            columns = {column["name"]: column for column in inspector.get_columns(table, schema="public")}
            primary_key = inspector.get_pk_constraint(table, schema="public").get("constrained_columns", [])
        except Exception as exc:
            raise RuntimeError(f"Could not inspect live Marengo table public.{table}: {exc}") from exc
        if primary_key != ["id"]:
            errors.append(f"public.{table} primary key is {primary_key!r}, expected ['id']")
        for name, (expected_type, nullable, expected_default) in expected_columns.items():
            column = columns.get(name)
            if column is None:
                errors.append(f"public.{table}.{name} is missing")
                continue
            actual_type = str(column["type"]).upper()
            type_matches = (
                getattr(column["type"], "name", None) == expected_type
                if expected_type in SOURCE_ENUMS
                else (
                    actual_type.startswith("TIMESTAMP") and getattr(column["type"], "precision", None) == 3
                    if expected_type == "TIMESTAMP"
                    else actual_type.startswith(expected_type)
                )
            )
            if not type_matches:
                errors.append(f"public.{table}.{name} type is {actual_type}, expected {expected_type}")
            if bool(column["nullable"]) != nullable:
                errors.append(f"public.{table}.{name} nullability differs from the expected schema")
            actual_default = _normalize_default(column.get("default"))
            normalized_expected = _normalize_default(expected_default)
            if actual_default != normalized_expected:
                errors.append(f"public.{table}.{name} default is {actual_default!r}, expected {normalized_expected!r}")
    enums = {entry["name"]: tuple(entry.get("labels", ())) for entry in inspector.get_enums(schema="public")}
    for name, labels in SOURCE_ENUMS.items():
        if enums.get(name) != labels:
            errors.append(f"public enum {name} is {enums.get(name)!r}, expected {labels!r}")
    if errors:
        raise RuntimeError("Live Marengo schema does not match the configured analytics mapping: " + "; ".join(errors))


def _record_values(table: str, row: dict[str, Any]) -> dict[str, Any]:
    if table == "jobs":
        return {**row, "has_error": bool(row["has_error"])}
    return row


def _upsert_batch(session, instance_code: str, table: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    model = SOURCE_TABLES[table]
    values = [{**_record_values(table, row), "instance_code": instance_code} for row in rows]
    update_columns = [column.name for column in model.__table__.columns if column.name != "id"]
    statement = insert(model).values(values)
    statement = statement.on_conflict_do_update(
        index_elements=[model.instance_code, model.id],
        set_={name: getattr(statement.excluded, name) for name in update_columns if name != "instance_code"},
    )
    session.execute(statement)


def import_marengo_source(source: "Source", batch_size: int, dry_run: bool = False,
                          only_source_id: str | None = None) -> dict[str, int]:
    """Reconcile four Marengo analytics tables; never copies report/patient JSON."""
    source_engine = create_engine(source.database_url, pool_pre_ping=True, pool_recycle=300)
    portal_db = SessionLocal()
    counts = {f"{table}_imported": 0 for table in SOURCE_TABLES}
    counts.update(scanned=0, invalid=0)
    try:
        fingerprint = hashlib.sha256(source.database_url.encode("utf-8")).hexdigest()
        if fingerprint not in _verified_source_fingerprints:
            verify_source_schema(source_engine)
            _verified_source_fingerprints.add(fingerprint)
        instance = portal_db.query(Instance).filter(Instance.identifier == source.instance_code).first()
        if not instance and not dry_run:
            instance = Instance(name=source.name, identifier=source.instance_code)
            portal_db.add(instance)
            portal_db.flush()

        token_table = None
        source_id = only_source_id
        if only_source_id and ":" in only_source_id:
            token_table, source_id = only_source_id.split(":", 1)
            if token_table not in SOURCE_TABLES:
                raise ValueError(f"Unknown Marengo notification table: {token_table}")
        tables = [token_table] if token_table else list(SOURCE_TABLES)
        page_limit = max(1, int(batch_size))
        for table in tables:
            if source_id is not None:
                with source_engine.connect() as connection:
                    rows = [dict(row) for row in connection.execute(
                        SOURCE_LOOKUPS[table], {"source_id": source_id}
                    ).mappings().all()]
                counts["scanned"] += len(rows)
                counts[f"{table}_imported"] += len(rows)
                if not dry_run:
                    _upsert_batch(portal_db, source.instance_code, table, rows)
            else:
                after_id = ""
                while True:
                    with source_engine.connect() as connection:
                        rows = [dict(row) for row in connection.execute(
                            SOURCE_SELECTS[table], {"after_id": after_id, "limit": page_limit}
                        ).mappings().all()]
                    if not rows:
                        break
                    counts["scanned"] += len(rows)
                    counts[f"{table}_imported"] += len(rows)
                    after_id = str(rows[-1]["id"])
                    if not dry_run:
                        _upsert_batch(portal_db, source.instance_code, table, rows)
                    if len(rows) < page_limit:
                        break
            if not dry_run:
                portal_db.commit()

        if not dry_run:
            if instance:
                instance.last_seen_at = datetime.now(timezone.utc)
            portal_db.add(SyncLog(
                instance_code=source.instance_code,
                event_type="MARENGO_ANALYTICS_SYNC",
                status="SUCCESS",
                message=f"Scanned {counts['scanned']} Marengo analytics rows.",
            ))
            portal_db.commit()
        logger.info("Marengo analytics reconciliation complete source=%s stats=%s dry_run=%s", source.name, counts, dry_run)
        return counts
    except Exception:
        portal_db.rollback()
        logger.exception("Marengo analytics sync failed for source %s", source.name)
        raise
    finally:
        portal_db.close()
        source_engine.dispose()
