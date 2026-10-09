from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Instance

security = HTTPBearer()


def verify_api_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    api_key = credentials.credentials

    stored_key = (
        db.query(ApiKey)
        .filter(ApiKey.api_key == api_key)
        .first()
    )

    if not stored_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key"
        )

    instance = (
        db.query(Instance)
        .filter(Instance.identifier == stored_key.key_name)
        .first()
    )
    if instance is None:
        instance = Instance(
            name=stored_key.key_name,
            identifier=stored_key.key_name,
        )
        db.add(instance)
        try:
            db.commit()
            db.refresh(instance)
        except IntegrityError:
            db.rollback()
            instance = (
                db.query(Instance)
                .filter(Instance.identifier == stored_key.key_name)
                .first()
            )
            if instance is None:
                raise

    request.state.traffic_instance_id = instance.id
    return stored_key