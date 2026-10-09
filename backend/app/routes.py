from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import case, func
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
    get_current_user
)


router = APIRouter()


def serialize_sync_record(record: SyncRecord):
    return {
        "id": record.id,
        "instanceCode": record.instance_code,
        "modality": record.modality,
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
    ):
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
        secure=False,       # True in production with HTTPS
        samesite="lax",
        max_age=3600
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
    api_keys = db.query(ApiKey).all()

    # Get all sync records
    sync_records = db.query(SyncRecord).all()

    # Get all sync logs
    sync_logs = db.query(SyncLog).all()

    instances = []

    for api_key in api_keys:
        instance_code = api_key.key_name

        instance_records = [
            record
            for record in sync_records
            if record.instance_code == instance_code
        ]

        instance_logs = [
            log
            for log in sync_logs
            if log.instance_code == instance_code
            and log.event_type == "SYNC"
        ]

        successful_syncs = sum(
            1
            for log in instance_logs
            if log.status == "SUCCESS"
        )

        failed_syncs = sum(
            1
            for log in instance_logs
            if log.status == "FAILED"
        )

        total_attempts = successful_syncs + failed_syncs

        success_rate = (
            round(
                (successful_syncs / total_attempts) * 100,
                1,
            )
            if total_attempts > 0
            else 0
        )

        synced_records = [
            record
            for record in instance_records
            if record.sync_status == "SYNCED"
        ]

        last_sync = None

        if synced_records:
            timestamps = [
                record.synced_at
                for record in synced_records
                if record.synced_at is not None
            ]

            if timestamps:
                last_sync = max(timestamps)

        # Determine status from recent sync activity
        status = "Offline"

        if last_sync:
            last_sync_naive = (
                last_sync.replace(tzinfo=None)
                if last_sync.tzinfo
                else last_sync
            )

            age_seconds = (
                datetime.utcnow() - last_sync_naive
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
                "recordsSynced": len(synced_records),
                "successRate": success_rate,
                "failedSyncs": failed_syncs,
                "modalities": sorted({
                    record.modality
                    for record in instance_records
                    if record.modality
                }),
            }
        )

    # Overall statistics
    total_instances = len(instances)

    online_instances = sum(
        1
        for instance in instances
        if instance["status"] == "Online"
    )

    total_records_synced = sum(
        1
        for record in sync_records
        if record.sync_status == "SYNCED"
    )

    total_failed_syncs = sum(
        instance["failedSyncs"]
        for instance in instances
    )

    total_credits = sum(
        record.credits_used or 0
        for record in sync_records
        if record.sync_status == "SYNCED"
    )

    modality_count = len({
        record.modality
        for record in sync_records
        if record.modality
    })

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
        "lastUpdated": datetime.utcnow().isoformat(),
    }


@router.get("/api/v1/analytics")
def get_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    total_records = db.query(func.count(SyncRecord.id)).scalar() or 0
    total_credits = db.query(
        func.coalesce(func.sum(SyncRecord.credits_used), 0)
    ).scalar() or 0

    modality_rows = (
        db.query(
            SyncRecord.modality,
            func.count(SyncRecord.id),
            func.coalesce(func.sum(SyncRecord.credits_used), 0),
        )
        .group_by(SyncRecord.modality)
        .all()
    )

    daily_rows = (
        db.query(
            func.date(SyncRecord.processing_created_at),
            SyncRecord.modality,
            func.count(SyncRecord.id),
            func.coalesce(func.sum(SyncRecord.credits_used), 0),
        )
        .filter(SyncRecord.processing_created_at.is_not(None))
        .group_by(
            func.date(SyncRecord.processing_created_at),
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

    source_instances = db.query(
        func.count(func.distinct(SyncRecord.instance_code))
    ).scalar() or 0
    configured_modalities = (
        db.query(ModalityOption.name)
        .filter(ModalityOption.is_active.is_(True))
        .all()
    )
    observed_modalities = (
        db.query(SyncRecord.modality)
        .filter(SyncRecord.modality.is_not(None))
        .distinct()
        .all()
    )
    modality_names = {
        modality.strip().upper(): modality.strip()
        for (modality,) in observed_modalities
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
                "modality": modality or "Not specified",
                "records": records,
                "credits": credits,
            }
            for day, modality, records, credits in daily_rows
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
        "lastUpdated": datetime.utcnow().isoformat(),
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
            func.coalesce(Instance.name, "Unknown").label("name"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
        )
        .outerjoin(Instance, Instance.id == TrafficLog.instance_id)
        .filter(TrafficLog.timestamp >= start, TrafficLog.timestamp < end)
        .group_by(Instance.name)
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
                "date": row.day.isoformat(),
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
            func.coalesce(Instance.name, "Unknown").label("name"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
            func.avg(TrafficLog.processing_time).label("avg_seconds"),
            traffic_success_rate().label("success_rate"),
        )
        .outerjoin(Instance, Instance.id == TrafficLog.instance_id)
        .filter(TrafficLog.timestamp >= start, TrafficLog.timestamp < end)
        .group_by(Instance.name)
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
            func.coalesce(Instance.name, "Unknown").label("instance"),
            TrafficLog.route.label("route"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
            func.avg(TrafficLog.processing_time).label("avg_seconds"),
            traffic_success_rate().label("success_rate"),
        )
        .outerjoin(Instance, Instance.id == TrafficLog.instance_id)
        .filter(TrafficLog.timestamp >= start, TrafficLog.timestamp < end)
        .group_by(Instance.name, TrafficLog.route)
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

        if last_record:
            db.refresh(last_record)

        return {
            "success": True,
            "message": "Data synchronized successfully",
            "instance_code": instance_code,
            "record_id": last_record.id if last_record else None
        }

    except Exception:
        db.rollback()

        failed_log = SyncLog(
            instance_code=instance_code,
            event_type="SYNC",
            status="FAILED",
            message="Failed to store synchronization data"
        )

        db.add(failed_log)
        db.commit()

        raise HTTPException(
            status_code=500,
            detail="Failed to synchronize data"
        )

    
# ============================================================
# HEARTBEAT API
# ============================================================


# need changes in the script so wait 
@router.post("/api/v1/heartbeat")
def heartbeat(
    db: Session = Depends(get_db)
):
    """
    Receive heartbeat from a source sync agent.
    """

    return {
        "success": True,
        "message": "Heartbeat received"
    }

