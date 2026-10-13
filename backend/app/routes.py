import logging
import os
import secrets
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
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
    TrafficLog,
    LicensePlan,
    DesktopLicense,
)
from app.schemas import (
    LoginRequest,
    UserResponse,
    SyncPayload,
    ControlApiKeyCreate,
    ControlUserCreate,
    LicensePlanCreate, LicensePlanUpdate, LicenseCreate, LicenseBulkCreate,
)
from app.auth import (
    verify_password,
    hash_password,
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


def is_control_admin(user: User) -> bool:
    admin_email = os.getenv(
        "INITIAL_ADMIN_EMAIL",
        "admin@central-sync.com",
    ).strip().casefold()
    return user.email.strip().casefold() == admin_email


def require_control_admin(user: User, admin_password: str) -> None:
    if not is_control_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the configured administrator can manage Control.",
        )
    if not verify_password(admin_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Administrator password is incorrect.",
        )




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
            "email": user.email,
            "canManageControl": is_control_admin(user),
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
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "canManageControl": is_control_admin(current_user),
    }


@router.get("/api/v1/control")
def get_control_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_control_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the configured administrator can access Control.",
        )

    api_keys = (
        db.query(ApiKey.id, ApiKey.key_name)
        .order_by(ApiKey.key_name)
        .all()
    )
    users = (
        db.query(User.id, User.name, User.email, User.is_active)
        .order_by(User.email)
        .all()
    )
    return {
        "apiKeys": [
            {"id": key_id, "keyName": key_name}
            for key_id, key_name in api_keys
        ],
        "users": [
            {
                "id": user_id,
                "name": name,
                "email": email,
                "isActive": is_active,
            }
            for user_id, name, email, is_active in users
        ],
    }


@router.post("/api/v1/control/api-keys", status_code=status.HTTP_201_CREATED)
def create_control_api_key(
    data: ControlApiKeyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_control_admin(current_user, data.adminPassword)
    key_name = data.keyName.strip()
    api_key = data.apiKey.strip()
    if not key_name or not api_key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="API key name and value are required.",
        )
    if db.query(ApiKey.id).filter(ApiKey.key_name == key_name).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An API key with this name already exists.",
        )

    db.add(ApiKey(key_name=key_name, api_key=api_key))
    if not db.query(Instance.id).filter(Instance.identifier == key_name).first():
        db.add(Instance(name=key_name, identifier=key_name))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An API key with this name already exists.",
        ) from error

    created_key = db.query(ApiKey.id).filter(ApiKey.key_name == key_name).one()
    return JSONResponse(
        {"id": created_key.id, "keyName": key_name, "apiKey": api_key},
        status_code=status.HTTP_201_CREATED,
        headers={"Cache-Control": "no-store"},
    )


@router.post("/api/v1/control/api-keys/generate")
def generate_control_api_key(
    current_user: User = Depends(get_current_user),
):
    if not is_control_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the configured administrator can manage Control.",
        )
    return JSONResponse(
        {"apiKey": secrets.token_urlsafe(32)},
        headers={"Cache-Control": "no-store"},
    )


@router.post("/api/v1/control/users", status_code=status.HTTP_201_CREATED)
def create_control_user(
    data: ControlUserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_control_admin(current_user, data.adminPassword)
    email = str(data.email).strip().casefold()
    if db.query(User.id).filter(func.lower(User.email) == email).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email address already exists.",
        )

    user = User(
        name=data.name.strip(),
        email=email,
        hashed_password=hash_password(data.password),
        is_active=True,
    )
    if not user.name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="User name is required.",
        )

    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email address already exists.",
        ) from error

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "isActive": user.is_active,
    }


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
    # Include both API-key instances and databases imported by the direct DB worker.
    instance_codes = {name for (name,) in db.query(ApiKey.key_name).all()}
    instance_codes.update(name for (name,) in db.query(Instance.identifier).all())
    api_keys = [(name,) for name in sorted(instance_codes)]

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
        .filter(SyncLog.event_type.in_(("SYNC", "DIRECT_DB_SYNC")))
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
    received_at = SyncRecord.synced_at
    received_day = func.date(func.timezone("UTC", received_at))
    daily_rows = (
        db.query(
            received_day,
            SyncRecord.instance_code,
            SyncRecord.modality,
            func.count(SyncRecord.id),
            func.coalesce(func.sum(SyncRecord.credits_used), 0),
        )
        .filter(
            received_at.is_not(None),
            SyncRecord.sync_status == "SYNCED",
        )
        .group_by(
            received_day,
            SyncRecord.instance_code,
            SyncRecord.modality,
        )
        .order_by(received_day)
        .all()
    )

    normalized_description = func.nullif(func.trim(SyncRecord.study_description), "")
    description_rows = (
        db.query(
            received_day,
            SyncRecord.instance_code,
            SyncRecord.modality,
            normalized_description,
            func.count(SyncRecord.id),
            func.coalesce(func.sum(SyncRecord.credits_used), 0),
        )
        .filter(
            received_at.is_not(None),
            SyncRecord.sync_status == "SYNCED",
        )
        .group_by(
            received_day,
            SyncRecord.instance_code,
            SyncRecord.modality,
            normalized_description,
        )
        .order_by(received_day)
        .all()
    )

    instance_rows = (
        db.query(
            SyncRecord.instance_code,
            SyncRecord.modality,
            func.count(SyncRecord.id),
            func.coalesce(func.sum(SyncRecord.credits_used), 0),
        )
        .filter(SyncRecord.sync_status == "SYNCED")
        .group_by(SyncRecord.instance_code, SyncRecord.modality)
        .order_by(SyncRecord.instance_code)
        .all()
    )

    modality_totals: dict[str | None, tuple[int, int]] = {}
    source_instances: set[str] = set()
    for instance_code, modality, records, credits in instance_rows:
        previous_records, previous_credits = modality_totals.get(modality, (0, 0))
        modality_totals[modality] = (
            previous_records + int(records or 0),
            previous_credits + int(credits or 0),
        )
        if instance_code is not None:
            source_instances.add(instance_code)

    total_records = sum(records for records, _credits in modality_totals.values())
    total_credits = sum(credits for _records, credits in modality_totals.values())

    configured_modalities = (
        db.query(ModalityOption.name)
        .filter(ModalityOption.is_active.is_(True))
        .all()
    )
    modality_names = {
        modality.strip().upper(): modality.strip()
        for modality in modality_totals
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
            "totalModalities": len(modality_totals),
            "sourceInstances": len(source_instances),
        },
        "byModality": [
            {
                "modality": modality or "Not specified",
                "records": records,
                "credits": credits,
            }
            for modality, (records, credits) in modality_totals.items()
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
        "byDescription": [
            {
                "date": day.isoformat() if hasattr(day, "isoformat") else str(day),
                "instanceCode": instance_code,
                "modality": modality or "Not specified",
                "studyDescription": description,
                "records": records,
                "credits": credits,
            }
            for day, instance_code, modality, description, records, credits in description_rows
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
    traffic_instance = func.coalesce(Instance.identifier, "portal")
    traffic_instance_name = func.coalesce(Instance.name, Instance.identifier, "Portal")
    rows = (
        db.query(
            day_expression.label("day"),
            TrafficLog.instance_id.label("traffic_instance_id"),
            traffic_instance.label("instance"),
            traffic_instance_name.label("instance_name"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
            func.coalesce(func.sum(TrafficLog.processing_time), 0).label(
                "processing_seconds"
            ),
            func.sum(case((TrafficLog.is_success, 1), else_=0)).label("successes"),
        )
        .select_from(TrafficLog)
        .outerjoin(Instance, Instance.id == TrafficLog.instance_id)
        .filter(
            TrafficLog.timestamp >= start,
            TrafficLog.timestamp < end,
        )
        .group_by(
            day_expression,
            TrafficLog.instance_id,
            Instance.identifier,
            Instance.name,
        )
        .order_by(day_expression, traffic_instance)
        .all()
    )

    hour_expression = func.extract(
        "hour", func.timezone("UTC", TrafficLog.timestamp)
    )
    hourly_rows = (
        db.query(
            hour_expression.label("hour"),
            traffic_instance.label("instance"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
            func.coalesce(func.sum(TrafficLog.processing_time), 0).label(
                "processing_seconds"
            ),
        )
        .select_from(TrafficLog)
        .outerjoin(Instance, Instance.id == TrafficLog.instance_id)
        .filter(
            TrafficLog.timestamp >= start,
            TrafficLog.timestamp < end,
        )
        .group_by(hour_expression, traffic_instance)
        .order_by(hour_expression, traffic_instance)
        .all()
    )

    daily_totals: dict[str, dict[str, int]] = {}
    instance_totals: dict[str, dict[str, int | float | str]] = {}
    total_processing_seconds = 0.0
    total_successful_requests = 0
    for row in rows:
        day = row.day.isoformat() if hasattr(row.day, "isoformat") else str(row.day)
        daily = daily_totals.setdefault(day, {"requests": 0, "totalDataBytes": 0})
        daily["requests"] += int(row.requests or 0)
        daily["totalDataBytes"] += int(row.data_bytes or 0)

        total_processing_seconds += float(row.processing_seconds or 0)
        total_successful_requests += int(row.successes or 0)
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
        # Unassigned browser/admin calls are portal traffic, not a source instance.
        if instance["instance"] == "portal":
            continue
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

    # Direct source database activity is separate from portal HTTP telemetry.
    source_day_expression = func.date(func.timezone("UTC", SyncRecord.synced_at))
    source_in_range = (
        (SyncRecord.synced_at >= start)
        & (SyncRecord.synced_at < end)
        & (SyncRecord.sync_status == "SYNCED")
    )
    source_instance_rows = (
        db.query(
            SyncRecord.instance_code.label("instance_code"),
            func.coalesce(Instance.name, SyncRecord.instance_code).label("name"),
            func.coalesce(func.sum(case((source_in_range, 1), else_=0)), 0).label("studies"),
            func.coalesce(func.sum(case((source_in_range, SyncRecord.credits_used), else_=0)), 0).label("credits"),
            func.max(case((source_in_range, SyncRecord.synced_at), else_=None)).label("last_sync"),
        )
        .outerjoin(Instance, Instance.identifier == SyncRecord.instance_code)
        .group_by(SyncRecord.instance_code, Instance.name)
        .order_by(func.sum(case((source_in_range, 1), else_=0)).desc(), SyncRecord.instance_code)
        .all()
    )
    source_daily_rows = (
        db.query(
            source_day_expression.label("day"),
            SyncRecord.instance_code.label("instance_code"),
            func.count(SyncRecord.id).label("studies"),
            func.coalesce(func.sum(SyncRecord.credits_used), 0).label("credits"),
        )
        .filter(SyncRecord.sync_status == "SYNCED", SyncRecord.synced_at >= start, SyncRecord.synced_at < end)
        .group_by(source_day_expression, SyncRecord.instance_code)
        .order_by(source_day_expression, SyncRecord.instance_code)
        .all()
    )
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
            "averageResponseTimeMs": round(total_processing_seconds * 1000 / sum(item["requests"] for item in daily_totals.values()), 2)
            if sum(item["requests"] for item in daily_totals.values()) else 0,
            "successRate": round(total_successful_requests * 100 / sum(item["requests"] for item in daily_totals.values()), 1)
            if sum(item["requests"] for item in daily_totals.values()) else 0,
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
        "hourlyByInstance": [
            {
                "hour": int(row.hour),
                "instance": row.instance,
                "requests": int(row.requests or 0),
                "totalDataBytes": int(row.data_bytes or 0),
                "averageResponseTimeMs": round(
                    float(row.processing_seconds or 0) * 1000 / row.requests, 2
                )
                if row.requests
                else 0,
            }
            for row in hourly_rows
        ],
        "instances": instances,
        "sourceActivity": {
            "totalStudies": sum(int(row.studies or 0) for row in source_instance_rows),
            "creditsUsed": sum(int(row.credits or 0) for row in source_instance_rows),
            "activeInstances": len(source_instance_rows),
            "lastSync": max(
                (row.last_sync for row in source_instance_rows if row.last_sync),
                default=None,
            ).isoformat()
            if any(row.last_sync for row in source_instance_rows)
            else None,
            "instances": [
                {
                    "instance": row.instance_code,
                    "name": row.name,
                    "studies": int(row.studies or 0),
                    "creditsUsed": int(row.credits or 0),
                    "lastSync": row.last_sync.isoformat() if row.last_sync else None,
                }
                for row in source_instance_rows
            ],
            "daily": [
                {
                    "date": row.day.isoformat() if hasattr(row.day, "isoformat") else str(row.day),
                    "instance": row.instance_code,
                    "studies": int(row.studies or 0),
                    "creditsUsed": int(row.credits or 0),
                }
                for row in source_daily_rows
                if row.day is not None
            ],
        },
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
        filtered.with_entities(
            func.count(func.distinct(TrafficLog.instance_id))
        )
        .scalar()
        or 0
    )
    instance_rows = (
        db.query(
            Instance.id.label("id"),
            func.coalesce(Instance.name, Instance.identifier, "Portal").label("name"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
        )
        .select_from(TrafficLog)
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
            func.coalesce(Instance.name, Instance.identifier, "Portal").label("name"),
            func.coalesce(Instance.identifier, "portal").label("instance"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
            func.avg(TrafficLog.processing_time).label("avg_seconds"),
            traffic_success_rate().label("success_rate"),
        )
        .select_from(TrafficLog)
        .outerjoin(Instance, Instance.id == TrafficLog.instance_id)
        .filter(TrafficLog.timestamp >= start, TrafficLog.timestamp < end)
        .group_by(Instance.id, Instance.name, Instance.identifier)
        .order_by(func.count(TrafficLog.id).desc())
        .all()
    )
    return {
        "period": period,
        "items": [
            {
                "instance": row.instance,
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
            func.coalesce(Instance.name, Instance.identifier, "Portal").label("instance"),
            TrafficLog.route.label("route"),
            func.count(TrafficLog.id).label("requests"),
            func.coalesce(func.sum(traffic_total_bytes()), 0).label("data_bytes"),
            func.avg(TrafficLog.processing_time).label("avg_seconds"),
            traffic_success_rate().label("success_rate"),
        )
        .select_from(TrafficLog)
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
# DESKTOP LICENSES
# ============================================================

def _license_service(value: str) -> str:
    normalized = value.strip().upper().replace("-", "")
    if normalized not in {"XRAY", "CT"}:
        raise HTTPException(status_code=422, detail="Service must be X-ray or CT.")
    return normalized


XRAY_TEST_TYPE_ID = int(os.getenv("XRAY_TEST_TYPE_ID", "1"))
CT_TEST_TYPE_ID = int(os.getenv("CT_TEST_TYPE_ID", "2"))
_STATUS_TO_CODE = {"AVAILABLE": "A", "IN USE": "U", "CARRIED FORWARD": "CF", "CARRIED_FORWARD": "CF", "BLOCKED": "B", "REVOKED": "B", "EXPIRED": "B"}
_CODE_TO_STATUS = {"A": "Available", "U": "In Use", "CF": "Carried Forward", "B": "Blocked"}


def _test_type_id(service: str) -> int:
    return XRAY_TEST_TYPE_ID if service == "XRAY" else CT_TEST_TYPE_ID


def _service_from_plan(plan: LicensePlan) -> str:
    if plan.test_type_id == CT_TEST_TYPE_ID:
        return "CT"
    return "XRAY"


def _parse_geo(value: str | None):
    if not value:
        return None, None
    try:
        latitude, longitude = value.split(",", 1)
        return float(latitude.strip()), float(longitude.strip())
    except (TypeError, ValueError):
        return None, None


def _iso(value):
    return value.isoformat() if value else None


def _serialize_plan(plan: LicensePlan):
    return {"id": plan.plan_id, "name": plan.plan_name, "service": _service_from_plan(plan),
            "testTypeId": plan.test_type_id, "credits": plan.credits,
            "validityDays": plan.validity_days, "cost": float(plan.plan_cost or 0)}


def _serialize_license(item: DesktopLicense, plan: LicensePlan):
    latitude, longitude = _parse_geo(item.geo_location)
    return {"id": item.license_id, "licenseKey": item.license_key,
            "service": item.license_app_scope or _service_from_plan(plan),
            "platform": item.app_version_type, "planId": item.plan_id, "planName": plan.plan_name,
            "status": _CODE_TO_STATUS.get(item.status, item.status), "statusCode": item.status,
            "fullName": item.fullname, "username": item.username, "mobile": item.mobile,
            "vendor": item.vendor_name, "address": item.address, "location": item.address,
            "latitude": latitude, "longitude": longitude,
            "creditsRemaining": item.credit_left, "creditsTotal": plan.credits,
            "creditAvailableOnline": item.credit_available_online, "ctCredits": item.ct_credits,
            "systemHash": item.system_hash, "macAddress": item.mac_address,
            "lastSync": _iso(item.last_sync), "activationCount": item.activation_count,
            "activationAttemptCount": item.activation_attempt_count,
            "successfulValidationCount": item.successful_validation_count,
            "lastValidationAt": _iso(item.last_validation_at), "fraudDetected": item.fraud_detected,
            "fraudAttemptCount": item.fraud_attempt_count, "lastFraudAttempt": _iso(item.last_fraud_attempt),
            "lastFraudReason": item.last_fraud_reason, "rateLimitTriggered": item.rate_limit_triggered,
            "carriedForwardFrom": item.carried_forward_from, "carriedForwardTo": item.carried_forward_to,
            "carryForwardDate": _iso(item.carry_forward_date), "blockedAt": _iso(item.blocked_at),
            "blockedReason": item.blocked_reason, "errorLogs": item.error_logs,
            "startsAt": _iso(item.start_date), "endsAt": _iso(item.end_date),
            "createdAt": _iso(item.created_at), "updatedAt": _iso(item.updated_at)}


@router.get("/api/v1/desktop/plans")
def list_license_plans(service: str | None = None, db: Session = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    query = db.query(LicensePlan)
    if service:
        query = query.filter(LicensePlan.test_type_id == _test_type_id(_license_service(service)))
    return {"items": [_serialize_plan(p) for p in query.order_by(LicensePlan.test_type_id, LicensePlan.plan_name).all()]}


@router.post("/api/v1/desktop/plans", status_code=status.HTTP_201_CREATED)
def create_license_plan(data: LicensePlanCreate, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    service = _license_service(data.service)
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Plan name is required.")
    test_type_id = _test_type_id(service)
    if db.query(LicensePlan.plan_id).filter(LicensePlan.test_type_id == test_type_id, func.lower(LicensePlan.plan_name) == name.lower()).first():
        raise HTTPException(status_code=409, detail="A plan with this name already exists for this service.")
    plan = LicensePlan(test_type_id=test_type_id, plan_name=name, credits=data.credits,
                       validity_days=data.validityDays, plan_cost=data.cost)
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return _serialize_plan(plan)


@router.put("/api/v1/desktop/plans/{plan_id}")
def update_license_plan(plan_id: int, data: LicensePlanUpdate, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    plan = db.query(LicensePlan).filter(LicensePlan.plan_id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found.")
    service = _license_service(data.service)
    if service != _service_from_plan(plan) and db.query(DesktopLicense.license_id).filter(DesktopLicense.plan_id == plan_id).first():
        raise HTTPException(status_code=409, detail="A plan already assigned to licenses cannot change service.")
    name = data.name.strip()
    duplicate = db.query(LicensePlan.plan_id).filter(LicensePlan.plan_id != plan_id, LicensePlan.test_type_id == _test_type_id(service),
        func.lower(LicensePlan.plan_name) == name.lower()).first()
    if not name or duplicate:
        raise HTTPException(status_code=409 if duplicate else 422, detail="Plan name is required and must be unique for its service.")
    plan.plan_name, plan.test_type_id, plan.credits = name, _test_type_id(service), data.credits
    plan.validity_days, plan.plan_cost = data.validityDays, data.cost
    db.commit()
    db.refresh(plan)
    return _serialize_plan(plan)


@router.delete("/api/v1/desktop/plans/{plan_id}")
def delete_license_plan(plan_id: int, db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    plan = db.query(LicensePlan).filter(LicensePlan.plan_id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found.")
    if db.query(DesktopLicense.license_id).filter(DesktopLicense.plan_id == plan_id).first():
        raise HTTPException(status_code=409, detail="This plan is assigned to licenses and cannot be deleted.")
    db.delete(plan)
    db.commit()
    return {"success": True}


def _new_license(db: Session, plan: LicensePlan, service: str, platform: str, **details):
    now = datetime.now(timezone.utc)
    ends_at = now + timedelta(days=plan.validity_days) if plan.validity_days else None
    lat, lon = details.pop("latitude", None), details.pop("longitude", None)
    geo = f"{lat},{lon}" if lat is not None and lon is not None else None
    item = DesktopLicense(license_key=secrets.token_hex(10).upper(), license_app_scope=service,
                          app_version_type=platform, plan_id=plan.plan_id, status="A",
                          credit_left=plan.credits, credit_available_online=plan.credits,
                          ct_credits=plan.credits if service == "CT" else 0,
                          start_date=now, end_date=ends_at, geo_location=geo, **details)
    db.add(item)
    db.flush()
    return item


@router.get("/api/v1/desktop/licenses")
def list_desktop_licenses(service: str | None = None, search: str | None = None,
                          status_filter: str | None = None, db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    query = db.query(DesktopLicense, LicensePlan).join(LicensePlan, DesktopLicense.plan_id == LicensePlan.plan_id)
    if service:
        query = query.filter(DesktopLicense.license_app_scope == _license_service(service))
    if status_filter:
        query = query.filter(DesktopLicense.status == _STATUS_TO_CODE.get(status_filter.upper(), status_filter))
    if search:
        term = f"%{search.strip()}%"
        query = query.filter((DesktopLicense.license_key.ilike(term)) | (DesktopLicense.fullname.ilike(term)) |
                             (DesktopLicense.username.ilike(term)) | (DesktopLicense.mobile.ilike(term)))
    rows = query.order_by(DesktopLicense.license_id.desc()).limit(1000).all()
    return {"items": [_serialize_license(item, plan) for item, plan in rows]}


@router.post("/api/v1/desktop/licenses", status_code=status.HTTP_201_CREATED)
def create_desktop_license(data: LicenseCreate, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user)):
    service = _license_service(data.service)
    platform = data.platform.strip().upper()
    if platform not in {"DXP", "DCP", "CXR"}:
        raise HTTPException(status_code=422, detail="Choose a supported platform.")
    plan = db.query(LicensePlan).filter(LicensePlan.plan_id == data.planId, LicensePlan.test_type_id == _test_type_id(service)).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Active plan not found for this service.")
    item = _new_license(db, plan, service, platform, fullname=data.fullName, username=data.username,
                        mobile=data.mobile, vendor_name=data.vendor, address=data.location,
                        latitude=data.latitude, longitude=data.longitude)
    db.commit()
    db.refresh(item)
    return _serialize_license(item, plan)


@router.put("/api/v1/desktop/licenses/{license_id}")
def update_desktop_license(license_id: int, data: LicenseCreate, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user)):
    item = db.query(DesktopLicense).filter(DesktopLicense.license_id == license_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="License not found.")
    service = _license_service(data.service)
    platform = data.platform.strip().upper()
    if platform not in {"DXP", "DCP", "CXR"}:
        raise HTTPException(status_code=422, detail="Choose a supported platform.")
    plan = db.query(LicensePlan).filter(LicensePlan.plan_id == data.planId, LicensePlan.test_type_id == _test_type_id(service)).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found for this service.")
    item.license_app_scope, item.app_version_type, item.plan_id = service, platform, plan.plan_id
    item.fullname, item.username, item.mobile, item.vendor_name = data.fullName, data.username, data.mobile, data.vendor
    item.address = data.location
    item.geo_location = f"{data.latitude},{data.longitude}" if data.latitude is not None and data.longitude is not None else None
    item.credit_left = min(item.credit_left, plan.credits)
    item.credit_available_online = min(item.credit_available_online, plan.credits)
    item.end_date = datetime.now(timezone.utc) + timedelta(days=plan.validity_days) if plan.validity_days else None
    db.commit()
    db.refresh(item)
    return _serialize_license(item, plan)


@router.delete("/api/v1/desktop/licenses/{license_id}")
def delete_desktop_license(license_id: int, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user)):
    item = db.query(DesktopLicense).filter(DesktopLicense.license_id == license_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="License not found.")
    db.delete(item)
    db.commit()
    return {"success": True}


@router.post("/api/v1/desktop/licenses/bulk", status_code=status.HTTP_201_CREATED)
def bulk_create_desktop_licenses(data: LicenseBulkCreate, db: Session = Depends(get_db),
                                 current_user: User = Depends(get_current_user)):
    service = _license_service(data.service)
    platform = data.platform.strip().upper()
    if platform not in {"DXP", "DCP", "CXR"}:
        raise HTTPException(status_code=422, detail="Choose a supported platform.")
    plan = db.query(LicensePlan).filter(LicensePlan.plan_id == data.planId, LicensePlan.test_type_id == _test_type_id(service)).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Active plan not found for this service.")
    items = [_new_license(db, plan, service, platform, vendor_name=data.vendor, address=data.location) for _ in range(data.count)]
    db.commit()
    return {"created": len(items)}


@router.get("/api/v1/desktop/analytics")
def desktop_license_analytics(service: str | None = None, db: Session = Depends(get_db),
                              current_user: User = Depends(get_current_user)):
    query = db.query(DesktopLicense, LicensePlan).join(LicensePlan, DesktopLicense.plan_id == LicensePlan.plan_id)
    if service:
        query = query.filter(DesktopLicense.license_app_scope == _license_service(service))
    pairs = query.order_by(DesktopLicense.license_id.desc()).limit(5000).all()
    licenses = [item for item, _ in pairs]
    status_counts: dict[str, int] = {}
    platform_counts: dict[str, int] = {}
    plans: dict[str, int] = {}
    organisations: dict[str, int] = {}
    credits_used_total = validations = 0
    timeline: dict[str, int] = {}
    for item, plan in pairs:
        status_label = _CODE_TO_STATUS.get(item.status, item.status)
        status_counts[status_label] = status_counts.get(status_label, 0) + 1
        platform_counts[item.app_version_type] = platform_counts.get(item.app_version_type, 0) + 1
        plans[plan.plan_name] = plans.get(plan.plan_name, 0) + 1
        org = item.vendor_name or "Unassigned"
        organisations[org] = organisations.get(org, 0) + 1
        credits_used_total += max(plan.credits - item.credit_left, 0)
        validations += item.successful_validation_count
        event_dates = [item.created_at]
        if item.activation_count:
            event_dates.append(item.start_date)
        event_dates.extend([item.last_sync, item.last_validation_at])
        for event_at in event_dates:
            if event_at:
                day = event_at.date().isoformat()
                timeline[day] = timeline.get(day, 0) + 1
    recent = [{"licenseKey": item.license_key, "service": item.license_app_scope or _service_from_plan(plan),
               "platform": item.app_version_type, "status": _CODE_TO_STATUS.get(item.status, item.status),
               "credits": item.credit_left, "creditsTotal": plan.credits,
               "creditsUsed": max(plan.credits - item.credit_left, 0),
               "vendor": item.vendor_name or "Unassigned", "createdAt": _iso(item.created_at),
               "id": item.license_id}
              for item, plan in pairs[:50]]
    return {"total": len(pairs), "active": status_counts.get("In Use", 0),
            "creditsUsed": credits_used_total, "creditsTotal": sum(plan.credits for _, plan in pairs),
            "validationActivity": validations, "statuses": status_counts, "platforms": platform_counts,
            "plans": [{"name": n, "count": c} for n, c in sorted(plans.items(), key=lambda x: -x[1])[:12]],
            "organisations": [{"name": n, "count": c} for n, c in sorted(organisations.items(), key=lambda x: -x[1])[:12]],
            "timeline": [{"date": day, "count": count} for day, count in sorted(timeline.items())[-30:]],
            "recent": recent}


@router.get("/api/v1/desktop/licenses/{license_id}/analytics")
def desktop_license_key_analytics(license_id: int, db: Session = Depends(get_db),
                                  current_user: User = Depends(get_current_user)):
    pair = (db.query(DesktopLicense, LicensePlan)
            .join(LicensePlan, DesktopLicense.plan_id == LicensePlan.plan_id)
            .filter(DesktopLicense.license_id == license_id).first())
    if not pair:
        raise HTTPException(status_code=404, detail="License not found.")
    item, plan = pair
    used = max(plan.credits - item.credit_left, 0)
    return {"license": _serialize_license(item, plan), "planCredits": plan.credits,
            "creditsUsed": used, "creditsRemaining": item.credit_left,
            "usagePercent": round(used * 100 / plan.credits, 2) if plan.credits else 0,
            "validations": item.successful_validation_count,
            "activationCount": item.activation_count,
            "activationAttempts": item.activation_attempt_count,
            "fraudAttempts": item.fraud_attempt_count,
            "fraudDetected": item.fraud_detected,
            "activity": [{"date": _iso(item.last_validation_at), "type": "Validation"}]
            if item.last_validation_at else []}


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
