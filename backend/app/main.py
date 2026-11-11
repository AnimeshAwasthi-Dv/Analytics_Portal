
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import APP_ENV, COOKIE_SECURE
from app.routes import router
from app.command_api import router as command_router
from app.analysis_assistant import router as assistant_router
from app.assistant_api import router as conversation_router
from app.operations_api import router as operations_router
from app.pacs_api import router as pacs_router
from app.pacs_documents import public_router
from app.traffic_middleware import TrafficMonitoringMiddleware

production = APP_ENV in {"production", "prod"}
configured_origins = os.getenv("CORS_ALLOWED_ORIGINS", "")
allowed_origins = [
    origin.strip()
    for origin in configured_origins.split(",")
    if origin.strip()
]

if production and not allowed_origins:
    raise RuntimeError("CORS_ALLOWED_ORIGINS must be configured in production")
if production and not COOKIE_SECURE:
    raise RuntimeError("COOKIE_SECURE must be enabled in production")
if "*" in allowed_origins:
    raise RuntimeError("CORS_ALLOWED_ORIGINS cannot contain '*'")

if not allowed_origins:
    allowed_origins = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:4173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:4173",
    ]

app = FastAPI(
    title="DecXpert Control Panel",
    description="Centralized Sync and QC Management",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_middleware(TrafficMonitoringMiddleware)

app.include_router(router)
app.include_router(command_router)
app.include_router(assistant_router)
app.include_router(conversation_router)
app.include_router(operations_router)
app.include_router(pacs_router)
app.include_router(public_router)


@app.get("/")
def home():
    return {
        "message": "DecXpert Control Panel API is running"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }
