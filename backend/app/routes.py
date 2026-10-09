import logging
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import case, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from app.auth_api import verify_api_key

from app.database import get_db
from app.models import (
    User,
    SyncRecord,
    SyncLog,
    ApiKey,
    Instance,
    ModalityOption,
    TrafficLog
)
from app.schemas import (
    LoginRequest,
    UserResponse,
    SyncPayload
)
from app.auth import (
    verify_password,
    create_access_token,
    get_current_user,
    COOKIE_SECURE,
    TOKEN_EXPIRATION,
)


router = APIRouter()
logger = logging.getLogger(__name__)


def serialize_sync_record(record: SyncRecord):
    return {
        "id": record.id,
        "instanceCode": record.instance_code,
        "modality": record.modality,
        "studyDescription": record.study_description,
        "processingCreatedAt": (
            record.processing_created_at.isoformat()
            if record.processing_created_at
            else None
        ),
        "processingCompletedAt": (
            record.processing_completed_at.isoformat()
            if record.processing_completed_at
            else None
        ),
        "creditsUsed": record.credits_used or 0,
        "syncStatus": record.sync_status,
        "syncedAt": record.synced_at.isoformat() if record.synced_at else None,
    }


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)




# ============================================================
# AUTHENTICATION
# ============================================================

@router.post("/auth/login")
def login(
    data: LoginRequest,
    db: Session = Depends(get_db)
):

    # 1. Sanitize and normalize email input
    email = data.email.strip().lower()

    # 2. Validate input
    if not email or not data.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and password are required"
        )

    # 3. Find user
    user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )

    # 4. Verify credentials
    if not user or not verify_password(
        data.password,
        user.hashed_password
    ) or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    # 5. Generate JWT token
    token = create_access_token({
        "sub": user.email
    })

    # 6. Return response
    response = JSONResponse({
        "message": "Login successful",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email
        }
    })

    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=TOKEN_EXPIRATION * 60
    )

    return response


@router.post("/auth/logout")
def logout():

    response = JSONResponse({
        "message": "Logged out successfully"
    })

    response.delete_cookie("access_token")

    return response


@router.get(
    "/auth/me",
    response_model=UserResponse
)
def get_profile(
    current_user: User = Depends(get_current_user)
):
    return current_user


# ============================================================
# DASHBOARD
# ============================================================

# ============================================================
# DASHBOARD
# ============================================================
@router.get("/api/v1/dashboard")
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Get all registered API keys / instances
    api_keys = db.query(ApiKey.key_name).all()

    record_stats = {}
    modalities_by_instance = {}
    modality_names = set()

    record_rows = (
        db.query(
            SyncRecord.instance_code,
            SyncRecord.modality,
            func.sum(
                case((SyncRecord.sync_status == "SYNCED", 1), else_=0)
            ),
            func.max(
                case(
                    (SyncRecord.sync_status == "SYNCED", SyncRecord.synced_at),
                    else_=None,
                )
            ),
            func.coalesce(
                func.sum(
                    case(
                        (SyncRecord.sync_status == "SYNCED", SyncRecord.credits_used),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .group_by(SyncRecord.instance_code, SyncRecord.modality)
        .all()
    )

    for instance_code, modality, records_synced, last_sync, credits in record_rows:
        previous_records, previous_last_sync, previous_credits = record_stats.get(
            instance_code, (0, None, 0)
        )
        record_stats[instance_code] = (
            previous_records + (records_synced or 0),
            max(
                (
                    timestamp
                    for timestamp in (previous_last_sync, last_sync)
                    if timestamp
                ),
                default=None,
            ),
            previous_credits + (credits or 0),
        )
        if modality:
            modalities_by_instance.setdefault(instance_code, []).append(modality)
            modality_names.add(modality)

    heartbeat_rows = (
        db.query(Instance.identifier, Instance.last_seen_at)
        .filter(Instance.identifier.in_([name for (name,) in api_keys]))
        .all()
    )
    heartbeat_by_instance = {
        identifier: last_seen_at
        for identifier, last_seen_at in heartbeat_rows
        if last_seen_at is not None
    }

    log_stats = {
        instance_code: (successful_syncs or 0, failed_syncs or 0)
        for instance_code, successful_syncs, failed_syncs in db.query(
            SyncLog.instance_code,
            func.sum(case((SyncLog.status == "SUCCESS", 1), else_=0)),
            func.sum(case((SyncLog.status == "FAILED", 1), else_=0)),
        )
        .filter(SyncLog.event_type == "SYNC")
        .group_by(SyncLog.instance_code)
        .all()
    }

    instances = []

    for (instance_code,) in api_keys:
        successful_syncs, failed_syncs = log_stats.get(instance_code, (0, 0))

        total_attempts = successful_syncs + failed_syncs

        success_rate = (
            round(
                (successful_syncs / total_attempts) * 100,
                1,
            )
            if total_attempts > 0
            else 0
        )

        records_synced, last_sync, _ = record_stats.get(
            instance_code, (0, None, 0)
        )

        # Fall back to sync activity until an instance has reported a heartbeat.
        status = "Offline"
        last_activity = heartbeat_by_instance.get(instance_code, last_sync)

        if last_activity:
            age_seconds = (
                datetime.now(timezone.utc) - as_utc(last_activity)
            ).total_seconds()

            if age_seconds <= 300:
                status = "Online"
            elif age_seconds <= 900:
                status = "Delayed"

        instances.append(
            {
                "id": instance_code,
                "name": instance_code,
                "status": status,
                "lastSyncTime": (
                    last_sync.strftime("%Y-%m-%d %H:%M:%S")
                    if last_sync
                    else None
                ),
                "recordsSynced": records_synced,
                "successRate": success_rate,
                "failedSyncs": failed_syncs,
                "modalities": sorted(modalities_by_instance.get(instance_code, [])),
            }
        )

    # Overall statistics
    total_instances = len(instances)

    online_instances = sum(
        1
        for instance in instances
        if instance["status"] == "Online"
    )

    total_records_synced = sum(stats[0] for stats in record_stats.values())

    total_failed_syncs = sum(
        instance["failedSyncs"]
        for instance in instances
    )

    total_credits = sum(stats[2] for stats in record_stats.values())

    modality_count = len(modality_names)

    recent_records = (
        db.query(SyncRecord)
        .order_by(SyncRecord.synced_at.desc(), SyncRecord.id.desc())
        .limit(50)
        .all()
    )

    return {
        "kpis": {
            "totalInstances": total_instances,
            "onlineInstances": online_instances,
            "recordsSynced": total_records_synced,
            "failedSyncs": total_failed_syncs,
            "totalCredits": total_credits,
            "modalityCount": modality_count,
        },
        "instances": instances,
        "recentRecords": [serialize_sync_record(record) for record in recent_records],
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/api/v1/analytics")
def get_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    modality_rows = (
        db.query(
            SyncRecord.modality,
            func.count(SyncRecord.id),
            func.coalesce(func.sum(SyncRecord.credits_used), 0),
        )
        .group_by(SyncRecord.modality)
        .all()
    )

    trend_start = datetime.now(timezone.utc) - timedelta(days=365)
    daily_rows = (
        db.query(
            func.date(SyncRecord.processing_created_at),
            SyncRecord.instance_code,
            SyncRecord.modality,
            func.count(SyncRecord.id),
            func.coalesce(func.sum(SyncRecord.credits_used), 0),
        )
        .filter(
            SyncRecord.processing_created_at.is_not(None),
            SyncRecord.processing_created_at >= trend_start,
        )
        .group_by(
            func.date(SyncRecord.processing_created_at),
            SyncRecord.instance_code,
            SyncRecord.modality,
        )
        .order_by(func.date(SyncRecord.processing_created_at))
        .all()
    )

    instance_rows = (
        db.query(
            SyncRecord.instance_code,
            SyncRecord.modality,
            func.count(SyncRecord.id),
            func.coalesce(func.sum(SyncRecord.credits_used), 0),
        )
        .group_by(SyncRecord.instance_code, SyncRecord.modality)
        .order_by(SyncRecord.instance_code)
        .all()
    )

    total_records = sum(records for _modality, records, _credits in modality_rows)
    total_credits = sum(credits for _modality, _records, credits in modality_rows)
    source_instances = len(
        {
            instance_code
            for instance_code, _modality, _records, _credits in instance_rows
            if instance_code is not None
        }
    )

    configured_modalities = (
        db.query(ModalityOption.name)
        .filter(ModalityOption.is_active.is_(True))
        .all()
    )
    modality_names = {
        modality.strip().upper(): modality.strip()
        for modality, _records, _credits in modality_rows
        if modality and modality.strip()
    }
    modality_names.update({
        name.strip().upper(): name.strip()
        for (name,) in configured_modalities
        if name and name.strip()
    })

    return {
        "summary": {
            "totalRecords": total_records,
            "totalCredits": total_credits,
            "totalModalities": len(modality_rows),
            "sourceInstances": source_instances,
        },
        "byModality": [
            {
                "modality": modality or "Not specified",
                "records": records,
                "credits": credits,
            }
            for modality, records, credits in modality_rows
        ],
        "availableModalities": sorted(
            modality_names.values(), key=str.casefold
        ),
        "daily": [
            {
                "date": day.isoformat() if hasattr(day, "isoformat") else str(day),
                "instanceCode": instance_code,
                "modality": modality or "Not specified",
                "records": records,
                "credits": credits,
            }
            for day, instance_code, modality, records, credits in daily_rows
            if day is not None
        ],
        "byInstance": [
            {
                "instanceCode": instance_code,
                "modality": modality or "Not specified",
                "records": records,
                "credits": credits,
            }
            for instance_code, modality, records, credits in instance_rows
        ],
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }


def traffic_date_bounds(
    period: str,
    start_date: date | None,
    end_date: date | None,
) -> tuple[datetime, datetime]:
    today = datetime.now(timezone.utc).date()
    if period == "today":
        first_day = today
        last_day = today
    elif period == "yesterday":
        first_day = today - timedelta(days=1)
        last_day = first_day
    elif period == "7d":
        first_day = today - timedelta(days=6)
        last_day = today
    elif period == "30d":
        first_day = today - timedelta(days=29)
        last_day = today
    elif period == "custom":
        if start_date is None or end_date is None:
            raise HTTPException(
                status_code=400,
                detail="start_date and end_date are required for custom ranges",
            )
        first_day = start_date
        last_day = end_date
    else:
        raise HTTPException(
            status_code=400,
            detail="period must be today, yesterday, 7d, 30d, or custom",
        )

    if last_day < first_day:
        raise HTTPException(
            status_code=400,
            detail="end_date must be on or after start_date",
        )

    return (
        datetime.combine(first_day, time.min, tzinfo=timezone.utc),
        datetime.combine(last_day + timedelta(days=1), time.min, tzinfo=timezone.utc),
    )


def traffic_filtered_query(
    db: Session,
    start: datetime,
    end: datetime,
):
    return db.query(TrafficLog).filter(
        TrafficLog.timestamp >= start,
        TrafficLog.timestamp < end,
    )


def traffic_total_bytes():
    return (
        func.coalesce(TrafficLog.request_size, 0)
        + func.coalesce(TrafficLog.response_size, 0)
    )


def traffic_success_rate():
    return (
        100.0
        * func.sum(case((TrafficLog.is_success, 1), else_=0))
        / func.count(TrafficLog.id)
    )


@router.get("/api/v1/analytics/traffic/summary")
def get_traffic_summary(
    period: str = "30d",
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start, end = traffic_date_bounds(period, start_date, end_date)
    day_expression = func.date(func.timezone("UTC", TrafficLog.timestamp))
    rows = (
        db.query(
            day_expression.label("day"),
            TrafficLog.instance_id.label("traffic_instance_id"),
            func.coalesce(Instance.identifier, "Unknown").label("instance"),
            func.coalesce(Instance.name, Instance.identifier, "Unknown").label(
                "instance_name"
            ),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
            func.coalesce(func.sum(TrafficLog.processing_time), 0).label(
                "processing_seconds"
            ),
            func.sum(case((TrafficLog.is_success, 1), else_=0)).label("successes"),
        )
        .join(Instance, Instance.id == TrafficLog.instance_id)
        .filter(
            TrafficLog.timestamp >= start,
            TrafficLog.timestamp < end,
            TrafficLog.instance_id.is_not(None),
        )
        .group_by(
            day_expression,
            TrafficLog.instance_id,
            Instance.identifier,
            Instance.name,
        )
        .order_by(day_expression, Instance.identifier)
        .all()
    )

    recent_request_rows = (
        db.query(
            TrafficLog.timestamp,
            Instance.name.label("instance_name"),
            Instance.identifier.label("instance_identifier"),
            TrafficLog.method,
            TrafficLog.route,
            TrafficLog.status_code,
            TrafficLog.request_size,
            TrafficLog.response_size,
        )
        .join(Instance, Instance.id == TrafficLog.instance_id)
        .filter(TrafficLog.timestamp >= start, TrafficLog.timestamp < end)
        .order_by(TrafficLog.timestamp.desc(), TrafficLog.id.desc())
        .limit(50)
        .all()
    )

    daily_totals: dict[str, dict[str, int]] = {}
    instance_totals: dict[str, dict[str, int | float | str]] = {}
    for row in rows:
        day = row.day.isoformat() if hasattr(row.day, "isoformat") else str(row.day)
        daily = daily_totals.setdefault(day, {"requests": 0, "totalDataBytes": 0})
        daily["requests"] += int(row.requests or 0)
        daily["totalDataBytes"] += int(row.data_bytes or 0)

        instance = instance_totals.setdefault(
            row.instance,
            {
                "instance": row.instance,
                "name": row.instance_name,
                "requests": 0,
                "totalDataBytes": 0,
                "processingSeconds": 0.0,
                "successfulRequests": 0,
            },
        )
        instance["requests"] += int(row.requests or 0)
        instance["totalDataBytes"] += int(row.data_bytes or 0)
        instance["processingSeconds"] += float(row.processing_seconds or 0)
        instance["successfulRequests"] += int(row.successes or 0)

    instances = []
    for instance in instance_totals.values():
        requests = int(instance["requests"])
        instances.append(
            {
                "instance": instance["instance"],
                "name": instance["name"],
                "requests": requests,
                "totalDataBytes": int(instance["totalDataBytes"]),
                "averageResponseTimeMs": round(
                    float(instance["processingSeconds"]) * 1000 / requests, 2
                )
                if requests
                else 0,
                "successRate": round(
                    float(instance["successfulRequests"]) * 100 / requests, 1
                )
                if requests
                else 0,
            }
        )
    instances.sort(key=lambda item: (-item["totalDataBytes"], item["name"].casefold()))

    highest = max(instances, key=lambda item: item["totalDataBytes"], default=None)
    return {
        "period": period,
        "startDate": start.date().isoformat(),
        "endDate": (end.date() - timedelta(days=1)).isoformat(),
        "overview": {
            "totalRequests": sum(item["requests"] for item in daily_totals.values()),
            "totalDataBytes": sum(
                item["totalDataBytes"] for item in daily_totals.values()
            ),
            "activeInstances": len(instances),
            "highestTrafficInstance": (
                {
                    "name": highest["name"],
                    "requests": highest["requests"],
                    "totalDataBytes": highest["totalDataBytes"],
                }
                if highest
                else None
            ),
        },
        "daily": [
            {"date": day, **totals}
            for day, totals in sorted(daily_totals.items())
        ],
        "dailyByInstance": [
            {
                "date": (
                    row.day.isoformat()
                    if hasattr(row.day, "isoformat")
                    else str(row.day)
                ),
                "instance": row.instance,
                "requests": int(row.requests or 0),
                "totalDataBytes": int(row.data_bytes or 0),
            }
            for row in rows
        ],
        "recentRequests": [
            {
                "timestamp": row.timestamp.isoformat(),
                "instance": row.instance_identifier,
                "instanceName": row.instance_name or row.instance_identifier,
                "method": row.method,
                "route": row.route,
                "statusCode": row.status_code,
                "totalDataBytes": int(row.request_size or 0) + int(row.response_size or 0),
            }
            for row in recent_request_rows
        ],
        "instances": instances,
    }


@router.get("/api/v1/analytics/traffic/overview")
def get_traffic_overview(
    period: str = "30d",
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start, end = traffic_date_bounds(period, start_date, end_date)
    filtered = traffic_filtered_query(db, start, end)
    total_requests = filtered.with_entities(func.count(TrafficLog.id)).scalar() or 0
    total_data_bytes = filtered.with_entities(
        func.coalesce(func.sum(traffic_total_bytes()), 0)
    ).scalar() or 0
    active_instances = (
        filtered.with_entities(func.count(func.distinct(TrafficLog.instance_id)))
        .filter(TrafficLog.instance_id.is_not(None))
        .scalar()
        or 0
    )
    instance_rows = (
        db.query(
            Instance.id.label("id"),
            func.coalesce(Instance.name, "Unknown").label("name"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
        )
        .outerjoin(Instance, Instance.id == TrafficLog.instance_id)
        .filter(TrafficLog.timestamp >= start, TrafficLog.timestamp < end)
        .group_by(Instance.id, Instance.name)
        .all()
    )
    highest = max(instance_rows, key=lambda row: row.data_bytes, default=None)
    lowest = min(instance_rows, key=lambda row: row.data_bytes, default=None)

    def serialize_instance(row):
        if row is None:
            return None
        return {
            "name": row.name,
            "requests": row.requests,
            "totalDataBytes": int(row.data_bytes or 0),
        }

    return {
        "period": period,
        "startDate": start.date().isoformat(),
        "endDate": (end.date() - timedelta(days=1)).isoformat(),
        "totalRequests": total_requests,
        "totalDataBytes": int(total_data_bytes),
        "activeInstances": active_instances,
        "highestTrafficInstance": serialize_instance(highest),
        "lowestTrafficInstance": serialize_instance(lowest),
    }


@router.get("/api/v1/analytics/traffic/daily")
def get_traffic_daily(
    period: str = "30d",
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start, end = traffic_date_bounds(period, start_date, end_date)
    day_expression = func.date(func.timezone("UTC", TrafficLog.timestamp))
    rows = (
        db.query(
            day_expression.label("day"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
        )
        .filter(TrafficLog.timestamp >= start, TrafficLog.timestamp < end)
        .group_by(day_expression)
        .order_by(day_expression)
        .all()
    )
    return {
        "period": period,
        "items": [
            {
                "date": (
                    row.day.isoformat()
                    if hasattr(row.day, "isoformat")
                    else str(row.day)
                ),
                "requests": row.requests,
                "totalDataBytes": int(row.data_bytes or 0),
            }
            for row in rows
        ],
    }


@router.get("/api/v1/analytics/traffic/instances")
def get_traffic_instances(
    period: str = "30d",
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start, end = traffic_date_bounds(period, start_date, end_date)
    rows = (
        db.query(
            Instance.id.label("id"),
            func.coalesce(Instance.name, "Unknown").label("name"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
            func.avg(TrafficLog.processing_time).label("avg_seconds"),
            traffic_success_rate().label("success_rate"),
        )
        .outerjoin(Instance, Instance.id == TrafficLog.instance_id)
        .filter(TrafficLog.timestamp >= start, TrafficLog.timestamp < end)
        .group_by(Instance.id, Instance.name)
        .order_by(func.count(TrafficLog.id).desc())
        .all()
    )
    return {
        "period": period,
        "items": [
            {
                "instance": row.name,
                "requests": row.requests,
                "totalDataBytes": int(row.data_bytes or 0),
                "averageResponseTimeMs": round(float(row.avg_seconds or 0) * 1000, 2),
                "successRate": round(float(row.success_rate or 0), 1),
            }
            for row in rows
        ],
    }


@router.get("/api/v1/analytics/traffic/routes")
def get_traffic_routes(
    period: str = "30d",
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start, end = traffic_date_bounds(period, start_date, end_date)
    rows = (
        db.query(
            TrafficLog.route.label("route"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
            func.avg(TrafficLog.processing_time).label("avg_seconds"),
            traffic_success_rate().label("success_rate"),
        )
        .filter(TrafficLog.timestamp >= start, TrafficLog.timestamp < end)
        .group_by(TrafficLog.route)
        .order_by(func.sum(traffic_total_bytes()).desc())
        .all()
    )
    items = [
        {
            "route": row.route,
            "requests": row.requests,
            "totalDataBytes": int(row.data_bytes or 0),
            "averageResponseTimeMs": round(float(row.avg_seconds or 0) * 1000, 2),
            "successRate": round(float(row.success_rate or 0), 1),
        }
        for row in rows
    ]
    return {
        "period": period,
        "items": items,
        "highestTrafficRoute": max(
            items, key=lambda item: item["totalDataBytes"], default=None
        ),
        "lowestTrafficRoute": min(
            items, key=lambda item: item["totalDataBytes"], default=None
        ),
        "mostRequestsRoute": max(
            items, key=lambda item: item["requests"], default=None
        ),
        "fewestRequestsRoute": min(
            items, key=lambda item: item["requests"], default=None
        ),
    }


@router.get("/api/v1/analytics/traffic/details")
def get_traffic_details(
    period: str = "30d",
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    start, end = traffic_date_bounds(period, start_date, end_date)
    rows = (
        db.query(
            Instance.id.label("id"),
            func.coalesce(Instance.name, "Unknown").label("instance"),
            TrafficLog.route.label("route"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
            func.avg(TrafficLog.processing_time).label("avg_seconds"),
            traffic_success_rate().label("success_rate"),
        )
        .outerjoin(Instance, Instance.id == TrafficLog.instance_id)
        .filter(TrafficLog.timestamp >= start, TrafficLog.timestamp < end)
        .group_by(Instance.id, Instance.name, TrafficLog.route)
        .order_by(func.sum(traffic_total_bytes()).desc())
        .limit(500)
        .all()
    )
    return {
        "period": period,
        "items": [
            {
                "instance": row.instance,
                "route": row.route,
                "requests": row.requests,
                "totalDataBytes": int(row.data_bytes or 0),
                "averageResponseTimeMs": round(float(row.avg_seconds or 0) * 1000, 2),
                "successRate": round(float(row.success_rate or 0), 1),
            }
            for row in rows
        ],
    }


@router.get("/api/v1/analytics/instances")
def list_traffic_instances(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    instances = db.query(Instance).order_by(Instance.name).all()
    return {
        "items": [
            {
                "id": instance.id,
                "name": instance.name,
                "identifier": instance.identifier,
                "status": instance.status,
            }
            for instance in instances
        ]
    }

# ============================================================
# CENTRAL SYNC API
# ============================================================

@router.post("/api/v1/sync")
def receive_sync(
    data: SyncPayload,
    db: Session = Depends(get_db),
    authenticated_key: ApiKey = Depends(verify_api_key)
):
    # API key identifies the source instance
    instance_code = authenticated_key.key_name

    last_record = None

    try:
        for _ in range(data.credits_used):
            record = SyncRecord(
                instance_code=instance_code,
                modality=data.modality,
                study_description=data.study_description,
                processing_created_at=data.processing_created_at,
                processing_completed_at=data.processing_completed_at,
                credits_used=1,
                sync_status="SYNCED"
            )

            db.add(record)
            last_record = record

        log = SyncLog(
            instance_code=instance_code,
            event_type="SYNC",
            status="SUCCESS",
            message="Data received successfully"
        )

        db.add(log)
        db.commit()

        return {
            "success": True,
            "message": "Data synchronized successfully",
            "instance_code": instance_code,
            "record_id": last_record.id if last_record else None
        }

    except SQLAlchemyError as error:
        db.rollback()

        failed_log = SyncLog(
            instance_code=instance_code,
            event_type="SYNC",
            status="FAILED",
            message="Failed to store synchronization data"
        )

        try:
            db.add(failed_log)
            db.commit()
        except SQLAlchemyError:
            db.rollback()
            logger.exception("Unable to persist failed synchronization log")

        raise HTTPException(
            status_code=500,
            detail="Failed to synchronize data"
        ) from error

    
# ============================================================
# HEARTBEAT API
# ============================================================


@router.post("/api/v1/heartbeat")
def heartbeat(
    db: Session = Depends(get_db),
    authenticated_key: ApiKey = Depends(verify_api_key),
):
    instance = (
        db.query(Instance)
        .filter(Instance.identifier == authenticated_key.key_name)
        .first()
    )
    if instance is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key is not associated with an instance",
        )

    instance.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    return {
        "success": True,
        "message": "Heartbeat received"
    }
