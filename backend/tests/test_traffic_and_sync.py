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
from app.models import ApiKey, Instance, SyncRecord, TrafficLog, User
from app.routes import (
    create_control_api_key,
    create_control_user,
    get_control_overview,
    get_analytics,
    get_dashboard,
    get_traffic_instances,
    get_traffic_overview,
    get_traffic_summary,
    heartbeat,
    receive_sync,
)
from app.schemas import ControlApiKeyCreate, ControlUserCreate, SyncPayload
from app.security import hash_api_key
from app.auth import hash_password, verify_password
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
        self.assertEqual(len(summary["hourlyByInstance"]), 2)
        hourly_by_instance = {
            row["instance"]: row for row in summary["hourlyByInstance"]
        }
        self.assertEqual(hourly_by_instance["agent-1"]["hour"], timestamp.hour)
        self.assertEqual(hourly_by_instance["agent-1"]["requests"], 1)
        self.assertEqual(hourly_by_instance["agent-1"]["totalDataBytes"], 30)
        self.assertEqual(
            hourly_by_instance["agent-1"]["averageResponseTimeMs"], 100.0
        )
        self.assertEqual(hourly_by_instance["agent-2"]["totalDataBytes"], 5)
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
        analytics = get_analytics(self.session, current_user=None)
        self.assertEqual(
            sum(row["records"] for row in analytics["daily"]),
            2,
        )
        self.assertEqual(
            {row["instanceCode"] for row in analytics["daily"]},
            {"agent-1"},
        )
        self.assertEqual(len(analytics["byDescription"]), 1)
        description_row = analytics["byDescription"][0]
        self.assertEqual(description_row["instanceCode"], "agent-1")
        self.assertEqual(description_row["modality"], "CT")
        self.assertEqual(description_row["studyDescription"], "CT CHEST WITH CONTRAST")
        self.assertEqual(description_row["records"], 2)
        self.assertEqual(description_row["credits"], 2)

    def test_control_creates_hashed_api_keys_and_standard_users(self):
        admin = User(
            name="Admin",
            email="admin@example.com",
            hashed_password=hash_password("admin-password-123"),
            is_active=True,
        )
        self.session.add(admin)
        self.session.commit()
        self.session.refresh(admin)
        with patch.dict(
            "os.environ", {"INITIAL_ADMIN_EMAIL": "admin@example.com"}
        ):
            created_key = create_control_api_key(
                ControlApiKeyCreate(
                    keyName="Instance Three",
                    apiKey="instance-three-secret",
                    adminPassword="admin-password-123",
                ),
                self.session,
                admin,
            )
            stored_key = (
                self.session.query(ApiKey)
                .filter(ApiKey.key_name == "Instance Three")
                .one()
            )
            self.assertEqual(created_key["keyName"], "Instance Three")
            self.assertEqual(
                stored_key.api_key, hash_api_key("instance-three-secret")
            )
            stored_instance = (
                self.session.query(Instance)
                .filter(Instance.identifier == "Instance Three")
                .one()
            )
            self.assertEqual(stored_instance.name, "Instance Three")
            authenticated_key = verify_api_key(
                request=SimpleNamespace(state=SimpleNamespace()),
                credentials=HTTPAuthorizationCredentials(
                    scheme="Bearer",
                    credentials="instance-three-secret",
                ),
                db=self.session,
            )
            self.assertEqual(authenticated_key.key_name, "Instance Three")

            created_user = create_control_user(
                ControlUserCreate(
                    name="New User",
                    email="New.User@example.com",
                    password="new-user-password-123",
                    adminPassword="admin-password-123",
                ),
                self.session,
                admin,
            )
            stored_user = (
                self.session.query(User)
                .filter(User.email == "new.user@example.com")
                .one()
            )
            self.assertEqual(created_user["email"], "new.user@example.com")
            self.assertTrue(
                verify_password("new-user-password-123", stored_user.hashed_password)
            )
            self.assertNotEqual(
                stored_user.hashed_password, "new-user-password-123"
            )

            overview = get_control_overview(self.session, admin)
            self.assertIn(
                {"id": stored_key.id, "keyName": "Instance Three"},
                overview["apiKeys"],
            )
            self.assertNotIn("api_key", str(overview))
            self.assertNotIn("instance-three-secret", str(overview))

    def test_control_requires_configured_admin_and_admin_password(self):
        admin = User(
            name="Admin",
            email="admin@example.com",
            hashed_password=hash_password("admin-password-123"),
            is_active=True,
        )
        standard_user = User(
            name="Standard",
            email="user@example.com",
            hashed_password=hash_password("standard-password-123"),
            is_active=True,
        )
        self.session.add_all((admin, standard_user))
        self.session.commit()

        with patch.dict(
            "os.environ", {"INITIAL_ADMIN_EMAIL": "admin@example.com"}
        ):
            with self.assertRaises(HTTPException) as overview_forbidden:
                get_control_overview(self.session, standard_user)
            self.assertEqual(overview_forbidden.exception.status_code, 403)

            with self.assertRaises(HTTPException) as wrong_password:
                create_control_api_key(
                    ControlApiKeyCreate(
                        keyName="Unauthorized",
                        apiKey="secret-value",
                        adminPassword="incorrect-password",
                    ),
                    self.session,
                    admin,
                )
            self.assertEqual(wrong_password.exception.status_code, 401)

            with self.assertRaises(HTTPException) as non_admin:
                create_control_user(
                    ControlUserCreate(
                        name="Another User",
                        email="another@example.com",
                        password="another-user-password",
                        adminPassword="standard-password-123",
                    ),
                    self.session,
                    standard_user,
                )
            self.assertEqual(non_admin.exception.status_code, 403)

        self.assertEqual(self.session.query(ApiKey).count(), 0)
        self.assertEqual(self.session.query(User).count(), 2)

    def test_analytics_trends_group_records_by_received_date(self):
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
        self.assertEqual(
            sum(row["records"] for row in analytics["daily"]),
            3,
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
