"""Read-only operational worklists over central snapshots, never source databases."""
from datetime import date, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import false, func, or_
from sqlalchemy.orm import Session

from app.command_api import date_bounds
from app.command_models import Center, PortalResource, ServiceEvent, UserActivity
from app.database import get_db
from app.models import MarengoReportReview, MarengoStudy
from app.permissions import require
from app.source_sync import load_sources
from app.analysis_filters import family_condition

router = APIRouter(prefix="/api/v1/command", tags=["Operations"])


def contains(column, value):
    # Escape LIKE metacharacters so searches treat user input as literal text.
    return column.ilike("%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%", escape="\\")


def utc(value):
    # Legacy Marengo TIMESTAMP columns store UTC without a timezone.
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


@router.get("/inventory")
def inventory(kind: Literal["service", "user", "subscription", "license", "workstation"],
              portal: str | None = Query(None, max_length=50), client: str | None = Query(None, max_length=80),
              center: str | None = Query(None, max_length=160), q: str = Query("", max_length=120),
              state: Literal["all", "enabled", "disabled"] = "all", page: int = Query(1, ge=1, le=10000),
              role: Literal["RADIOLOGIST", "GROUP_ADMIN"] | None = None,
              db: Session = Depends(get_db), user=Depends(require("analytics:read"))):
    r, c = PortalResource, Center
    query = db.query(r, c.name, c.client_code).outerjoin(c, (r.portal_code == c.portal_code) & (r.center_id == c.source_id)).filter(r.resource_type == kind)
    if portal:
        query = query.filter(r.portal_code == portal)
    if role == "RADIOLOGIST":
        query = query.filter(r.details["role"].as_string() == "RADIOLOGIST")
    elif role == "GROUP_ADMIN":
        query = query.filter(r.details["role"].as_string() == "CLIENT_USER", r.details["clientKind"].as_string() == "GROUP")
    if client:
        # Global services have no client owner; never attribute them to every client.
        query = query.filter(c.client_code == client)
    if center:
        query = query.filter(r.center_id == center)
    if q:
        query = query.filter(or_(contains(r.name, q), contains(r.source_id, q)))
    enabled = query.filter(r.enabled.is_(True)).count()
    disabled = query.filter(r.enabled.is_(False)).count()
    if state != "all":
        query = query.filter(r.enabled.is_(state == "enabled"))
    total = query.count()
    rows = query.order_by(r.name, r.portal_code, r.source_id).offset((page - 1) * 25).limit(25).all()
    return {"items": [{"id": item.source_id, "portal": item.portal_code, "kind": item.resource_type,
                       "name": item.name, "centerId": item.center_id, "centerName": name,
                       "client": code, "enabled": item.enabled, "details": item.details} for item, name, code in rows],
            "total": total, "page": page, "pageSize": 25, "counts": {"all": enabled + disabled, "enabled": enabled, "disabled": disabled}}


@router.get("/source-activity")
def source_activity(portal: str = Query(..., min_length=1, max_length=50), start: date | None = None,
                    end: date | None = None, q: str = Query("", max_length=120), page: int = Query(1, ge=1, le=10000),
                    db: Session = Depends(get_db), user=Depends(require("audit:read"))):
    lower, upper, _, _ = date_bounds(start, end)
    a = UserActivity
    query = db.query(a).filter(a.portal_code == portal, a.occurred_at >= lower, a.occurred_at < upper)
    if q:
        query = query.filter(or_(contains(a.action, q), contains(a.actor_name, q), contains(a.actor_id, q)))
    total = query.count()
    rows = query.order_by(a.occurred_at.desc(), a.source_id).offset((page - 1) * 25).limit(25).all()
    return {"items": [{"id": r.source_id, "actor": r.actor_name or r.actor_id, "action": r.action[:1000],
                       "centerId": r.center_id, "occurredAt": utc(r.occurred_at)} for r in rows],
            "total": total, "page": page, "pageSize": 25}


@router.get("/worklist/{kind}")
def worklist(kind: Literal["studies", "processing", "reports"], start: date | None = None, end: date | None = None,
             portal: str | None = Query(None, max_length=50), client: str | None = Query(None, max_length=80),
             center: str | None = Query(None, max_length=160), q: str = Query("", max_length=120),
             state: str = Query("ALL", max_length=30), service: str | None = Query(None, max_length=120),
             modality: Literal["X-Ray", "Special X-Ray", "CT", "MRI", "Mammography", "USG", "PET-CT"] | None = None,
             page: int = Query(1, ge=1, le=10000), db: Session = Depends(get_db), user=Depends(require("analytics:read"))):
    allowed = {"ALL", "PENDING", "IN_REVIEW", "SAVED", "APPROVED", "PUSHED", "FAILED"} if kind == "reports" else {"ALL", "QUEUED", "PROCESSING", "SUCCESS", "FAILED"}
    if state not in allowed:
        raise HTTPException(422, "Choose a status supported by this worklist.")
    lower, upper, _, _ = date_bounds(start, end)
    counts = {}
    items = []
    if kind == "processing":
        e, c = ServiceEvent, Center
        query = db.query(e, c.name).outerjoin(c, (e.portal_code == c.portal_code) & (e.center_id == c.source_id)).filter(e.occurred_at >= lower, e.occurred_at < upper)
        for column, value in ((e.portal_code, portal), (e.client_code, client), (e.center_id, center), (e.service, service)):
            if value:
                query = query.filter(column == value)
        if q:
            query = query.filter(or_(contains(e.source_id, q), contains(e.service, q)))
        if modality:
            query = query.filter(family_condition(e.service, modality))
        counts = dict(query.with_entities(e.status, func.count()).group_by(e.status).all())
        if state != "ALL":
            query = query.filter(e.status == state)
        total = query.count()
        for row, name in query.order_by(e.occurred_at.desc(), e.portal_code, e.source_id).offset((page-1)*25).limit(25):
            items.append({"id": row.source_id, "portal": row.portal_code, "centerId": row.center_id, "centerName": name,
                          "service": row.service, "status": row.status, "createdAt": utc(row.occurred_at),
                          "updatedAt": utc(row.updated_at), "durationMs": row.duration_ms, "credits": row.credits})
        coverage = "Synced processing jobs; one row per job, not per study. On-prem offline processing requires application telemetry."
    else:
        # Clinical snapshots currently exist only for the verified Marengo adapter.
        # Resolve configured instance codes instead of assuming a hard-coded instance name.
        codes = [s.instance_code for s in load_sources(allow_empty=True) if s.profile == "marengo"]
        s, c = MarengoStudy, Center
        model = s if kind == "studies" else MarengoReportReview
        query = db.query(model, c.name, c.source_id).select_from(model)
        if kind == "reports":
            query = query.outerjoin(s, (model.instance_code == s.instance_code) & (model.study_id == s.id))
        query = query.outerjoin(c, (c.portal_code == "marengo") & (c.source_id == s.centre_id))
        query = query.filter(model.instance_code.in_(codes), model.created_at >= lower.replace(tzinfo=None), model.created_at < upper.replace(tzinfo=None))
        if portal and portal != "marengo":
            query = query.filter(false())
        if client:
            query = query.filter(c.client_code == client)
        if center:
            query = query.filter(s.centre_id == center)
        if service:
            query = query.filter((s.study_description if kind == "studies" else model.service_name) == service)
        if q:
            query = query.filter(contains(model.id, q))
        if modality:
            query = query.filter(family_condition(model.modality, modality))
        counts = dict(query.with_entities(model.status, func.count()).group_by(model.status).all())
        if state != "ALL":
            query = query.filter(model.status == state)
        total = query.count()
        for row, name, center_id in query.order_by(model.created_at.desc(), model.instance_code, model.id).offset((page-1)*25).limit(25):
            items.append({"id": row.id, "portal": "marengo", "centerId": center_id, "centerName": name,
                          "service": row.study_description if kind == "studies" else row.service_name,
                          "modality": row.modality, "status": row.status, "createdAt": utc(row.created_at),
                          "updatedAt": utc(row.processing_completed_at if kind == "studies" else row.updated_at),
                          "outputFormat": row.output_format if kind == "reports" else None})
        coverage = "Marengo clinical snapshots only. Other portals' clinical worklists are not connected. Patient records, report content and clinical actions remain in the source portal."
    return {"items": items, "total": total, "page": page, "pageSize": 25,
            "counts": {"ALL": sum(counts.values()), **counts}, "coverage": coverage, "timezone": "Asia/Kolkata"}
