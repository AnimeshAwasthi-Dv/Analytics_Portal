from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.exc import IntegrityError
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ApiKey, Instance
from app.security import API_KEY_HASH_PREFIX, hash_api_key

security = HTTPBearer()


def verify_api_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    api_key = credentials.credentials

    matching_keys = (
        db.query(ApiKey)
        .filter(
            or_(
                ApiKey.api_key == hash_api_key(api_key),
                and_(
                    ApiKey.api_key.not_like(f"{API_KEY_HASH_PREFIX}%"),
                    ApiKey.api_key == api_key,
                ),
            )
        )
        .limit(2)
        .all()
    )

    if len(matching_keys) != 1:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key"
        )

    stored_key = matching_keys[0]
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