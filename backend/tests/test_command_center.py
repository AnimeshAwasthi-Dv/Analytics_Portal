import os
import unittest
from datetime import date, timedelta
from unittest.mock import patch
from unittest.mock import MagicMock

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session
from sqlalchemy.orm import sessionmaker

from app.command_api import CommandInput, TeamUpdate, create_command, date_bounds, update_member
from app.command_models import AuditEntry, Center, ControlCommand, Portal, ServiceEvent, TeamRole, PortalResource
from app.command_sync import classify_status, client_mapping, source_engine
from app.models import User
from app.permissions import ROLE_PERMISSIONS, require, role_for
from app.command_worker import apply_next, same_source_database


class CommandCenterTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        for model in (User, TeamRole, Portal, Center, ServiceEvent, ControlCommand, AuditEntry, PortalResource):
            model.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.owner = User(id=1, name="Owner", email="owner@example.com", hashed_password="unused", is_active=True)
        self.viewer = User(id=2, name="Viewer", email="viewer@example.com", hashed_password="unused", is_active=True)
        self.db.add_all([self.owner, self.viewer, Portal(code="pacs", name="PACS", client_code="shared-pacs", kind="shared", profile="prisma")])
        self.db.commit()
        self.db.add(PortalResource(portal_code="pacs", resource_type="service", source_id="service-1", name="Test service", enabled=True))
        self.db.commit()
        self.env = patch.dict(os.environ, {"INITIAL_ADMIN_EMAIL": "owner@example.com", "PACS_CONTROL_DATABASE_URL": "postgresql://control/portal"})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.db.close()
        self.engine.dispose()

    def test_role_changes_take_effect_without_new_token(self):
        guard = require("portals:control")
        with self.assertRaises(HTTPException) as failure:
            guard(self.viewer, self.db)
        self.assertEqual(failure.exception.status_code, 403)
        self.db.add(TeamRole(user_id=self.viewer.id, role="operations"))
        self.db.commit()
        self.assertEqual(guard(self.viewer, self.db).id, self.viewer.id)
        self.assertNotIn("licenses:write", ROLE_PERMISSIONS[role_for(self.viewer, self.db)])

    def test_owner_cannot_be_demoted_or_deactivated(self):
        with self.assertRaises(HTTPException):
            update_member(self.owner.id, TeamUpdate(role="viewer", active=False), self.db, self.owner)

    def test_command_is_audited_idempotent_and_conflicting_reuse_is_rejected(self):
        data = CommandInput(action="service_access", targetId="service-1", enabled=False,
                            reason="Operational maintenance", requestKey="request-123456789")
        first = create_command("pacs", data, self.db, self.owner)
        again = create_command("pacs", data, self.db, self.owner)
        self.assertEqual(first["id"], again["id"])
        self.assertEqual(self.db.query(AuditEntry).count(), 1)
        self.assertEqual(first["status"], "pending")
        with self.assertRaises(HTTPException):
            create_command("pacs", data.model_copy(update={"enabled": True}), self.db, self.owner)

    def test_center_control_requires_exact_registered_source_id(self):
        data = CommandInput(action="center_access", targetId="goyal", enabled=False, reason="Scheduled maintenance")
        with self.assertRaises(HTTPException) as failure:
            create_command("pacs", data, self.db, self.owner)
        self.assertEqual(failure.exception.status_code, 404)

    def test_control_rejects_sql_and_unsupported_actions(self):
        with self.assertRaises(ValidationError):
            CommandInput(action="service_access", targetId="x'; DROP TABLE users;--", enabled=False, reason="Invalid target test")
        with self.assertRaises(ValidationError):
            CommandInput(action="execute_sql", targetId="x", enabled=False, reason="Invalid action test")

    def test_ist_date_bounds_and_maximum_window(self):
        lower, upper, _, _ = date_bounds(date(2026, 11, 1), date(2026, 11, 1))
        self.assertEqual(lower.isoformat(), "2026-10-31T18:30:00+00:00")
        self.assertEqual(upper - lower, timedelta(days=1))
        with self.assertRaises(HTTPException):
            date_bounds(date(2024, 1, 1), date(2026, 1, 1))

    def test_analytics_filters_are_bound_parameters(self):
        value = "goyal' OR 1=1 --"
        compiled = select(ServiceEvent).where(ServiceEvent.client_code == value).compile(dialect=postgresql.dialect())
        self.assertNotIn(value, str(compiled))
        self.assertIn(value, compiled.params.values())

    def test_sync_enforces_readonly_and_exact_client_mapping(self):
        with patch("app.command_sync.create_engine") as factory:
            source_engine("postgresql://readonly:secret@localhost/source")
            self.assertIn("default_transaction_read_only=on", factory.call_args.kwargs["connect_args"]["options"])
        with patch.dict(os.environ, {"COMMAND_CENTER_CLIENT_MAP": '{"pacs:center-1":"goyal"}'}):
            self.assertEqual(client_mapping()["pacs:center-1"], "goyal")
            self.assertNotIn("pacs:center-2", client_mapping())

    def test_source_event_ids_are_namespaced_by_portal(self):
        self.assertEqual([c.name for c in ServiceEvent.__table__.primary_key], ["portal_code", "source_id"])
        self.assertEqual(classify_status("completed"), "SUCCESS")
        self.assertEqual(classify_status("failed"), "FAILED")

    def test_worker_rechecks_revoked_permissions_before_source_write(self):
        self.db.add(ControlCommand(request_key="revoked-user-test", portal_code="pacs", action="service_access",
                                   target_id="service-1", enabled=False, reason="Scheduled maintenance", requested_by=self.viewer.id))
        self.db.commit()
        with patch("app.command_worker.SessionLocal", sessionmaker(bind=self.engine)), patch("app.command_worker.source_engine") as source:
            self.assertTrue(apply_next())
            source.assert_not_called()
        self.db.expire_all()
        self.assertEqual(self.db.query(ControlCommand).one().status, "failed")

    def test_worker_applies_bound_absolute_state_and_audits_result(self):
        create_command("pacs", CommandInput(action="service_access", targetId="service-1", enabled=False, reason="Scheduled maintenance"), self.db, self.owner)
        source = MagicMock()
        connection = source.begin.return_value.__enter__.return_value
        connection.execute.return_value.first.return_value = ("service-1",)
        with patch.dict(os.environ, {"PACS_DATABASE_URL": "postgresql://readonly@control/portal"}), patch("app.command_worker.SessionLocal", sessionmaker(bind=self.engine)), patch("app.command_worker.source_engine", return_value=source):
            self.assertTrue(apply_next())
        args = connection.execute.call_args.args
        self.assertEqual(args[1]["target"], "service-1")
        self.assertFalse(args[1]["enabled"])
        self.db.expire_all()
        self.assertEqual(self.db.query(ControlCommand).one().status, "applied")
        self.assertEqual(self.db.query(AuditEntry).count(), 2)

    def test_control_connection_cannot_target_another_database(self):
        with patch.dict(os.environ, {"PACS_DATABASE_URL": "postgresql://readonly@db-one/portal"}):
            self.assertFalse(same_source_database("pacs", "postgresql://writer@db-two/portal"))
            self.assertTrue(same_source_database("pacs", "postgresql://writer@db-one/portal"))


if __name__ == "__main__":
    unittest.main()
