import logging
import time
from datetime import datetime, timezone
from typing import Any

import anyio

from app.database import SessionLocal
from app.models import TrafficLog


logger = logging.getLogger(__name__)


def _excluded_path(path: str) -> bool:
    return (
        path in {"/", "/health", "/openapi.json"}
        or path.startswith(("/docs", "/redoc", "/static/"))
        or path.startswith(
            ("/api/v1/analytics/traffic", "/api/v1/analytics/instances")
        )
    )


def _store_traffic_log(
    instance_id: int | None,
    route: str,
    method: str,
    status_code: int,
    request_size: int | None,
    response_size: int,
    processing_time: float,
    timestamp: datetime,
) -> None:
    db = SessionLocal()
    try:
        db.add(
            TrafficLog(
                instance_id=instance_id,
                route=route[:255],
                method=method[:10],
                status_code=status_code,
                request_size=request_size,
                response_size=response_size,
                processing_time=processing_time,
                is_success=200 <= status_code < 400,
                timestamp=timestamp,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Unable to persist traffic metadata")
    finally:
        db.close()


class TrafficMonitoringMiddleware:
    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if _excluded_path(path):
            await self.app(scope, receive, send)
            return

        started_at = datetime.now(timezone.utc)
        started_clock = time.perf_counter()
        headers = dict(scope.get("headers", []))
        try:
            declared_request_size = int(headers[b"content-length"])
        except (KeyError, ValueError):
            declared_request_size = None

        request_size = 0
        request_body_observed = False
        response_size = 0
        status_code = 500

        async def receive_with_metrics() -> dict:
            nonlocal request_size, request_body_observed
            message = await receive()
            if message["type"] == "http.request":
                request_body_observed = True
                request_size += len(message.get("body", b""))
            return message

        async def send_with_metrics(message: dict) -> None:
            nonlocal response_size, status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            elif message["type"] == "http.response.body":
                response_size += len(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, receive_with_metrics, send_with_metrics)
        finally:
            if not request_body_observed:
                request_size = declared_request_size
            route = scope.get("route")
            route_path = getattr(route, "path", path)
            state = scope.get("state") or {}
            try:
                await anyio.to_thread.run_sync(
                    _store_traffic_log,
                    state.get("traffic_instance_id"),
                    route_path,
                    scope.get("method", "GET"),
                    status_code,
                    request_size,
                    response_size,
                    time.perf_counter() - started_clock,
                    started_at,
                )
            except Exception:
                logger.exception("Unable to run traffic metadata persistence")