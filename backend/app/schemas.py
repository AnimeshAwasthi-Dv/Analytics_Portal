from datetime import datetime
from pydantic import BaseModel, EmailStr, Field
from typing import Optional


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    canManageControl: bool = False

    class Config:
        from_attributes = True


class ControlApiKeyCreate(BaseModel):
    keyName: str = Field(min_length=1, max_length=120)
    apiKey: str = Field(min_length=1, max_length=128)
    adminPassword: str = Field(min_length=1, max_length=256)


class ControlUserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    adminPassword: str = Field(min_length=1, max_length=256)


class SyncPayload(BaseModel):
    modality: Optional[str] = None
    study_description: Optional[str] = None
    processing_created_at: Optional[datetime] = None
    processing_completed_at: Optional[datetime] = None
    credits_used: int = Field(default=0, ge=0)
