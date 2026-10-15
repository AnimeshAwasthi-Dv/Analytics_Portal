"""Import successful work using PostgreSQL LISTEN/NOTIFY source triggers."""

from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import time
from concurrent.futures import FIRST_EXCEPTION, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
import psycopg
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine, make_url

from app.database import SessionLocal
from app.models import Instance, SyncLog, SyncRecord
from app.marengo_analytics_sync import import_marengo_source, verify_source_schema
load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("portal-source-sync")

X_RAY_MODALITIES = {"XR", "CR", "CRI", "DX", "MG"}
X_RAY_KEYWORDS = (
    "X-RAY", "XRAY", "MAMMO", "MAMMOGRAPHY", "BARIUM SWALLOW", "MCT",
    "MCU", "URETHROGRAM", "CYSTOURETHROGRAM", "GENITOURETHROGRAM",
    "BARIUM ENEMA", "FLUORO", "FLUOROSCOPY", "IVU", "CONTRAST SWALLOW",
    "FISTULOGRAM", "DYE STUDY",
)


@dataclass(frozen=True)
class Source:
    name: str
    profile: str
    instance_code: str
    database_url: str


SOURCE_SQL = {
    "pacs": text('''
        SELECT pj.id AS source_id,
               COALESCE(abs.modalities[1], pj."serviceType") AS modality,
               pj."createdAt" AS processing_created_at,
               pj."completedAt" AS processing_completed_at,
               pj."imageCount" AS image_count,
               pj."serviceType" AS service_type,
               COALESCE(abs."studyDescription", pj."uploadName", pj."serviceType") AS study_description
        FROM public.processing_jobs AS pj
        LEFT JOIN LATERAL (
            SELECT b."studyDescription", b.modalities
            FROM public.available_bridge_studies AS b
            WHERE b."processingJobId" = pj.id
            ORDER BY b."updatedAt" DESC NULLS LAST, b."createdAt" DESC NULLS LAST
            LIMIT 1
        ) AS abs ON TRUE
        WHERE UPPER(BTRIM(pj.status)) = 'SUCCESS'
          AND (CAST(:source_id AS BIGINT) IS NULL OR pj.id = CAST(:source_id AS BIGINT))
        ORDER BY pj.id
        LIMIT :limit OFFSET :offset
    '''),
    "api_control": text('''
        SELECT j.id AS source_id, j.upload_type AS modality,
               j.created_at AS processing_created_at,
               j.completed_at AS processing_completed_at,
               j.image_count AS image_count,
               j.upload_type AS service_type,
               j.upload_name AS study_description
        FROM public.jobs AS j
        WHERE UPPER(BTRIM(j.status)) = 'SUCCESS'
          AND (CAST(:source_id AS BIGINT) IS NULL OR j.id = CAST(:source_id AS BIGINT))
        ORDER BY j.id
        LIMIT :limit OFFSET :offset
    '''),
}

SOURCE_TRIGGER_TABLES = {
    "marengo": "public.studies",
    "pacs": "public.processing_jobs",
    "api_control": "public.jobs",
}
NOTIFY_CHANNEL = "portal_sync_events"


def install_source_trigger(source: Source) -> None:
    """Install a small status-transition trigger in one configured source DB."""
    if source.profile == "marengo":
        install_marengo_source_triggers(source)
        return
    table = SOURCE_TRIGGER_TABLES[source.profile]
    engine = create_engine(source.database_url, pool_pre_ping=True)
    try:
        schema_name, table_name = table.split(".", 1)
        columns = {column["name"] for column in inspect(engine).get_columns(table_name, schema=schema_name)}
        missing = {"id", "status"} - columns
        if missing:
            actual = ", ".join(sorted(columns)) or "no table found"
            raise RuntimeError(
                f"{source.name} is configured with the '{source.profile}' profile, which expects "
                f"{table}.id and {table}.status. Missing: {', '.join(sorted(missing))}. "
                f"Columns found: {actual}. Check that {source.name.upper().replace(' ', '_')}_DATABASE_URL "
                "points to the correct database/profile."
            )
        with engine.begin() as connection:
            connection.execute(text(f"""
                CREATE OR REPLACE FUNCTION public.portal_sync_notify_success()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    IF UPPER(BTRIM(NEW.status)) = 'SUCCESS' THEN
                        IF TG_OP = 'INSERT' THEN
                            PERFORM pg_notify('{NOTIFY_CHANNEL}', NEW.id::text);
                        ELSIF UPPER(BTRIM(COALESCE(OLD.status, ''))) <> 'SUCCESS' THEN
                            PERFORM pg_notify('{NOTIFY_CHANNEL}', NEW.id::text);
                        END IF;
                    END IF;
                    RETURN NEW;
                END;
                $$;
            """))
            connection.execute(text(f"DROP TRIGGER IF EXISTS portal_sync_notify_success ON {table}"))
            connection.execute(text(f"""
                CREATE TRIGGER portal_sync_notify_success
                AFTER INSERT OR UPDATE OF status ON {table}
                FOR EACH ROW
                EXECUTE FUNCTION public.portal_sync_notify_success()
            """))
        logger.info("Installed SUCCESS notification trigger for %s (%s)", source.name, table)
    finally:
        engine.dispose()


def install_marengo_source_triggers(source: Source) -> None:
    """Notify the Marengo listener when any analytics row is inserted or updated."""
    from app.marengo_analytics_sync import SOURCE_TABLES

    engine = create_engine(source.database_url, pool_pre_ping=True)
    try:
        verify_source_schema(engine)
        with engine.begin() as connection:
            connection.execute(text(f"""
                CREATE OR REPLACE FUNCTION public.portal_sync_notify_marengo_analytics()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    PERFORM pg_notify('{NOTIFY_CHANNEL}', TG_TABLE_NAME || ':' || NEW.id::text);
                    RETURN NEW;
                END;
                $$;
            """))
            for table_name in SOURCE_TABLES:
                connection.execute(text(f"DROP TRIGGER IF EXISTS portal_sync_notify_analytics ON public.{table_name}"))
                connection.execute(text(f"""
                    CREATE TRIGGER portal_sync_notify_analytics
                    AFTER INSERT OR UPDATE ON public.{table_name}
                    FOR EACH ROW EXECUTE FUNCTION public.portal_sync_notify_marengo_analytics()
                """))
        logger.info("Installed analytics notification triggers for %s", source.name)
    finally:
        engine.dispose()


def install_source_triggers(source_filter: str | None = None) -> bool:
    sources = load_sources()
    if source_filter:
        sources = [source for source in sources if source.name.casefold() == source_filter.casefold()
                   or source.instance_code.casefold() == source_filter.casefold()]
        if not sources:
            raise RuntimeError(f"No configured source matches {source_filter!r}.")
    failed = False
    for source in sources:
        try:
            install_source_trigger(source)
        except Exception as exc:
            failed = True
            logger.error("Could not install trigger for %s: %s", source.name, exc)
    return not failed


def load_sources(*, allow_empty: bool = False) -> list[Source]:
    raw = os.getenv("PORTAL_SOURCE_DATABASES", "").strip()
    if raw:
        try:
            configs = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError("PORTAL_SOURCE_DATABASES must contain valid JSON.") from exc
    else:
        # Simple local setup: paste the connection URL for each source into .env.
        # Unset URLs are ignored, so a single portal can be tested independently.
        direct_sources = (
            ("Marengo", "marengo", "marengo-01", "MARENGO_DATABASE_URL"),
            ("PACS", "pacs", "pacs-01", "PACS_DATABASE_URL"),
            ("API Control", "api_control", "api-control-01", "API_CONTROL_DATABASE_URL"),
        )
        configs = [
            {"name": name, "profile": profile, "instance_code": code, "database_url": os.getenv(env_name, "").strip()}
            for name, profile, code, env_name in direct_sources
            if os.getenv(env_name, "").strip()
        ]
    if not isinstance(configs, list) or (not configs and not allow_empty):
        raise RuntimeError(
            "No source database URLs configured. Set MARENGO_DATABASE_URL, "
            "PACS_DATABASE_URL, or API_CONTROL_DATABASE_URL in backend/.env; "
            "PORTAL_SOURCE_DATABASES JSON is also supported."
        )

    sources = []
    codes = set()
    for item in configs:
        if not isinstance(item, dict):
            raise RuntimeError("Each source database entry must be a JSON object.")
        name = str(item.get("name", "")).strip()
        profile = str(item.get("profile", "")).strip().lower()
        instance_code = str(item.get("instance_code", "")).strip()
        database_url = str(item.get("database_url", "")).strip()
        if profile not in {"marengo", "pacs", "api_control"}:
            raise RuntimeError(f"Unsupported source profile for {name or 'unnamed source'}; use marengo, pacs, or api_control.")
        if not name or not instance_code or len(instance_code) > 50 or not database_url:
            raise RuntimeError("Each source must define name, instance_code (1-50 chars), and database_url.")
        if instance_code in codes:
            raise RuntimeError(f"Duplicate source instance_code: {instance_code}")
        codes.add(instance_code)
        sources.append(Source(name, profile, instance_code, database_url))
    return sources


def make_payload(row: dict[str, Any]) -> dict[str, Any]:
    modality = str(row.get("modality") or row.get("service_type") or "").strip().upper()
    description = row.get("study_description") or row.get("service_type")
    matching_text = f"{description or ''} {row.get('service_type') or ''}".upper()
    is_xray = modality in X_RAY_MODALITIES or any(word in matching_text for word in X_RAY_KEYWORDS)
    if is_xray:
        credits_used = int(row.get("image_count") or 0)
        if credits_used <= 0:
            raise ValueError("X-ray image count is missing or zero.")
    else:
        credits_used = 1
    return {
        "modality": modality or None,
        "study_description": description,
        "processing_created_at": row.get("processing_created_at"),
        "processing_completed_at": row.get("processing_completed_at"),
        "credits_used": credits_used,
    }


def import_source(source: Source, batch_size: int, dry_run: bool = False,
                  only_source_id: int | str | None = None) -> dict[str, int]:
    if source.profile == "marengo":
        return import_marengo_source(source, batch_size, dry_run, str(only_source_id) if only_source_id is not None else None)
    source_engine: Engine = create_engine(source.database_url, pool_pre_ping=True, pool_recycle=300)
    portal_db = SessionLocal()
    offset = 0
    imported = skipped = rejected = scanned = 0
    try:
        instance = portal_db.query(Instance).filter(Instance.identifier == source.instance_code).first()
        if not instance and not dry_run:
            instance = Instance(name=source.name, identifier=source.instance_code)
            portal_db.add(instance)
            portal_db.commit()

        existing_query = portal_db.query(SyncRecord.source_record_id).filter(
            SyncRecord.instance_code == source.instance_code,
            SyncRecord.source_record_id.isnot(None),
        )
        if only_source_id is not None:
            existing_query = existing_query.filter(SyncRecord.source_record_id == str(only_source_id))
        existing_ids = {str(value) for (value,) in existing_query.all()}

        while True:
            with source_engine.connect() as connection:
                rows = [dict(row) for row in connection.execute(
                    SOURCE_SQL[source.profile],
                    {"limit": batch_size, "offset": offset, "source_id": only_source_id},
                ).mappings().all()]
            if not rows:
                break
            scanned += len(rows)
            for row in rows:
                record_id = str(row["source_id"])
                if record_id in existing_ids:
                    skipped += 1
                    continue
                try:
                    payload = make_payload(row)
                except (TypeError, ValueError):
                    rejected += 1
                    logger.warning("Skipping invalid record source=%s record_id=%s", source.name, record_id)
                    continue
                if dry_run:
                    imported += 1
                    existing_ids.add(record_id)
                    continue
                portal_db.add(SyncRecord(
                    instance_code=source.instance_code,
                    source_record_id=record_id,
                    modality=payload["modality"],
                    study_description=payload["study_description"],
                    processing_created_at=payload["processing_created_at"],
                    processing_completed_at=payload["processing_completed_at"],
                    credits_used=payload["credits_used"],
                    sync_status="SYNCED",
                ))
                existing_ids.add(record_id)
                imported += 1
            if not dry_run:
                portal_db.commit()
            offset += len(rows)
            if len(rows) < batch_size:
                break

        logger.info("Source %s scanned=%s imported=%s duplicate=%s invalid=%s dry_run=%s", source.name, scanned, imported, skipped, rejected, dry_run)
        if not dry_run:
            if instance:
                instance.last_seen_at = datetime.now(timezone.utc)
            portal_db.add(SyncLog(
                instance_code=source.instance_code,
                event_type="DIRECT_DB_SYNC",
                status="SUCCESS",
                message=f"Scanned {scanned}; imported {imported}; duplicates {skipped}; invalid {rejected}.",
            ))
            portal_db.commit()
        return {"scanned": scanned, "imported": imported, "duplicates": skipped, "invalid": rejected}
    except Exception:
        portal_db.rollback()
        logger.exception("Direct database sync failed for source %s", source.name)
        if not dry_run:
            try:
                portal_db.add(SyncLog(
                    instance_code=source.instance_code,
                    event_type="DIRECT_DB_SYNC",
                    status="FAILED",
                    message="Source database sync failed. See source sync worker logs for details.",
                ))
                portal_db.commit()
            except Exception:
                portal_db.rollback()
        raise
    finally:
        portal_db.close()
        source_engine.dispose()


def run_once(source_filter: str | None = None, dry_run: bool = False) -> dict[str, dict[str, int]]:
    sources = load_sources()
    if source_filter:
        sources = [source for source in sources if source.name.casefold() == source_filter.casefold() or source.instance_code.casefold() == source_filter.casefold()]
        if not sources:
            raise RuntimeError(f"No configured source matches {source_filter!r}.")
    batch_size = max(1, int(os.getenv("SOURCE_SYNC_BATCH_SIZE", "500")))
    result = {}
    for source in sources:
        try:
            result[source.name] = import_source(source, batch_size, dry_run)
        except Exception:
            # Keep other configured portals importing if one source DB is down.
            result[source.name] = {"error": 1}
    return result


def _psycopg_conninfo(database_url: str) -> str:
    url = make_url(database_url)
    if url.drivername.startswith("postgresql+"):
        url = url.set(drivername="postgresql")
    return url.render_as_string(hide_password=False)


def _listen_to_source(source: Source, batch_size: int, stop_event: threading.Event,
                      dry_run: bool = False) -> None:
    """Listen for committed success notifications and backfill after reconnects."""
    conninfo = _psycopg_conninfo(source.database_url)
    while not stop_event.is_set():
        try:
            with psycopg.connect(conninfo, autocommit=True) as connection:
                connection.execute(f"LISTEN {NOTIFY_CHANNEL}")
                logger.info("Listening for database changes from %s", source.name)

                # Recover records created while this worker was offline. LISTEN is
                # committed before the scan, so future changes are also notified.
                logger.info("Running startup reconciliation for %s", source.name)
                import_source(source, batch_size, dry_run=dry_run)

                while not stop_event.is_set():
                    for notification in connection.notifies(timeout=10, stop_after=1):
                        if source.profile == "marengo":
                            source_id = str(notification.payload)
                            if ":" not in source_id:
                                logger.warning("Ignoring invalid Marengo analytics notification")
                                continue
                        else:
                            try:
                                source_id = int(notification.payload)
                            except (TypeError, ValueError):
                                logger.warning("Ignoring invalid notification from %s", source.name)
                                continue
                        stats = import_source(source, batch_size, dry_run=dry_run, only_source_id=source_id)
                        logger.info("Notification handled for %s record=%s stats=%s", source.name, source_id, stats)
        except KeyboardInterrupt:
            raise
        except Exception:
            if stop_event.is_set():
                return
            logger.exception("Listener for %s disconnected; retrying in 5 seconds", source.name)
            stop_event.wait(5)


def listen_sources(source_filter: str | None = None, dry_run: bool = False,
                   stop_event: threading.Event | None = None) -> None:
    sources = load_sources()
    if source_filter:
        sources = [source for source in sources if source.name.casefold() == source_filter.casefold()
                   or source.instance_code.casefold() == source_filter.casefold()]
        if not sources:
            raise RuntimeError(f"No configured source matches {source_filter!r}.")
    batch_size = max(1, int(os.getenv("SOURCE_SYNC_BATCH_SIZE", "500")))
    logger.info("Starting listeners for %s portal source(s)", len(sources))
    if stop_event is None:
        stop_event = threading.Event()
    try:
        with ThreadPoolExecutor(max_workers=len(sources), thread_name_prefix="source-listener") as pool:
            futures = [pool.submit(_listen_to_source, source, batch_size, stop_event, dry_run) for source in sources]
            try:
                done, _ = wait(futures, return_when=FIRST_EXCEPTION)
                for future in done:
                    future.result()
            except KeyboardInterrupt:
                logger.info("Stopping source listeners")
                stop_event.set()
            except BaseException:
                stop_event.set()
                raise
    except KeyboardInterrupt:
        logger.info("Stopping source listeners")
        stop_event.set()


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Marengo analytics and successful PACS/API Control studies from source PostgreSQL databases.")
    parser.add_argument("--source", help="Only import the named source or instance_code.")
    parser.add_argument("--dry-run", action="store_true", help="Read source rows and count candidates without writing to the portal DB.")
    parser.add_argument("--install-triggers", action="store_true", help="Install source-specific triggers for configured Marengo, PACS, or API Control databases.")
    parser.add_argument("--listen", action="store_true", help="Listen to configured Marengo, PACS, and API Control databases.")
    parser.add_argument("--watch", action="store_true", help="Deprecated alias for --listen.")
    args = parser.parse_args()
    if args.install_triggers:
        if not install_source_triggers(args.source):
            raise SystemExit(1)
        return
    if args.listen or args.watch:
        listen_sources(args.source, args.dry_run)
        return
    result = run_once(args.source, args.dry_run)
    logger.info("Sync pass complete: %s", json.dumps(result, sort_keys=True))
    if any("error" in stats for stats in result.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
