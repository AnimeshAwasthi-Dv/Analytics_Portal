import os
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.command_models import TeamRole

ROLE_PERMISSIONS = {
    "super_admin": {"analytics:read", "portals:control", "team:manage", "licenses:write", "audit:read", "legacy:read"},
    "operations": {"analytics:read", "portals:control", "audit:read", "legacy:read"},
    "analyst": {"analytics:read", "legacy:read"},
    "support": {"analytics:read", "audit:read", "legacy:read"},
    "finance": {"analytics:read", "licenses:write", "legacy:read"},
    "viewer": {"analytics:read", "legacy:read"},
}


def is_owner(user):
    return user.email.strip().casefold() == os.getenv("INITIAL_ADMIN_EMAIL", "admin@central-sync.com").strip().casefold()


def role_for(user, db):
    if is_owner(user):
        return "super_admin"
    grant = db.get(TeamRole, user.id)
    return grant.role if grant and grant.role in ROLE_PERMISSIONS else "viewer"


def require(permission):
    def dependency(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        if permission not in ROLE_PERMISSIONS[role_for(user, db)]:
            raise HTTPException(403, "Your team role does not permit this action.")
        return user
    return dependency


def legacy_access(user: User = Depends(get_current_user)):
    # All internal roles can view legacy analytics. Writes use a separate dependency.
    return user


license_writer = require("licenses:write")
