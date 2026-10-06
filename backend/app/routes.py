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

@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Return live dashboard statistics from the database.
    """

    # --------------------------------------------------------
    # TOTAL SOURCE INSTANCES
    # --------------------------------------------------------
    # Currently every ApiKey represents a configured source.
    total_instances = db.query(ApiKey).count()

    # --------------------------------------------------------
    # TOTAL SYNC RECORDS
    # --------------------------------------------------------
    records_synced = (
        db.query(SyncRecord)
        .filter(SyncRecord.sync_status == "SYNCED")
        .count()
    )

    # --------------------------------------------------------
    # FAILED SYNCS
    # --------------------------------------------------------
    failed_syncs = (
        db.query(SyncLog)
        .filter(
            SyncLog.event_type == "SYNC",
            SyncLog.status == "FAILED"
        )
        .count()
    )

    # --------------------------------------------------------
    # SUCCESSFUL SYNC ATTEMPTS
    # --------------------------------------------------------
    successful_syncs = (
        db.query(SyncLog)
        .filter(
            SyncLog.event_type == "SYNC",
            SyncLog.status == "SUCCESS"
        )
        .count()
    )

    # --------------------------------------------------------
    # SUCCESS RATE
    # --------------------------------------------------------
    total_attempts = successful_syncs + failed_syncs

    if total_attempts > 0:
        success_rate = round(
            (successful_syncs / total_attempts) * 100,
            2
        )
    else:
        success_rate = 0

    # --------------------------------------------------------
    # SOURCE / INSTANCE DETAILS
    # --------------------------------------------------------

    api_keys = (
        db.query(ApiKey)
        .order_by(ApiKey.id)
        .all()
    )

    instances = []

    for api_key in api_keys:

        instance_code = api_key.key_name

        # -----------------------------------------------
        # Successful records for this instance
        # -----------------------------------------------

        synced_count = (
            db.query(SyncRecord)
            .filter(
                SyncRecord.instance_code == instance_code,
                SyncRecord.sync_status == "SYNCED"
            )
            .count()
        )

        # -----------------------------------------------
        # Successful sync attempts
        # -----------------------------------------------

        instance_success = (
            db.query(SyncLog)
            .filter(
                SyncLog.instance_code == instance_code,
                SyncLog.event_type == "SYNC",
                SyncLog.status == "SUCCESS"
            )
            .count()
        )

        # -----------------------------------------------
        # Failed sync attempts
        # -----------------------------------------------

        instance_failed = (
            db.query(SyncLog)
            .filter(
                SyncLog.instance_code == instance_code,
                SyncLog.event_type == "SYNC",
                SyncLog.status == "FAILED"
            )
            .count()
        )

        # -----------------------------------------------
        # Last successful sync
        # -----------------------------------------------

        last_sync = (
            db.query(SyncRecord)
            .filter(
                SyncRecord.instance_code == instance_code,
                SyncRecord.sync_status == "SYNCED"
            )
            .order_by(SyncRecord.synced_at.desc())
            .first()
        )

        # -----------------------------------------------
        # Last sync time
        # -----------------------------------------------

        if last_sync and last_sync.synced_at:

            last_sync_time = last_sync.synced_at.strftime(
                "%H:%M:%S"
            )

            last_sync_timestamp = (
                last_sync.synced_at.isoformat()
            )

        else:

            last_sync_time = "Never"
            last_sync_timestamp = None

        # -----------------------------------------------
        # Instance success rate
        # -----------------------------------------------

        instance_attempts = (
            instance_success + instance_failed
        )

        if instance_attempts > 0:
            instance_success_rate = round(
                (instance_success / instance_attempts) * 100,
                2
            )
        else:
            instance_success_rate = 0

        # -----------------------------------------------
        # Current status
        # -----------------------------------------------
        #
        # True ONLINE/OFFLINE requires heartbeat storage.
        # For now we show:
        #
        # ACTIVE  = source has successfully synced
        # INACTIVE = source has never synced
        #
        # -----------------------------------------------

        if last_sync:
            instance_status = "ACTIVE"
        else:
            instance_status = "INACTIVE"

        instances.append({
            "id": instance_code,
            "name": instance_code,
            "status": instance_status,
            "lastSyncTime": last_sync_time,
            "lastSyncTimestamp": last_sync_timestamp,
            "recordsSynced": synced_count,
            "recordsPending": 0,
            "failedSyncs": instance_failed,
            "successRate": instance_success_rate
        })

    # --------------------------------------------------------
    # RESPONSE
    # --------------------------------------------------------

    return {
        "kpis": {
            "totalInstances": total_instances,
            "onlineInstances": sum(
                1
                for instance in instances
                if instance["status"] == "ACTIVE"
            ),
            "recordsSynced": records_synced,
            "recordsPending": 0,
            "failedSyncs": failed_syncs,
            "successRate": success_rate,
            "apiStatus": "ONLINE",
            "avgResponseTime": "N/A"
        },
        "instances": instances
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

