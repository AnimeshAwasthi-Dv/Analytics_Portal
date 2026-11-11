"""Bounded, parameterized analytics against the central database only."""
import os
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.database import get_db
from app.models import User
from app.command_models import AuditEntry, Center, ControlCommand, Portal, ServiceEvent, TeamRole, UsageFact, UserActivity, PortalResource, StudyFact
from app.permissions import ROLE_PERMISSIONS, is_owner, require, role_for
from app.analysis_filters import family_condition

router = APIRouter(prefix="/api/v1/command", tags=["Central command"])
SOURCE_ENV = {"marengo": "MARENGO_DATABASE_URL", "goyal": "GOYAL_DATABASE_URL", "pacs": "PACS_DATABASE_URL", "onprem": "SOURCE_LICENSE_DATABASE_URL"}
IST = timezone(timedelta(hours=5, minutes=30))


def audit(db, user, action, target, details):
    db.add(AuditEntry(actor_id=user.id, action=action, target=target, details=details))


def date_bounds(start, end):
    today = datetime.now(IST).date()
    end = end or today
    start = start or end - timedelta(days=29)
    if end < start:
        raise HTTPException(422, "The end date must be on or after the start date.")
    return (datetime.combine(start, time.min, IST).astimezone(timezone.utc),
            datetime.combine(end + timedelta(days=1), time.min, IST).astimezone(timezone.utc), start, end)


@router.get("/portals")
def portals(db: Session = Depends(get_db), user=Depends(require("analytics:read"))):
    centers = db.query(Center).order_by(Center.name).limit(2000).all()
    return {"items": [{"code": p.code, "name": p.name, "clientCode": p.client_code, "kind": p.kind,
                       "configured": bool(os.getenv(SOURCE_ENV.get(p.code, ""))) or (p.code == "onprem" and bool(os.getenv("ONPREM_DATABASE_URL"))),
                       "controlConfigured": bool(os.getenv(f"{p.code.upper()}_CONTROL_DATABASE_URL")),
                       "lastSyncedAt": p.last_synced_at, "syncError": p.sync_error,
                       "centers": [{"id": c.source_id, "name": c.name, "clientCode": c.client_code, "status": c.source_status} for c in centers if c.portal_code == p.code]}
                      for p in db.query(Portal).order_by(Portal.code).all()],
            "role": role_for(user, db), "permissions": sorted(ROLE_PERMISSIONS[role_for(user, db)])}


@router.get("/analytics")
def analytics(start: date | None = None, end: date | None = None,
              portal: str | None = Query(None, max_length=50), client: str | None = Query(None, max_length=80),
              center: str | None = Query(None, max_length=160), service: str | None = Query(None, max_length=120),
              db: Session = Depends(get_db), user=Depends(require("analytics:read")),
              modality: Literal["X-Ray", "Special X-Ray", "CT", "MRI", "Mammography", "USG", "PET-CT"] | None = None):
    lower, upper, start, end = date_bounds(start, end)
    e = StudyFact
    filters = [e.occurred_at >= lower, e.occurred_at < upper]
    for column, value in ((e.portal_code, portal), (e.client_code, client), (e.center_id, center), (e.service, service)):
        if value:
            filters.append(column == value)
    if modality:
        filters.append(family_condition(e.service, modality))
    count = func.count()
    success = func.sum(case((e.status == "SUCCESS", 1), else_=0))
    pending = func.sum(case((e.status == "NOT_PROCESSED", 1), else_=0))
    known_view=(e.status=="SUCCESS") & (e.service.in_(["X-Ray","Special X-Ray"])) & (e.view_count>0)
    xray_reported=(e.status=="SUCCESS") & (e.service.in_(["X-Ray","Special X-Ray"]))
    values = (count.label("events"), success.label("success"), pending.label("pending"),
              func.avg(case((e.status=="SUCCESS",e.duration_ms))).label("duration"),
              func.count(case((e.status=="SUCCESS",e.duration_ms))).label("timed"),
              func.sum(case((xray_reported,1),else_=0)).label("xray_studies"),
              func.sum(case((known_view,e.view_count),else_=0)).label("views"),
              func.sum(case((known_view,e.view_count-1),else_=0)).label("additional"),
              func.sum(case((known_view,1),else_=0)).label("known_views"))

    def metrics(row):
        known=int(row.known_views or 0);views=int(row.views or 0);xr=int(row.xray_studies or 0)
        return {"events":int(row.events or 0),"success":int(row.success or 0),"reported":int(row.success or 0),
                "failed":0,"pending":int(row.pending or 0),"notProcessed":int(row.pending or 0),"credits":0,
                "averageDurationMs":round(float(row.duration),1) if row.duration is not None else None,
                "timedEvents":int(row.timed),"meteredEvents":0,"xrayStudies":xr,"xrayViews":views,
                "xrayAdditionalViews":int(row.additional or 0),"xrayKnownViewStudies":known,
                "xrayUnknownViewStudies":xr-known,"averageXrayViews":round(views/known,2) if known else None}

    total = metrics(db.query(*values).filter(*filters).one())

    def groups(column, limit=20):
        rows = db.query(column.label("key"), *values).filter(*filters).group_by(column).order_by(success.desc(), count.desc(), column).limit(limit).all()
        return [{"key": str(r.key) if r.key is not None else "Unattributed", **metrics(r)} for r in rows]

    # Filtering remains on indexed UTC timestamps; timezone conversion is used only for buckets.
    local_time = func.timezone("Asia/Kolkata", e.occurred_at)
    span = (end-start).days+1
    daily_bucket = "day" if span <= 366 else "month" if span <= 3660 else "year"
    day = func.to_char(local_time, "YYYY-MM-DD" if daily_bucket == "day" else "YYYY-MM-01" if daily_bucket == "month" else "YYYY-01-01")
    hour = func.extract("hour", local_time)
    daily = groups(day, None)
    daily.sort(key=lambda r: r["key"])
    hourly = groups(hour, 24)
    hourly.sort(key=lambda r: int(float(r["key"])))
    empty_metric={key:0 for key in total}
    empty_metric.update(averageDurationMs=None,averageXrayViews=None)
    if daily and daily_bucket == "day":
        by_day = {r["key"]: r for r in daily}
        daily = [by_day.get((start + timedelta(days=i)).isoformat(), {"key": (start + timedelta(days=i)).isoformat(), **empty_metric}) for i in range((end-start).days+1)]
    if hourly:
        by_hour = {int(float(r["key"])): r for r in hourly}
        hourly = [by_hour.get(i, {"key": str(i), **empty_metric}) for i in range(24)]
    center_rows = db.query(e.portal_code, e.center_id, Center.name, *values).outerjoin(
        Center, (Center.portal_code == e.portal_code) & (Center.source_id == e.center_id)
    ).filter(*filters).group_by(e.portal_code, e.center_id, Center.name).order_by(success.desc(),count.desc(), e.portal_code, e.center_id).limit(20).all()
    def scope(model, include_service=False):
        conditions = [model.occurred_at >= lower, model.occurred_at < upper]
        for column, value in ((model.portal_code, portal), (model.client_code, client), (model.center_id, center)):
            if value:
                conditions.append(column == value)
        if include_service and service:
            conditions.append(model.service == service)
        if include_service and modality:
            conditions.append(family_condition(model.service, modality))
        return conditions
    usage = db.query(func.count().label("entries"), func.sum(UsageFact.credits).label("credits")).filter(*scope(UsageFact, True)).one()
    usage_services = db.query(UsageFact.service, func.sum(UsageFact.credits).label("credits"), func.count().label("entries")).filter(*scope(UsageFact, True)).group_by(UsageFact.service).order_by(func.sum(UsageFact.credits).desc()).limit(20).all()
    activity = db.query(UserActivity.portal_code, UserActivity.actor_id, UserActivity.actor_name, func.count().label("events")).filter(*scope(UserActivity)).group_by(UserActivity.portal_code, UserActivity.actor_id, UserActivity.actor_name).order_by(func.count().desc(), UserActivity.actor_id).limit(20).all() if not service and not modality else []
    return {"start": start, "end": end, "timezone": "Asia/Kolkata", "totals": total,
            "byPortal": groups(e.portal_code), "byClient": groups(e.client_code), "byService": groups(e.service),
            "byCenter": [{"key": r.center_id or "Unattributed", "portal": r.portal_code, "name": r.name or "Unattributed center", **metrics(r)} for r in center_rows],
            "topUsers": [],
            "unattributedUserEvents": total["reported"], "daily": daily, "dailyBucket": daily_bucket, "hourly": hourly,
            "userActivity": [{"id": r.actor_id, "name": r.actor_name or r.actor_id, "portal": r.portal_code, "events": r.events} for r in activity],
            "usage": {"entries": usage.entries, "credits": int(usage.credits or 0), "byService": [{"service": r.service, "credits": int(r.credits or 0), "entries": r.entries} for r in usage_services]},
            "peakHour": max(hourly, key=lambda r: r["reported"])["key"] if any(r["reported"] for r in hourly) else None,
            "dateBasis":"reported_date_for_usage_received_date_for_unprocessed",
            "note":"One reported study is one successful modality endpoint use, including AI and teleradiology. Available/reporting studies are not processed, never failed images. Reported usage uses report completion date; unprocessed studies use received date. X-ray views use explicit tariff view breakdowns or recorded image counts; unknown counts are excluded from the average. Credits remain independent source debit records. Rankings show the top 20."}


@router.get("/desktop-usage")
def desktop_usage(db: Session = Depends(get_db), user=Depends(require("analytics:read"))):
    rows = db.query(PortalResource).filter_by(portal_code="onprem",resource_type="desktop_license").order_by(PortalResource.name).all()
    return {"items":[{"id":r.source_id,"name":r.name,**r.details} for r in rows],
            "totals":{key:sum(int(r.details.get(key) or 0) for r in rows) for key in ("allotted","remaining","used")},
            "note":"Lifetime X-ray credit consumption is inferred from plan allotment minus credits left, never a reported-study count. Carry-forward or top-ups can affect this estimate. Dated usage records balance decreases observed after tracking began; earlier consumption has no reliable event date. Balances update after the desktop application syncs."}


@router.get("/study-totals")
def study_totals(portal: str | None = None, db: Session = Depends(get_db), user=Depends(require("analytics:read"))):
    query=db.query(StudyFact.service,func.count().label("reported"),func.sum(StudyFact.view_count).label("views")).filter(StudyFact.status=="SUCCESS")
    if portal:
        query=query.filter(StudyFact.portal_code==portal)
    return {"items":[{"modality":r.service,"reported":r.reported,"views":int(r.views or 0)} for r in query.group_by(StudyFact.service).order_by(StudyFact.service)]}


@router.get("/analytics/xray-studies")
def xray_studies(start: date | None = None, end: date | None = None,
                 portal: str | None = Query(None,max_length=50),client: str | None = Query(None,max_length=80),
                 center: str | None = Query(None,max_length=160),service: str | None = Query(None,max_length=120),
                 state: Literal["all","reported","not_processed"]="all",page:int=Query(1,ge=1,le=10000),
                 modality: Literal["X-Ray","Special X-Ray"] | None=None,
                 db:Session=Depends(get_db),user=Depends(require("analytics:read"))):
    lower,upper,_,_=date_bounds(start,end)
    e=StudyFact
    query=db.query(e,Center.name).outerjoin(Center,(Center.portal_code==e.portal_code)&(Center.source_id==e.center_id)).filter(e.service.in_(["X-Ray","Special X-Ray"]),e.occurred_at>=lower,e.occurred_at<upper)
    for column,value in [(e.portal_code,portal),(e.client_code,client),(e.center_id,center),(e.service,service)]:
        if value:
            query=query.filter(column==value)
    if modality:
        query=query.filter(e.service==modality)
    if state!="all":
        query=query.filter(e.status==("SUCCESS" if state=="reported" else "NOT_PROCESSED"))
    total=query.count()
    rows=query.order_by(e.occurred_at.desc(),e.portal_code,e.source_id).offset((page-1)*25).limit(25).all()
    return {"items":[{"id":r.source_id,"sourceReference":r.source_reference,"portal":r.portal_code,"center":name or "Unattributed center",
             "modality":r.service,"status":"Reported" if r.status=="SUCCESS" else "Not processed","workflow":r.workflow,"views":r.view_count,"viewSource":r.view_source,
             "receivedAt":r.received_at,"reportedAt":r.reported_at} for r,name in rows],"total":total,"page":page,"pageSize":25}


class CommandInput(BaseModel):
    action: Literal["center_access", "service_access", "user_access", "subscription_access", "license_access", "workstation_access"]
    targetId: str = Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9_.:-]+$")
    enabled: bool
    reason: str = Field(min_length=8, max_length=500)
    requestKey: str = Field(default_factory=lambda: str(uuid4()), min_length=16, max_length=80)


@router.get("/controls")
def controls(db: Session = Depends(get_db), user=Depends(require("portals:control"))):
    return {"items": [{"id": c.id, "portal": c.portal_code, "action": c.action, "target": c.target_id,
                       "enabled": c.enabled, "reason": c.reason, "status": c.status, "result": c.result,
                       "createdAt": c.created_at} for c in db.query(ControlCommand).order_by(ControlCommand.id.desc()).limit(100)]}


@router.post("/portals/{portal_code}/controls", status_code=201)
def create_command(portal_code: str, data: CommandInput, db: Session = Depends(get_db), user=Depends(require("portals:control"))):
    if len(data.reason.strip()) < 8:
        raise HTTPException(422, "Provide a meaningful operational reason of at least eight characters.")
    p = db.get(Portal, portal_code)
    onprem_actions = {"license_access", "workstation_access"}
    portal_actions = {"center_access", "service_access", "user_access", "subscription_access"}
    if not p or data.action not in (onprem_actions if p.kind == "onprem" else portal_actions):
        raise HTTPException(422, "This portal does not support these controls.")
    if not os.getenv(f"{portal_code.upper()}_CONTROL_DATABASE_URL"):
        raise HTTPException(409, "Connect the portal control database before requesting a change.")
    existing = db.query(ControlCommand).filter_by(request_key=data.requestKey).first()
    if existing:
        if (existing.portal_code, existing.action, existing.target_id, existing.enabled, existing.reason, existing.requested_by) != (portal_code, data.action, data.targetId, data.enabled, data.reason.strip(), user.id):
            raise HTTPException(409, "This request key is already used by a different command.")
        return {"id": existing.id, "status": existing.status}
    if data.action == "center_access" and not db.get(Center, (portal_code, data.targetId)):
        raise HTTPException(404, "Sync this center before controlling its access.")
    if data.action != "center_access" and not db.get(PortalResource, (portal_code, data.action.removesuffix("_access"), data.targetId)):
        raise HTTPException(404, "Sync this resource before controlling its access.")
    c = ControlCommand(portal_code=portal_code, action=data.action, target_id=data.targetId,
                       enabled=data.enabled, reason=data.reason.strip(), requested_by=user.id, request_key=data.requestKey)
    db.add(c)
    audit(db, user, "control.requested", f"{portal_code}/{data.targetId}", {"action": data.action, "enabled": data.enabled, "reason": data.reason.strip()})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Request already submitted; refresh the command history.")
    return {"id": c.id, "status": c.status}


@router.get("/portals/{portal_code}/resources")
def resources(portal_code: str, kind: Literal["service", "user", "subscription", "license", "workstation"] | None = None,
              db: Session = Depends(get_db), user=Depends(require("analytics:read"))):
    query = db.query(PortalResource).filter_by(portal_code=portal_code)
    if kind:
        query = query.filter_by(resource_type=kind)
    rows = query.order_by(PortalResource.resource_type, PortalResource.name).limit(2000).all()
    return {"items": [{"id": r.source_id, "kind": r.resource_type, "name": r.name, "centerId": r.center_id,
                       "enabled": r.enabled, "details": r.details} for r in rows]}


Role = Literal["super_admin", "operations", "analyst", "support", "finance", "viewer"]


class TeamInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    role: Role


class TeamUpdate(BaseModel):
    role: Role
    active: bool


def team_member(u, db):
    return {"id": u.id, "name": u.name, "email": u.email, "active": u.is_active, "role": role_for(u, db), "owner": is_owner(u)}


@router.get("/team")
def team(db: Session = Depends(get_db), user=Depends(require("team:manage"))):
    return {"items": [team_member(u, db) for u in db.query(User).order_by(User.name).limit(500)],
            "roles": {k: sorted(v) for k, v in ROLE_PERMISSIONS.items()}}


@router.post("/team", status_code=201)
def add_member(data: TeamInput, db: Session = Depends(get_db), user=Depends(require("team:manage"))):
    if not data.name.strip():
        raise HTTPException(422, "Name is required.")
    u = User(name=data.name.strip(), email=str(data.email).lower(), hashed_password=hash_password(data.password), is_active=True)
    try:
        db.add(u)
        db.flush()
        db.add(TeamRole(user_id=u.id, role=data.role))
        audit(db, user, "team.created", str(u.id), {"role": data.role})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A team member with that email already exists.")
    return team_member(u, db)


@router.put("/team/{user_id}")
def update_member(user_id: int, data: TeamUpdate, db: Session = Depends(get_db), user=Depends(require("team:manage"))):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "Team member not found.")
    if is_owner(u) or u.id == user.id:
        raise HTTPException(409, "The owner and your own access cannot be changed here.")
    previous = team_member(u, db)
    grant = db.get(TeamRole, u.id) or TeamRole(user_id=u.id)
    grant.role = data.role
    db.add(grant)
    u.is_active = data.active
    audit(db, user, "team.updated", str(u.id), {"before": {"role": previous["role"], "active": previous["active"]}, "after": {"role": data.role, "active": data.active}})
    db.commit()
    return team_member(u, db)


@router.get("/audit")
def audit_entries(page: int = Query(1, ge=1, le=10000), db: Session = Depends(get_db), user=Depends(require("audit:read"))):
    rows = db.query(AuditEntry, User.name).join(User, User.id == AuditEntry.actor_id).order_by(AuditEntry.id.desc()).offset((page-1)*50).limit(50).all()
    return {"page": page, "items": [{"id": a.id, "actor": name, "action": a.action, "target": a.target, "details": a.details, "createdAt": a.created_at} for a, name in rows]}
