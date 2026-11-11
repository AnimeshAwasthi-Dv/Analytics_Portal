"""Read-only, keyset-paged source ingestion. Run: python -m app.command_sync.

No source triggers or schema changes. Source connections enforce read-only transactions.
An overlap plus refresh of nonterminal jobs catches late completions without OFFSET scans.
"""
import argparse
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import make_url

from app.database import SessionLocal
from app.command_api import SOURCE_ENV
from app.command_models import Center, Portal, ServiceEvent, UsageFact, UserActivity, PortalResource, StudyFact

log = logging.getLogger("command-sync")
BATCH = 500


def source_engine(url, readonly=True):
    parsed = make_url(url)
    # Prisma's schema/pool settings are not libpq connection parameters.
    parsed = parsed.difference_update_query(["schema", "connection_limit", "pool_timeout", "pgbouncer"])
    if parsed.drivername in {"postgresql", "postgresql+psycopg2"}:
        parsed = parsed.set(drivername="postgresql+psycopg")
    if parsed.drivername != "postgresql+psycopg":
        raise ValueError("Only PostgreSQL sources are supported")
    options = "-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=3000"
    if readonly:
        options += " -c default_transaction_read_only=on"
    return create_engine(parsed, pool_pre_ping=True, pool_size=1, max_overflow=0,
                         connect_args={"connect_timeout": 8, "options": options})


def client_mapping():
    # Explicit immutable source center IDs, never fuzzy matching hospital names.
    raw = json.loads(os.getenv("COMMAND_CENTER_CLIENT_MAP", "{}"))
    if not isinstance(raw, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not 1 <= len(v) <= 80 for k, v in raw.items()):
        raise ValueError("COMMAND_CENTER_CLIENT_MAP must map portal:center IDs to client codes")
    return raw


def mapped_clients(centers, code, overrides):
    # Explicit group IDs also matter for audit actions by group administrators.
    # Group records are deliberately not stored as physical centers.
    result=dict(centers)
    prefix=code+":"
    result.update({key[len(prefix):]:value for key,value in overrides.items() if key.startswith(prefix)})
    return result


def classify_status(value):
    value = str(value).upper()
    if value in {"SUCCESS", "COMPLETED", "DONE", "APPROVED", "PUSHED"}:
        return "SUCCESS"
    if value in {"FAILED", "ERROR", "CANCELLED", "CANCELED"}:
        return "FAILED"
    if value in {"QUEUED", "PENDING"}:
        return "QUEUED"
    return "PROCESSING"


def upsert(db, model, rows, keys):
    if not rows:
        return
    stmt = insert(model).values(rows)
    db.execute(stmt.on_conflict_do_update(index_elements=keys, set_={c.name: getattr(stmt.excluded, c.name) for c in model.__table__.columns if c.name not in keys}))


def sync_portal(code, full=False, studies_full=False, replace_snapshot=False):
    url = (os.getenv("ONPREM_DATABASE_URL") or os.getenv(SOURCE_ENV[code])) if code == "onprem" else os.getenv(SOURCE_ENV[code])
    if not url:
        return 0
    engine = source_engine(url)
    try:
        with SessionLocal() as db, engine.connect() as src:
            # One transaction per portal sync avoids overlapping worker runs.
            locked = db.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"), {"key": f"command-sync:{code}"}).scalar()
            if not locked:
                return 0
            p = db.get(Portal, code)
            if not p:
                raise ValueError("Apply the central-command migration first")
            if replace_snapshot:
                # A source switch must remove old IDs as well as replay history.
                # Keep replacement in this transaction so a failed import restores the snapshot.
                for model in (ServiceEvent, UsageFact, UserActivity, StudyFact, PortalResource, Center):
                    db.query(model).filter_by(portal_code=code).delete(synchronize_session=False)
                full = studies_full = True
            mapping = client_mapping()
            started = datetime.now(timezone.utc)
            watermark = datetime(1970, 1, 1, tzinfo=timezone.utc) if full or not p.watermark else p.watermark - timedelta(minutes=10)
            if code == "onprem":
                center_sql = "SELECT id, name, code, CASE WHEN active THEN 'ACTIVE' ELSE 'BLOCKED' END AS status FROM sx_portal.clients ORDER BY id"
            else:
                center_sql = "SELECT id, name, code, status::text FROM public.clients WHERE kind::text='CENTER' ORDER BY id"
            # Stream registry too, rather than fetching an unbounded source table.
            result = src.execution_options(stream_results=True).execute(text(center_sql))
            for batch in result.mappings().partitions(BATCH):
                rows = [dict(portal_code=code, source_id=r["id"], name=r["name"], source_code=r["code"], source_status=r["status"],
                             client_code=mapping.get(f"{code}:{r['id']}", p.client_code if p.kind != "shared" else f"pacs:{r['id']}")) for r in batch]
                upsert(db, Center, rows, ["portal_code", "source_id"])
            db.flush()
            sync_resources(src, db, code)
            if code == "onprem":
                from app.desktop_usage import sync_desktop
                sync_desktop(src, db)
            centers = mapped_clients({c.source_id: c.client_code for c in db.query(Center).filter_by(portal_code=code)},code,mapping)
            cursor_time = watermark
            cursor_id = ""
            total = 0
            while True:
                if code == "onprem":
                    # Provider state changes carry updated_at; full sync reconciles manual source edits.
                    sql = '''SELECT s.id, s.client_id AS center_id, 'Teleradiology / ' || s.edition AS service, s.status,
                             s.created_at AS occurred_at, COALESCE(p.updated_at,s.created_at) AS updated_at,
                             NULL::double precision AS duration_ms
                             FROM sx_portal.studies s LEFT JOIN sx_portal.provider_submissions p ON p.study_id=s.id
                             WHERE (COALESCE(p.updated_at,s.created_at), s.id) > (:cursor_time, :cursor_id)
                             AND COALESCE(p.updated_at,s.created_at) <= :started
                             ORDER BY COALESCE(p.updated_at,s.created_at), s.id LIMIT :limit'''
                else:
                    sql = '''SELECT id, "clientId" AS center_id, "serviceType" AS service, status,
                             "createdAt" AS occurred_at, "updatedAt" AS updated_at,
                             CASE WHEN "completedAt" >= "createdAt" THEN
                               EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) * 1000 END AS duration_ms
                             FROM public.processing_jobs
                             WHERE ("updatedAt", id) > (:cursor_time, :cursor_id)
                             AND "updatedAt" <= :started ORDER BY "updatedAt", id LIMIT :limit'''
                rows = src.execute(text(sql), dict(cursor_time=cursor_time, cursor_id=cursor_id, started=started, limit=BATCH)).mappings().all()
                if not rows:
                    break
                events = [dict(portal_code=code, source_id=r["id"], client_code=centers.get(r["center_id"], p.client_code),
                               center_id=r["center_id"], service=r["service"], status=classify_status(r["status"]),
                               actor_id=None, actor_name=None, duration_ms=r["duration_ms"], credits=None,
                               occurred_at=r["occurred_at"], updated_at=r["updated_at"]) for r in rows]
                upsert(db, ServiceEvent, events, ["portal_code", "source_id"])
                total += len(rows)
                log.info("%s: processing records scanned=%s", code, total)
                cursor_time, cursor_id = rows[-1]["updated_at"], rows[-1]["id"]
            from app.study_usage import sync_studies
            study_since=datetime(1970,1,1,tzinfo=timezone.utc) if studies_full else watermark
            sync_studies(src,db,p,centers,study_since,started,upsert,BATCH)
            sync_usage_and_activity(src, db, p, centers, watermark, started)
            # Re-attribute historical events after a center mapping is corrected.
            for center_id, client in centers.items():
                for model in (ServiceEvent, UsageFact, UserActivity, StudyFact):
                    db.query(model).filter_by(portal_code=code, center_id=center_id).filter(model.client_code != client).update({"client_code": client})
            p.last_synced_at = started
            p.watermark = started
            p.sync_error = None
            db.commit()
            return total
    except Exception as error:
        # Never persist connection exception text: it can contain credentials or source data.
        with SessionLocal() as db:
            p = db.get(Portal, code)
            if p:
                p.sync_error = f"Source sync failed ({type(error).__name__}); check schema, access and worker logs."
                db.commit()
        raise
    finally:
        engine.dispose()


def sync_usage_and_activity(src, db, portal, centers, watermark, started):
    code = portal.code
    if code == "onprem":
        queries = [(UsageFact, '''SELECT d.id, l.client_id AS center_id, 'Shared license credits' AS service,
                    d.units AS credits, TRUE AS success, d.created_at AS occurred_at
                    FROM sx_portal.credit_debits d JOIN sx_portal.licenses l ON l.id=d.license_id
                    WHERE (d.created_at,d.id) > (:cursor_time,:cursor_id) AND d.created_at <= :started
                    ORDER BY d.created_at,d.id LIMIT :limit''')]
    else:
        queries = [(UsageFact, '''SELECT id, "clientId" AS center_id, "serviceName" AS service,
                    "creditsUsed" AS credits, success, "createdAt" AS occurred_at FROM public.usage_logs
                    WHERE ("createdAt",id) > (:cursor_time,:cursor_id) AND "createdAt" <= :started
                    ORDER BY "createdAt",id LIMIT :limit'''),
                   (UserActivity, '''SELECT a.id, a."clientId" AS center_id, a."actorUserId" AS actor_id,
                    u.name AS actor_name, a.action, a."createdAt" AS occurred_at
                    FROM public.audit_logs a LEFT JOIN public.users u ON u.id=a."actorUserId"
                    WHERE (a."createdAt",a.id) > (:cursor_time,:cursor_id) AND a."createdAt" <= :started
                    AND a."actorUserId" IS NOT NULL ORDER BY a."createdAt",a.id LIMIT :limit''')]
    for model, sql in queries:
        cursor_time, cursor_id = watermark, ""
        scanned = 0
        while True:
            rows = src.execute(text(sql), dict(cursor_time=cursor_time, cursor_id=cursor_id, started=started, limit=BATCH)).mappings().all()
            if not rows:
                break
            payload = []
            for row in rows:
                item = dict(row)
                item["source_id"] = item.pop("id")
                item["portal_code"] = code
                item["client_code"] = centers.get(item["center_id"], portal.client_code)
                payload.append(item)
            upsert(db, model, payload, ["portal_code", "source_id"])
            scanned += len(rows)
            log.info("%s: %s records scanned=%s", code, model.__tablename__, scanned)
            cursor_time, cursor_id = rows[-1]["occurred_at"], rows[-1]["id"]


def sync_resources(src, db, code):
    if code == "onprem":
        queries = {
            "license": '''SELECT id, 'License / ' || edition AS name, client_id AS center_id, active AS enabled,
                json_build_object('edition',edition,'credits',credits,'services',services,'expiresAt',expires_at) AS details FROM sx_portal.licenses''',
            "workstation": '''SELECT id, name, client_id AS center_id, active AS enabled,
                json_build_object('edition',edition,'lastSeen',last_seen) AS details FROM sx_portal.workstations''',
        }
    else:
        queries = {
            "service": "SELECT id, name, NULL::text AS center_id, enabled, json_build_object('code',code) AS details FROM public.services",
            "user": '''SELECT u.id, u.name, u."clientId" AS center_id, u.active AS enabled,
                json_build_object('role',u.role,'clientKind',c.kind,'clientName',c.name) AS details
                FROM public.users u LEFT JOIN public.clients c ON c.id=u."clientId"''',
            "subscription": '''SELECT cs.id, s.name, cs."clientId" AS center_id, cs.status::text='ACTIVE' AS enabled,
                json_build_object('credits',cs.credits,'usedCredits',cs."usedCredits",'validUntil',cs."validUntil",'workflow',cs."workflowType") AS details
                FROM public.client_services cs JOIN public.services s ON s.id=cs."serviceId"''',
        }
    for kind, sql in queries.items():
        result = src.execution_options(stream_results=True).execute(text(sql))
        for batch in result.mappings().partitions(BATCH):
            rows = [dict(portal_code=code, resource_type=kind, source_id=r["id"], name=r["name"] or r["id"],
                         center_id=r["center_id"], enabled=r["enabled"], details=r["details"]) for r in batch]
            upsert(db, PortalResource, rows, ["portal_code", "resource_type", "source_id"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portal", choices=["marengo", "goyal", "pacs", "onprem"])
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--studies-full", action="store_true",help="Reconcile study reporting/view history without replaying usage and audit logs")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--replace-snapshot", action="store_true", help="Atomically rebuild one portal's derived snapshots after switching its source database")
    args = parser.parse_args()
    if args.replace_snapshot and (not args.portal or args.watch):
        parser.error("--replace-snapshot requires --portal and cannot be used with --watch")
    logging.basicConfig(level=logging.INFO)
    while True:
        for code in ([args.portal] if args.portal else SOURCE_ENV):
            try:
                log.info("%s: %s processing records imported", code, sync_portal(code, args.full,args.studies_full,args.replace_snapshot))
            except Exception as error:
                log.error("%s: sync failed (%s); check source schema and access", code, type(error).__name__)
        if not args.watch:
            break
        time.sleep(60)


if __name__ == "__main__":
    main()
