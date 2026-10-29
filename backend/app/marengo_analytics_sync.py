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
from app.modality import normalize_modality
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
SOURCE_NOTIFICATION_TABLES = (*SOURCE_TABLES.keys(), "processing_jobs")

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
    # The supplied Marengo schema defines processing_jobs.imageCount as the
    # count used by its processing pipeline. available_bridge_studies.instanceCount
    # is a separate field and is intentionally not used as an image count.
    "processing_jobs": {
        "id": ("TEXT", False, None), "internalJobId": ("TEXT", True, None),
        "status": ("TEXT", False, "queued"), "imageCount": ("INTEGER", False, "0"),
        "completedAt": ("TIMESTAMP", True, None),
        "updatedAt": ("TIMESTAMP", False, None),
    },
}

SOURCE_ENUMS = {
    "JobStatus": ("QUEUED", "PROCESSING", "SUCCESS", "FAILED"),
    "ReportReviewStatus": ("PENDING", "IN_REVIEW", "SAVED", "APPROVED", "PUSHED", "FAILED"),
    "ReturnFormat": ("DICOM_ENCAPSULATED_PDF", "DICOM_SECONDARY_CAPTURE", "HL7", "HTML", "PDF", "DOCX"),
}

STUDY_SELECT_FIELDS = '''
    SELECT s.id, s.modality, s.status,
           CASE WHEN UPPER(BTRIM(c.kind::text)) = 'CENTER' THEN c.id::text END AS centre_id,
           CASE WHEN UPPER(BTRIM(c.kind::text)) = 'CENTER' THEN c.name END AS centre_name,
           c.kind AS centre_kind,
           s."createdAt" AS created_at,
           latest_usage.service_name AS study_description,
           COALESCE(processing_job.completed_at, completed_job.completed_at,
                    usage_summary.usage_completed_at) AS processing_completed_at,
           processing_job.image_count AS image_count
    FROM public.studies AS s
    LEFT JOIN public.clients AS c ON c.id = s."clientId"
    LEFT JOIN LATERAL (
        SELECT u."serviceName" AS service_name
        FROM public.usage_logs AS u
        WHERE u."studyUid" = s."studyUid"
        ORDER BY u."createdAt" DESC, u.id DESC
        LIMIT 1
    ) AS latest_usage ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(u."createdAt") AS usage_completed_at
        FROM public.usage_logs AS u
        WHERE u."studyUid" = s."studyUid"
    ) AS usage_summary ON TRUE
    LEFT JOIN LATERAL (
        SELECT pj."imageCount" AS image_count, pj."completedAt" AS completed_at
        FROM public.processing_jobs AS pj
        WHERE pj."internalJobId" = s.id
          AND UPPER(BTRIM(pj.status)) = 'SUCCESS'
        ORDER BY pj."completedAt" DESC NULLS LAST, pj."updatedAt" DESC NULLS LAST, pj.id DESC
        LIMIT 1
    ) AS processing_job ON TRUE
    LEFT JOIN LATERAL (
        SELECT MAX(j."updatedAt") AS completed_at
        FROM public.jobs AS j
        WHERE j."studyId" = s.id AND j.status IN ('SUCCESS', 'FAILED')
    ) AS completed_job ON TRUE
'''

SOURCE_SELECTS = {
    "studies": text(STUDY_SELECT_FIELDS + '''
                       WHERE s.id > :after_id ORDER BY s.id LIMIT :limit'''),
    "jobs": text('''SELECT id, "studyId" AS study_id, "serviceName" AS service_name, status,
                           attempts, (error IS NOT NULL AND BTRIM(error) <> '') AS has_error,
                           "latencyMs" AS latency_ms, "createdAt" AS created_at, "updatedAt" AS updated_at
                    FROM public.jobs WHERE id > :after_id ORDER BY id LIMIT :limit'''),
    "report_reviews": text('''SELECT id, "studyId" AS study_id, "serviceName" AS service_name,
                                    modality, status, "patientName" AS patient_name,
                                    "outputFormat" AS output_format, locked,
                                    "generatedAt" AS generated_at, "pushedAt" AS pushed_at,
                                    "reviewedAt" AS reviewed_at, "approvedAt" AS approved_at,
                                    "createdAt" AS created_at, "updatedAt" AS updated_at
                             FROM public.report_reviews WHERE id > :after_id ORDER BY id LIMIT :limit'''),
    "usage_logs": text('''SELECT id, "serviceName" AS service_name, "studyUid" AS study_uid,
                                "creditsUsed" AS credits_used,
                                success, "createdAt" AS created_at
                         FROM public.usage_logs WHERE id > :after_id ORDER BY id LIMIT :limit'''),
}

PROCESSING_JOB_LOOKUP = text('''SELECT id, "internalJobId" AS study_id
                                FROM public.processing_jobs WHERE id = :source_id''')

SOURCE_LOOKUPS = {
    "studies": text(STUDY_SELECT_FIELDS + '''WHERE s.id = :source_id'''),
    "jobs": text('''SELECT id, "studyId" AS study_id, "serviceName" AS service_name, status,
                           attempts, (error IS NOT NULL AND BTRIM(error) <> '') AS has_error,
                           "latencyMs" AS latency_ms, "createdAt" AS created_at, "updatedAt" AS updated_at
                    FROM public.jobs WHERE id = :source_id'''),
    "report_reviews": text('''SELECT id, "studyId" AS study_id, "serviceName" AS service_name,
                                    modality, status, "patientName" AS patient_name,
                                    "outputFormat" AS output_format, locked,
                                    "generatedAt" AS generated_at, "pushedAt" AS pushed_at,
                                    "reviewedAt" AS reviewed_at, "approvedAt" AS approved_at,
                                    "createdAt" AS created_at, "updatedAt" AS updated_at
                             FROM public.report_reviews WHERE id = :source_id'''),
    "usage_logs": text('''SELECT id, "serviceName" AS service_name, "studyUid" AS study_uid,
                                "creditsUsed" AS credits_used,
                                success, "createdAt" AS created_at
                         FROM public.usage_logs WHERE id = :source_id'''),
}

STUDY_LOOKUP_BY_UID = text(STUDY_SELECT_FIELDS + '''WHERE s."studyUid" = :study_uid''')
STUDY_LOOKUP_BY_ID = text(STUDY_SELECT_FIELDS + '''WHERE s.id = :study_id''')


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
    try:
        client_columns = {
            column["name"]: column
            for column in inspector.get_columns("clients", schema="public")
        }
        client_pk = inspector.get_pk_constraint("clients", schema="public").get("constrained_columns", [])
        for required in ("id", "name", "kind"):
            if required not in client_columns:
                errors.append(f"public.clients.{required} is missing (required for centre mapping)")
        if client_pk != ["id"]:
            errors.append(f"public.clients primary key is {client_pk!r}, expected ['id'] for centre mapping")
        studies_fks = inspector.get_foreign_keys("studies", schema="public")
        if not any(
            fk.get("constrained_columns") == ["clientId"]
            and fk.get("referred_schema") in (None, "public")
            and fk.get("referred_table") == "clients"
            and fk.get("referred_columns") == ["id"]
            for fk in studies_fks
        ):
            errors.append("public.studies.clientId does not have a foreign key to public.clients.id")
        if "clientId" in {column["name"] for column in inspector.get_columns("studies", schema="public")} and "id" in client_columns:
            if str(client_columns["id"]["type"]).upper() != str(
                next(column for column in inspector.get_columns("studies", schema="public") if column["name"] == "clientId")["type"]
            ).upper():
                errors.append("public.studies.clientId and public.clients.id have different source types")
    except Exception as exc:
        errors.append(f"could not verify public.clients centre mapping: {exc}")
    if errors:
        raise RuntimeError("Live Marengo schema does not match the configured analytics mapping: " + "; ".join(errors))


def _record_values(table: str, row: dict[str, Any]) -> dict[str, Any]:
    if table == "studies":
        modality = normalize_modality(row.get("modality"), row.get("study_description"))
        if modality is None:
            # Keep the source label so analytics can show unfamiliar values
            # instead of collapsing every one into "Not specified".
            modality = str(row.get("modality") or "").strip() or "Not specified"
            logger.warning(
                "Unrecognized Marengo modality for source study id=%s; preserving source label and applying the non-X-ray credit rule",
                row.get("id"),
            )
        credits_used = 1
        if modality in {"X-Ray", "Special X-Ray"}:
            try:
                image_count = int(row.get("image_count") or 0)
            except (TypeError, ValueError):
                image_count = 0
            if image_count > 0:
                credits_used = image_count
            else:
                credits_used = 0
                logger.warning(
                    "Marengo X-ray study has no valid processing_jobs.imageCount; recording zero credits for source study id=%s",
                    row.get("id"),
                )
        if row.get("centre_kind") and str(row["centre_kind"]).strip().upper() != "CENTER":
            logger.warning("Marengo client kind %r is not a centre; leaving centre fields empty for source study id=%s", row["centre_kind"], row.get("id"))
            row = {**row, "centre_id": None, "centre_name": None}
        return {
            **{key: value for key, value in row.items() if key not in {"image_count", "centre_kind"}},
            "modality": modality,
            "credits_used": credits_used,
        }
    if table == "jobs":
        return {**row, "has_error": bool(row["has_error"])}
    if table == "report_reviews":
        modality = normalize_modality(row.get("modality"), row.get("service_name"))
        if modality is None:
            modality = str(row.get("modality") or "").strip() or "Not specified"
        return {
            **row,
            "modality": modality,
        }
    if table == "usage_logs":
        return {key: value for key, value in row.items() if key != "study_uid"}
    return row


def _upsert_batch(session, instance_code: str, table: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    model = SOURCE_TABLES[table]
    values = [{**_record_values(table, row), "instance_code": instance_code} for row in rows]
    immutable_columns = {"id"}
    if table == "studies":
        # Study credits are a calculated event value. A repeat clone/listener
        # notification may refresh metadata but must not recalculate history.
        immutable_columns.add("credits_used")
    update_columns = [
        column.name for column in model.__table__.columns
        if column.name not in immutable_columns
    ]
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
            if token_table not in SOURCE_NOTIFICATION_TABLES:
                raise ValueError(f"Unknown Marengo notification table: {token_table}")
        tables = (
            [] if token_table == "processing_jobs"
            else ([token_table] if token_table else list(SOURCE_TABLES))
        )
        page_limit = max(1, int(batch_size))
        if token_table == "processing_jobs" and source_id is not None:
            with source_engine.connect() as connection:
                processing_job = connection.execute(
                    PROCESSING_JOB_LOOKUP, {"source_id": source_id}
                ).mappings().first()
            if processing_job and processing_job["study_id"]:
                with source_engine.connect() as connection:
                    study_rows = [dict(row) for row in connection.execute(
                        STUDY_LOOKUP_BY_ID, {"study_id": processing_job["study_id"]}
                    ).mappings().all()]
                counts["scanned"] += 1
                counts["studies_imported"] += len(study_rows)
                if not dry_run:
                    _upsert_batch(portal_db, source.instance_code, "studies", study_rows)
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
                if table in {"usage_logs", "jobs"}:
                    # Usage logs supply the description and credits; successful
                    # jobs supply the completion time. Refresh the linked study
                    # whenever either source table changes.
                    for usage_row in rows:
                        params = None
                        lookup = None
                        if table == "usage_logs" and usage_row.get("study_uid"):
                            lookup = STUDY_LOOKUP_BY_UID
                            params = {"study_uid": usage_row["study_uid"]}
                        elif table == "jobs" and usage_row.get("study_id"):
                            lookup = STUDY_LOOKUP_BY_ID
                            params = {"study_id": usage_row["study_id"]}
                        if lookup is None:
                            continue
                        with source_engine.connect() as connection:
                            study_rows = [dict(row) for row in connection.execute(
                                lookup, params
                            ).mappings().all()]
                        counts["studies_imported"] = counts.get("studies_imported", 0) + len(study_rows)
                        if not dry_run:
                            _upsert_batch(portal_db, source.instance_code, "studies", study_rows)
                elif table == "report_reviews":
                    for review_row in rows:
                        if not review_row.get("study_id"):
                            continue
                        with source_engine.connect() as connection:
                            study_rows = [dict(row) for row in connection.execute(
                                STUDY_LOOKUP_BY_ID, {"study_id": review_row["study_id"]}
                            ).mappings().all()]
                        counts["studies_imported"] += len(study_rows)
                        if not dry_run:
                            _upsert_batch(portal_db, source.instance_code, "studies", study_rows)
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
