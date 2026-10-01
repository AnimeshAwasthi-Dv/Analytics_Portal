
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, QCRecord
from app.schemas import LoginRequest, UserResponse, QCRecordCreate
from app.auth import (
    verify_password,
    create_access_token,
    get_current_user
)

router = APIRouter()


@router.post("/auth/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):

    # 1. Sanitize and normalize email input
    email = data.email.strip().lower()

    # 2. Validate input
    if not email or not data.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and password are required"
        )

    # 3. Safe parameterized database query using SQLAlchemy ORM
    user = db.query(User).filter(User.email == email).first()

    # 4. Verify credentials
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    # 5. Generate JWT token
    token = create_access_token({"sub": user.email})

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
        secure=False,  # Set True when using HTTPS in production
        samesite="lax",
        max_age=3600
    )

    return response


@router.post("/auth/logout")
def logout():
    response = JSONResponse({"message": "Logged out successfully"})
    response.delete_cookie("access_token")
    return response


@router.get("/auth/me", response_model=UserResponse)
def get_profile(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/dashboard")
def dashboard(current_user: User = Depends(get_current_user)):
    return {
        "message": f"Welcome {current_user.name}",
        "user": current_user.email
    }


@router.get("/qc")
def get_qc_records(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(QCRecord).order_by(QCRecord.id.desc()).all()


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