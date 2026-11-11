"""Desktop X-ray balance snapshots, separate from clinical study counts."""
from datetime import datetime, timezone
from sqlalchemy import text
from app.command_models import Center, PortalResource, UsageFact


def consumed(allotted, remaining):
    return max(int(allotted or 0) - int(remaining or 0), 0)


def sync_desktop(src, db):
    rows = src.execute(text('''SELECT d.license_id,d.username,d.fullname,d.status,d.credit_left,
        d.credit_available_online,d.last_sync,d.updated_at,d.carried_forward_to,
        p.plan_name,p.credits AS allotted
        FROM ai.license_detail d JOIN ai.license_plans p ON p.plan_id=d.plan_id''')).mappings()
    now = datetime.now(timezone.utc)
    for r in rows:
        identity = "desktop:" + str(r["license_id"])
        prior = db.get(PortalResource, ("onprem", "desktop_license", identity))
        previous = prior.details if prior else {}
        left, allotted = int(r["credit_left"] or 0), int(r["allotted"] or 0)
        # First observation supplies lifetime balance evidence, not a fabricated dated debit.
        delta = max(int(previous.get("remaining", left)) - left, 0)
        if previous.get("allotted") != allotted or r["carried_forward_to"]:
            delta = 0
        if delta:
            db.add(UsageFact(portal_code="onprem", source_id=f"desktop:{r['license_id']}:{now.isoformat()}",
                             client_code=identity, center_id=identity, service="X-Ray desktop credits",
                             credits=delta, success=True, occurred_at=now))
        details = {"allotted":allotted, "remaining":left, "used":consumed(allotted,left),
                   "onlineRemaining":r["credit_available_online"], "plan":r["plan_name"],
                   "lastSync":r["last_sync"].replace(tzinfo=timezone.utc).isoformat() if r["last_sync"] else None,
                   "observedAt":now.isoformat(), "carriedForward":bool(r["carried_forward_to"])}
        name = r["fullname"] or r["username"] or identity
        db.merge(Center(portal_code="onprem",source_id=identity,name=name,client_code=identity,
                        source_status=r["status"],source_code=None))
        db.merge(PortalResource(portal_code="onprem",resource_type="desktop_license",source_id=identity,
                               name=name,center_id=identity,enabled=str(r["status"]).upper()=="ACTIVE",details=details))
