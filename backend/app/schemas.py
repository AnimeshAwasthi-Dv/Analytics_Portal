
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


class QCRecordCreate(BaseModel):
    study_id: str
    status: str = "Pending"
    remarks: Optional[str] = None


class QCRecordResponse(BaseModel):
    id: int
    study_id: str
    status: str
    remarks: Optional[str] = None

    class Config:
        from_attributes = True