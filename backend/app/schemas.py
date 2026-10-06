from datetime import datetime
from pydantic import BaseModel, EmailStr
from typing import Optional


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr

    class Config:
        from_attributes = True


class SyncPayload(BaseModel):
    modality: Optional[str] = None
    processing_created_at: Optional[datetime] = None
    processing_completed_at: Optional[datetime] = None
    credits_used: int = 0