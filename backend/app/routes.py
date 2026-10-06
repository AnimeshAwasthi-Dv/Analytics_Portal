from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    User,
    QCRecord,
    SourceInstance,
    SyncRecord,
    SyncLog
)
from app.schemas import (
    LoginRequest,
    UserResponse,
    QCRecordCreate
)
from app.auth import (
    verify_password,
    create_access_token,
    get_current_user
)


router = APIRouter()


# ============================================================
# SYNC PAYLOAD
# ============================================================

class SyncPayload(BaseModel):
    modality: str | None = None
    processing_created_at: datetime | None = None
    processing_completed_at: datetime | None = None
    credits_used: int = 0


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

@router.get("/dashboard")
def dashboard(
    current_user: User = Depends(get_current_user)
):
    return {
        "message": f"Welcome {current_user.name}",
        "user": current_user.email
    }


# ============================================================
# QC APIs
# ============================================================

@router.get("/qc")
def get_qc_records(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return (
        db.query(QCRecord)
        .order_by(QCRecord.id.desc())
        .all()
    )


@router.post("/qc")
def create_qc_record(
    data: QCRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    record = QCRecord(
        study_id=data.study_id,
        status=data.status,
        remarks=data.remarks
    )

    db.add(record)
    db.commit()
    db.refresh(record)

    return record


# ============================================================
# CENTRAL SYNC API
# ============================================================

@router.post("/api/v1/sync")
def receive_sync(
    data: SyncPayload,
    db: Session = Depends(get_db)
):
    """
    Receive synchronization data from a source instance.

    Payload:

    {
        "modality": "XR",
        "processing_created_at": "2026-10-03T10:20:00",
        "processing_completed_at": "2026-10-03T10:24:00",
        "credits_used": 4
    }
    """

    # --------------------------------------------------------
    # Temporary instance identification
    # --------------------------------------------------------
    # The payload itself does NOT contain instance_code.
    # This will later be determined from API authentication.
    instance_code = "UNKNOWN"

    # --------------------------------------------------------
    # Create sync record
    # --------------------------------------------------------

    record = SyncRecord(
        instance_code=instance_code,
        modality=data.modality,
        processing_created_at=data.processing_created_at,
        processing_completed_at=data.processing_completed_at,
        credits_used=data.credits_used,
        sync_status="SYNCED"
    )

    db.add(record)

    # --------------------------------------------------------
    # Create sync log
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

        # Record failure in log
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


# ============================================================
# SOURCE DATABASE INSTANCES
# ============================================================

@router.get("/api/v1/instances")
def get_instances(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Return all configured source database instances.
    """

    return (
        db.query(SourceInstance)
        .order_by(SourceInstance.id)
        .all()
    )


# ============================================================
# SYNC RECORDS
# ============================================================

@router.get("/api/v1/sync-records")
def get_sync_records(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Return the latest synchronization records.
    """

    return (
        db.query(SyncRecord)
        .order_by(SyncRecord.id.desc())
        .limit(500)
        .all()
    )


# ============================================================
# SYNC LOGS
# ============================================================

@router.get("/api/v1/logs")
def get_sync_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Return synchronization logs.
    """

    return (
        db.query(SyncLog)
        .order_by(SyncLog.id.desc())
        .limit(500)
        .all()
    )