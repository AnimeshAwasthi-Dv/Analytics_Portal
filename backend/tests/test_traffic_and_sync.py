import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import ValidationError
from sqlalchemy import create_engine, event, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth_api import verify_api_key
from app.database import Base
from app.models import ApiKey, Instance, SyncRecord, TrafficLog
from app.routes import (
    get_analytics,
    get_dashboard,
    get_traffic_instances,
    get_traffic_overview,
    get_traffic_summary,
    heartbeat,
    receive_sync,
)
from app.schemas import SyncPayload
from app.security import hash_api_key
from app.traffic_middleware import TrafficMonitoringMiddleware


class TrafficAndSyncTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        event.listen(
            self.engine,
            "connect",
            lambda connection, _record: connection.create_function(
                "timezone", 2, lambda _zone, value: value
            ),
        )
        Base.metadata.create_all(bind=self.engine)
        self.session = sessionmaker(bind=self.engine)()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_traffic_analytics_distinguishes_instances_with_duplicate_names(self):
        first = Instance(name="Agent", identifier="agent-1")
        second = Instance(name="Agent", identifier="agent-2")
        self.session.add_all((first, second))
        self.session.flush()

        timestamp = datetime.now(timezone.utc)
        self.session.add_all(
            (
                TrafficLog(
                    id=1,
                    instance_id=first.id,
                    route="/sync",
                    method="POST",
                    status_code=200,
                    request_size=10,
                    response_size=20,
                    processing_time=0.1,
                    is_success=True,
                    timestamp=timestamp,
                ),
                TrafficLog(
                    id=2,
                    instance_id=second.id,
                    route="/sync",
                    method="POST",
                    status_code=200,
                    request_size=2,
                    response_size=3,
                    processing_time=0.2,
                    is_success=True,
                    timestamp=timestamp,
                ),
            )
        )
        self.session.commit()

        today = timestamp.date()
        overview = get_traffic_overview(
            "custom", today, today, self.session, current_user=None
        )
        instances = get_traffic_instances(
            "custom", today, today, self.session, current_user=None
        )
        self.assertEqual(overview["totalRequests"], 2)
        self.assertEqual(overview["activeInstances"], 2)
        self.assertEqual(overview["highestTrafficInstance"]["totalDataBytes"], 30)
        self.assertEqual(overview["lowestTrafficInstance"]["totalDataBytes"], 5)
        self.assertEqual(len(instances["items"]), 2)

        self.session.add(
            TrafficLog(
                id=3,
                instance_id=None,
                route="/unattributed",
                method="GET",
                status_code=200,
                request_size=1,
                response_size=0,
                processing_time=0.05,
                is_success=True,
                timestamp=timestamp,
            )
        )
        self.session.commit()
        summary = get_traffic_summary(
            "custom", today, today, self.session, current_user=None
        )

        self.assertEqual(summary["overview"]["totalRequests"], 2)
        self.assertEqual(summary["overview"]["totalDataBytes"], 35)
        self.assertEqual(summary["overview"]["activeInstances"], 2)
        self.assertEqual(len(summary["daily"]), 1)
        self.assertEqual(len(summary["dailyByInstance"]), 2)
        self.assertEqual(
            {row["instance"] for row in summary["instances"]},
            {"agent-1", "agent-2"},
        )
        self.assertEqual(summary["instances"][0]["successRate"], 100.0)
        self.assertEqual(len(summary["recentRequests"]), 2)
        self.assertEqual(summary["recentRequests"][0]["route"], "/sync")
        self.assertEqual(summary["recentRequests"][0]["statusCode"], 200)
        self.assertEqual(
            sum(row["totalDataBytes"] for row in summary["recentRequests"]),
            35,
        )

    def test_heartbeat_requires_key_and_persists_instance_last_seen(self):
        api_key = ApiKey(key_name="agent-1", api_key="agent-secret")
        self.session.add(api_key)
        self.session.commit()
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials="agent-secret"
        )
        request = SimpleNamespace(state=SimpleNamespace())

        authenticated_key = verify_api_key(
            request=request,
            credentials=credentials,
            db=self.session,
        )
        response = heartbeat(self.session, authenticated_key)

        instance = (
            self.session.query(Instance)
            .filter(Instance.identifier == "agent-1")
            .one()
        )
        self.assertTrue(response["success"])
        self.assertIsNotNone(instance.last_seen_at)
        self.assertEqual(api_key.api_key, hash_api_key("agent-secret"))
        with self.assertRaises(HTTPException) as raised:
            verify_api_key(
                request=SimpleNamespace(state=SimpleNamespace()),
                credentials=HTTPAuthorizationCredentials(
                    scheme="Bearer", credentials=api_key.api_key
                ),
                db=self.session,
            )
        self.assertEqual(raised.exception.status_code, 401)
        dashboard = get_dashboard(self.session, current_user=None)
        self.assertEqual(dashboard["instances"][0]["status"], "Online")

    def test_ambiguous_duplicate_api_keys_fail_closed(self):
        self.session.add_all(
            (
                ApiKey(key_name="agent-1", api_key="shared-key"),
                ApiKey(key_name="agent-2", api_key="shared-key"),
            )
        )
        self.session.commit()
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials="shared-key"
        )

        with self.assertRaises(HTTPException) as raised:
            verify_api_key(request=None, credentials=credentials, db=self.session)

        self.assertEqual(raised.exception.status_code, 401)

    def test_existing_plaintext_key_remains_usable_during_migration_rollout(self):
        key = ApiKey(key_name="legacy-agent", api_key="legacy-secret")
        self.session.add(key)
        self.session.commit()
        self.session.execute(
            update(ApiKey)
            .where(ApiKey.key_name == "legacy-agent")
            .values(api_key="legacy-secret")
        )
        self.session.commit()
        self.session.expire_all()
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials="legacy-secret"
        )

        authenticated_key = verify_api_key(
            request=SimpleNamespace(state=SimpleNamespace()),
            credentials=credentials,
            db=self.session,
        )

        self.assertEqual(authenticated_key.key_name, "legacy-agent")

    def test_sync_credits_reject_negative_and_allow_zero(self):
        with self.assertRaises(ValidationError):
            SyncPayload(credits_used=-1)

        self.assertEqual(SyncPayload(credits_used=0).credits_used, 0)

    def test_sync_stores_study_description_from_payload(self):
        api_key = ApiKey(key_name="agent-1", api_key="agent-secret")
        self.session.add(api_key)
        self.session.commit()
        payload = SyncPayload(
            modality="CT",
            study_description="CT CHEST WITH CONTRAST",
            credits_used=2,
        )

        response = receive_sync(payload, self.session, api_key)

        records = (
            self.session.query(SyncRecord)
            .order_by(SyncRecord.id)
            .all()
        )
        self.assertTrue(response["success"])
        self.assertEqual(len(records), 2)
        self.assertEqual(
            [record.study_description for record in records],
            ["CT CHEST WITH CONTRAST", "CT CHEST WITH CONTRAST"],
        )
        dashboard = get_dashboard(self.session, current_user=None)
        self.assertEqual(
            dashboard["recentRecords"][0]["studyDescription"],
            "CT CHEST WITH CONTRAST",
        )

    def test_analytics_returns_instance_modality_trends_for_last_year(self):
        now = datetime.now(timezone.utc)
        self.session.add_all(
            (
                SyncRecord(
                    instance_code="agent-1",
                    modality="CT",
                    processing_created_at=now,
                    credits_used=2,
                    sync_status="SYNCED",
                ),
                SyncRecord(
                    instance_code="agent-2",
                    modality="MR",
                    processing_created_at=now,
                    credits_used=1,
                    sync_status="SYNCED",
                ),
                SyncRecord(
                    instance_code="agent-1",
                    modality="CT",
                    processing_created_at=now - timedelta(days=400),
                    credits_used=4,
                    sync_status="SYNCED",
                ),
            )
        )
        self.session.commit()

        analytics = get_analytics(self.session, current_user=None)

        self.assertEqual(analytics["summary"]["totalRecords"], 3)
        self.assertEqual(analytics["summary"]["totalCredits"], 7)
        self.assertEqual(analytics["summary"]["sourceInstances"], 2)
        self.assertEqual(len(analytics["daily"]), 2)
        self.assertEqual(
            {row["instanceCode"] for row in analytics["daily"]},
            {"agent-1", "agent-2"},
        )
        self.assertEqual(
            {row["modality"] for row in analytics["daily"]},
            {"CT", "MR"},
        )

    def test_traffic_middleware_measures_received_and_sent_body_bytes(self):
        received = []

        async def app(_scope, receive, send):
            request_message = await receive()
            received.append(request_message)
            await send(
                {"type": "http.response.start", "status": 201, "headers": []}
            )
            await send(
                {"type": "http.response.body", "body": b"ok", "more_body": False}
            )

        async def receive():
            return {
                "type": "http.request",
                "body": b"request",
                "more_body": False,
            }

        async def send(_message):
            return None

        scope = {
            "type": "http",
            "path": "/sync",
            "method": "POST",
            "headers": [],
            "state": {"traffic_instance_id": 7},
        }

        with patch("app.traffic_middleware._store_traffic_log") as store_log:
            asyncio.run(TrafficMonitoringMiddleware(app)(scope, receive, send))

        self.assertEqual(len(received), 1)
        logged = store_log.call_args.args
        self.assertEqual(logged[0], 7)
        self.assertEqual(logged[3], 201)
        self.assertEqual(logged[4], len(b"request"))
        self.assertEqual(logged[5], len(b"ok"))


if __name__ == "__main__":
    unittest.main()
