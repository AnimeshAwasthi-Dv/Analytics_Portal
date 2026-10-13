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


class LicensePlanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    service: str
    credits: int = Field(default=0, ge=0)
    validityDays: int = Field(default=0, ge=0)
    cost: float = Field(default=0, ge=0)


class LicenseCreate(BaseModel):
    service: str
    planId: int
    platform: str
    fullName: Optional[str] = Field(default=None, max_length=160)
    username: Optional[str] = Field(default=None, max_length=120)
    mobile: Optional[str] = Field(default=None, max_length=20)
    vendor: Optional[str] = Field(default=None, max_length=160)
    location: Optional[str] = Field(default=None, max_length=160)
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class LicenseBulkCreate(BaseModel):
    service: str
    planId: int
    platform: str
    count: int = Field(ge=1, le=1000)
    vendor: Optional[str] = Field(default=None, max_length=160)
    location: Optional[str] = Field(default=None, max_length=160)


class LicensePlanUpdate(LicensePlanCreate):
    pass
