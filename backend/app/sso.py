import os
import secrets
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional

from jose import jwt, JWTError
from sqlalchemy import text
from sqlalchemy.orm import Session
from fastapi import HTTPException, status, Header

from app.models import User

logger = logging.getLogger(__name__)

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
SSO_ISSUER = os.getenv("SSO_ISSUER", "pacs-analytics-portal").strip()
SSO_AUDIENCE = os.getenv("SSO_AUDIENCE", "task-manager-portal").strip()
TASK_MANAGER_SSO_URL = os.getenv("TASK_MANAGER_SSO_URL", "https://task.admindectrocel.online").strip()

SSO_SHARED_SECRET = os.getenv("SSO_SHARED_SECRET") or os.getenv("SSO_SIGNING_SECRET")
if not SSO_SHARED_SECRET:
    jwt_sec = os.getenv("JWT_SECRET")
    if jwt_sec:
        SSO_SHARED_SECRET = jwt_sec
    elif APP_ENV in {"production", "prod"}:
        raise RuntimeError("SSO_SHARED_SECRET must be configured in production")
    else:
        SSO_SHARED_SECRET = "pacs-taskmanager-shared-sso-dev-secret-key-32chars!"
        logger.warning("SSO_SHARED_SECRET is unset; using local development secret")

SSO_CODE_TTL_SECONDS = int(os.getenv("SSO_CODE_TTL_SECONDS", "60"))


def hash_code(code: str) -> str:
    """Return SHA-256 hash of the opaque authorization code."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def ensure_sso_tables(db: Session) -> None:
    """Ensure the sso_authorization_codes table exists for tracking and single-use enforcement."""
    try:
        # Check dialect: SERIAL vs INTEGER PRIMARY KEY AUTOINCREMENT
        is_sqlite = db.bind.dialect.name == "sqlite" if db.bind else False
        pk_def = "INTEGER PRIMARY KEY AUTOINCREMENT" if is_sqlite else "SERIAL PRIMARY KEY"
        ts_def = "DATETIME" if is_sqlite else "TIMESTAMPTZ"
        bool_def = "BOOLEAN" if is_sqlite else "BOOLEAN"

        db.execute(text(f"""
            CREATE TABLE IF NOT EXISTS sso_authorization_codes (
                id {pk_def},
                code_hash VARCHAR(64) UNIQUE NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(120) NOT NULL DEFAULT '',
                email VARCHAR(255) NOT NULL,
                pacs_role VARCHAR(50) NOT NULL,
                expires_at {ts_def} NOT NULL,
                used {bool_def} NOT NULL DEFAULT 0,
                created_at {ts_def} NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sso_codes_hash ON sso_authorization_codes(code_hash)"))
        db.execute(text("CREATE INDEX IF NOT EXISTS idx_sso_codes_expiry ON sso_authorization_codes(expires_at)"))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Could not execute sso_authorization_codes table check: %s", exc)


def create_sso_authorization_code(
    user: User,
    pacs_role: str,
    db: Session,
    redirect_target: Optional[str] = None
) -> Dict[str, Any]:
    """
    Issue a random, high-entropy, opaque, single-use authorization code (NOT a JWT in the URL).
    Stored by SHA-256 hash in the database with a 60-second TTL.
    """
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )

    # Generate a cryptographically random, opaque authorization code
    raw_code = "pacs_ac_" + secrets.token_urlsafe(32)
    code_digest = hash_code(raw_code)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=SSO_CODE_TTL_SECONDS)

    ensure_sso_tables(db)
    try:
        db.execute(text("""
            INSERT INTO sso_authorization_codes (code_hash, user_id, name, email, pacs_role, expires_at, used)
            VALUES (:code_hash, :user_id, :name, :email, :pacs_role, :expires_at, FALSE)
        """), {
            "code_hash": code_digest,
            "user_id": user.id,
            "name": user.name or "",
            "email": user.email.strip().lower(),
            "pacs_role": pacs_role,
            "expires_at": expires_at,
        })
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to record SSO authorization code: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate SSO authorization code"
        )

    base_url = (redirect_target or TASK_MANAGER_SSO_URL).rstrip("/")
    # Browser redirect uses the opaque, single-use code only - NO tokens or identity in the URL
    redirect_url = f"{base_url}/sso/callback?code={raw_code}"

    return {
        "code": raw_code,
        "redirectUrl": redirect_url,
        "expiresIn": SSO_CODE_TTL_SECONDS,
        "user": {
            "email": user.email,
            "name": user.name,
            "pacsRole": pacs_role,
        }
    }


def verify_and_consume_sso_code(
    code: str,
    db: Session,
    auth_secret: Optional[str] = None
) -> Dict[str, Any]:
    """
    Backend-to-backend verification endpoint: validates and burns a single-use authorization code.
    If auth_secret is provided by the calling server, validates it against SSO_SHARED_SECRET.
    Supports both opaque authorization codes and signed JWT assertions.
    """
    if not code or not isinstance(code, str) or len(code.strip()) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Authorization code is required"
        )

    clean_code = code.strip()

    # If backend verification passes a shared secret, ensure it matches
    if auth_secret:
        clean_secret = auth_secret.replace("Bearer ", "").strip()
        if clean_secret != SSO_SHARED_SECRET:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid SSO verification credentials"
            )

    ensure_sso_tables(db)

    # 1. Check opaque authorization code via SHA-256 hash
    code_digest = hash_code(clean_code)

    # Check if code exists and is unexpired
    row = db.execute(text("""
        SELECT id, name, email, pacs_role, expires_at, used
        FROM sso_authorization_codes
        WHERE code_hash = :code_hash
    """), {"code_hash": code_digest}).fetchone()

    if row:
        now = datetime.now(timezone.utc)
        if row.used:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authorization code has already been used"
            )

        exp_at = row.expires_at
        if isinstance(exp_at, str):
            # Handle SQLite ISO format strings
            exp_at = datetime.fromisoformat(exp_at.replace("Z", "+00:00"))
        if exp_at.tzinfo is None:
            exp_at = exp_at.replace(tzinfo=timezone.utc)

        if exp_at <= now:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authorization code has expired"
            )

        # Atomically mark code as used (single use)
        update_result = db.execute(text("""
            UPDATE sso_authorization_codes
            SET used = TRUE
            WHERE id = :id AND used = FALSE
            RETURNING id
        """), {"id": row.id}).fetchone()
        db.commit()

        if not update_result:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authorization code has already been used"
            )

        return {
            "valid": True,
            "email": row.email,
            "name": row.name,
            "pacsRole": row.pacs_role,
            "issuer": SSO_ISSUER,
            "audience": SSO_AUDIENCE,
        }

    # 2. Fallback check: if code is a signed JWT assertion (for hybrid compatibility)
    try:
        payload = jwt.decode(
            clean_code,
            SSO_SHARED_SECRET,
            algorithms=["HS256"],
            audience=SSO_AUDIENCE,
            issuer=SSO_ISSUER,
        )
        jti = payload.get("jti")
        if not jti:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid token structure"
            )

        jwt_digest = hash_code(jti)
        jwt_row = db.execute(text("""
            SELECT id, used, expires_at FROM sso_authorization_codes WHERE code_hash = :hash
        """), {"hash": jwt_digest}).fetchone()

        if jwt_row:
            if jwt_row.used:
                raise HTTPException(status_code=401, detail="Authorization code has already been used")
            db.execute(text("UPDATE sso_authorization_codes SET used = TRUE WHERE id = :id"), {"id": jwt_row.id})
            db.commit()

        return {
            "valid": True,
            "email": payload.get("sub"),
            "name": payload.get("name"),
            "pacsRole": payload.get("pacs_role"),
            "issuer": SSO_ISSUER,
            "audience": SSO_AUDIENCE,
        }
    except JWTError:
        pass

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authorization code"
    )
