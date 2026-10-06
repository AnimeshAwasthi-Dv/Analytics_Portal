from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.auth_api import verify_api_key

from app.database import get_db
from app.models import (
    User,
    SyncRecord,
    SyncLog,
    ApiKey
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
                "recordsPending": None,
                "successRate": success_rate,
                "failedSyncs": failed_syncs,
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
        instance["recordsSynced"]
        for instance in instances
    )

    total_failed_syncs = sum(
        instance["failedSyncs"]
        for instance in instances
    )

    return {
        "kpis": {
            "totalInstances": total_instances,
            "onlineInstances": online_instances,
            "recordsSynced": total_records_synced,
            "recordsPending": None,
            "failedSyncs": total_failed_syncs,
            "apiStatus": "ONLINE",
            "avgResponseTime": None,
        },
        "instances": instances,
        "lastUpdated": datetime.utcnow().isoformat(),
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
    """
    Receive synchronization data from a source instance.

    Authentication:
        Authorization: Bearer <API_KEY>

    Payload:
    {
        "modality": "XR",
        "processing_created_at": "2026-10-03T10:20:00",
        "processing_completed_at": "2026-10-03T10:24:00",
        "credits_used": 4
    }
    """

    # --------------------------------------------------------
    # Determine source instance
    # --------------------------------------------------------

    instance_code = authenticated_key.key_name

    # --------------------------------------------------------
    # Create sync record
    # --------------------------------------------------------

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


    # --------------------------------------------------------
    # Create success log
    # --------------------------------------------------------

    log = SyncLog(
        instance_code=instance_code,
        event_type="SYNC",
        status="SUCCESS",
        message="Data received successfully"
    )

    db.add(log)

    # --------------------------------------------------------
    # Save both records
    # --------------------------------------------------------

    try:
        db.commit()
        db.refresh(record)

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

    # --------------------------------------------------------
    # Response
    # --------------------------------------------------------

    return {
        "success": True,
        "message": "Data synchronized successfully",
        "record_id": record.id
    }


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

