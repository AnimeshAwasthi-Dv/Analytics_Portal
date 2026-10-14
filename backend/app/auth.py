
import os
import secrets
import logging
from datetime import datetime, timedelta, timezone

from jose import jwt, JWTError
from pwdlib import PasswordHash
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User

logger = logging.getLogger(__name__)
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    if APP_ENV in {"production", "prod"}:
        raise RuntimeError("JWT_SECRET must be configured in production")
    SECRET_KEY = secrets.token_urlsafe(32)
    logger.warning("JWT_SECRET is unset; using a temporary local-development key")
elif APP_ENV in {"production", "prod"} and len(SECRET_KEY) < 32:
    raise RuntimeError("JWT_SECRET must contain at least 32 characters in production")

ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
if APP_ENV in {"production", "prod"} and ALGORITHM != "HS256":
    raise RuntimeError("JWT_ALGORITHM must be HS256 in production")
TOKEN_EXPIRATION = int(os.getenv("JWT_EXPIRATION", "60"))
COOKIE_SECURE = os.getenv(
    "COOKIE_SECURE",
    str(APP_ENV in {"production", "prod"}).lower(),
).strip().lower() in {"1", "true", "yes"}

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return password_hash.verify(plain_password, hashed_password)


def create_access_token(data: dict):
    to_encode = data.copy()

    expire = datetime.now(timezone.utc) + timedelta(
        minutes=TOKEN_EXPIRATION
    )

    to_encode.update({"exp": expire})

    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
):
    token = request.cookies.get("access_token")

    # Fallback to Authorization Header (e.g. Bearer <token> in Swagger UI / Postman)
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1].strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        email = payload.get("sub")

        if email is None:
            raise HTTPException(status_code=401, detail="Invalid token")

    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token"
        )

    user = db.query(User).filter(User.email == email).first()

    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive or not found")

    return user