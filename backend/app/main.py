
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app import models
from app.routes import router
from app.traffic_middleware import TrafficMonitoringMiddleware

app = FastAPI(
    title="Central Sync Portal",
    description="Centralized Sync and QC Management",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TrafficMonitoringMiddleware)

Base.metadata.create_all(bind=engine)

app.include_router(router)


@app.get("/")
def home():
    return {
        "message": "Central Sync Portal API is running"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }