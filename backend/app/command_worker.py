"""Apply queued, audited absolute-state controls: python -m app.command_worker.

Separate *_CONTROL_DATABASE_URL credentials are required. Read-only sync never writes sources.
Commands are idempotent desired states; interrupted commands are safe to retry.
"""
import os
import argparse
import time
from datetime import datetime, timezone
from sqlalchemy import text
from app.database import SessionLocal
from app.command_models import AuditEntry, ControlCommand
from app.command_sync import source_engine
from app.command_api import SOURCE_ENV
from sqlalchemy.engine import make_url
from app.permissions import ROLE_PERMISSIONS, role_for
from app.models import User

STATEMENTS = {
    "center_access": text('UPDATE public.clients SET status = :state, "updatedAt" = NOW() WHERE id = :target RETURNING id'),
    "service_access": text('UPDATE public.services SET enabled = :enabled WHERE id = :target RETURNING id'),
    "user_access": text('UPDATE public.users SET active = :enabled, "updatedAt" = NOW() WHERE id = :target AND role::text <> \'SUPER_ADMIN\' RETURNING id'),
    "subscription_access": text('UPDATE public.client_services SET status = :subscription_state WHERE id = :target RETURNING id'),
    "license_access": text('UPDATE sx_portal.licenses SET active = :enabled WHERE id = :target RETURNING id'),
    "workstation_access": text('UPDATE sx_portal.workstations SET active = :enabled WHERE id = :target RETURNING id'),
}


def same_source_database(code, control_url):
    read_url = (os.getenv("ONPREM_DATABASE_URL") or os.getenv(SOURCE_ENV[code])) if code == "onprem" else os.getenv(SOURCE_ENV[code])
    if not read_url:
        return False
    try:
        read, control = make_url(read_url), make_url(control_url)
    except Exception:
        return False
    return (read.host, read.port or 5432, read.database) == (control.host, control.port or 5432, control.database)


def apply_next():
    with SessionLocal() as db:
        c = db.query(ControlCommand).filter_by(status="pending").order_by(ControlCommand.id).with_for_update(skip_locked=True).first()
        if not c:
            return False
        actor = db.get(User, c.requested_by)
        url = os.getenv(f"{c.portal_code.upper()}_CONTROL_DATABASE_URL")
        if not actor or not actor.is_active or "portals:control" not in ROLE_PERMISSIONS[role_for(actor, db)]:
            c.status, c.result = "failed", "Requester no longer has permission."
        elif not url:
            c.status, c.result = "failed", "Control connection is unavailable."
        elif not same_source_database(c.portal_code, url):
            c.status, c.result = "failed", "Control database must match the configured analytics source."
        else:
            engine = None
            try:
                engine = source_engine(url, readonly=False)
                with engine.begin() as connection:
                    result = connection.execute(STATEMENTS[c.action], {"target": c.target_id, "state": "ACTIVE" if c.enabled else "BLOCKED", "subscription_state": "ACTIVE" if c.enabled else "REVOKED", "enabled": c.enabled}).first()
                    if result is None:
                        raise ValueError("Target no longer exists")
                c.status, c.result = "applied", "Source state updated."
            except Exception as error:
                c.status, c.result = "failed", f"Source rejected change ({type(error).__name__})."
            finally:
                if engine is not None:
                    engine.dispose()
        c.completed_at = datetime.now(timezone.utc)
        db.add(AuditEntry(actor_id=c.requested_by, action=f"control.{c.status}", target=f"{c.portal_code}/{c.target_id}", details={"commandId": c.id, "action": c.action, "enabled": c.enabled, "result": c.result}))
        db.commit()
        return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--watch", action="store_true", help="Poll for new commands every five seconds")
    args = parser.parse_args()
    while True:
        while apply_next():
            pass
        if not args.watch:
            break
        time.sleep(5)
