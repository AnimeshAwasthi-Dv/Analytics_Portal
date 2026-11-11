import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.command_models import Center, Portal, PortalResource, ServiceEvent, TeamRole, UserActivity
from app.database import get_db
from app.main import app
from app.models import MarengoReportReview, MarengoStudy, User
from app.source_sync import Source


class OperationsWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        for model in (User, TeamRole, Portal, Center, PortalResource, ServiceEvent, MarengoStudy, MarengoReportReview, UserActivity):
            model.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.user = User(id=1, name="Viewer", email="viewer@example.com", hashed_password="unused", is_active=True)
        self.db.add(self.user)
        for code in ("marengo", "goyal", "pacs"):
            self.db.add(Portal(code=code, name=code, client_code=code, kind="dedicated", profile="prisma"))
            self.db.add(Center(portal_code=code, source_id="same-id", name=f"{code} center", client_code="goyal" if code == "pacs" else code))
            self.db.add(PortalResource(portal_code=code, resource_type="user", source_id="user-1", name=f"{code} user", center_id="same-id", enabled=code != "pacs", details={"role":"CLIENT_USER"}))
            self.db.add(ServiceEvent(portal_code=code, source_id="job_100%", client_code="goyal" if code == "pacs" else code,
                                     center_id="same-id", service="X-Ray Chest", status="SUCCESS", occurred_at=datetime(2026,11,1,tzinfo=timezone.utc), updated_at=datetime(2026,11,1,tzinfo=timezone.utc)))
        self.db.add(MarengoStudy(instance_code="custom-marengo", id="study-1", centre_id="same-id", modality="XRAY", status="SUCCESS", created_at=datetime(2026,11,1)))
        self.db.add(MarengoReportReview(instance_code="custom-marengo", id="report-1", study_id="study-1", service_name="X-Ray Chest", modality="XRAY", status="PUSHED", patient_name="Must not leave the API", output_format="PDF", created_at=datetime(2026,11,1), generated_at=datetime(2026,11,1), updated_at=datetime(2026,11,1)))
        self.db.commit()
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)
        self.sources = patch("app.operations_api.load_sources", return_value=[Source("Marengo", "marengo", "custom-marengo", "unused")])
        self.sources.start()
        self.owner = patch.dict(os.environ, {"INITIAL_ADMIN_EMAIL":"different@example.com"})
        self.owner.start()

    def tearDown(self):
        self.sources.stop()
        self.owner.stop()
        self.client.close()
        app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()

    def get(self, path, **params):
        response = self.client.get("/api/v1/command/" + path, params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_client_rollup_combines_goyal_and_pacs_without_cross_portal_center_join(self):
        result = self.get("inventory", kind="user", client="goyal")
        self.assertEqual(result["total"], 2)
        self.assertEqual({r["portal"] for r in result["items"]}, {"goyal", "pacs"})
        for row in result["items"]:
            self.assertEqual(row["centerName"], row["portal"] + " center")
        self.assertEqual(result["counts"], {"all":2,"enabled":1,"disabled":1})

    def test_status_counts_stay_scoped_when_filtering_rows(self):
        result = self.get("inventory", kind="user", client="goyal", state="disabled")
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["portal"], "pacs")
        self.assertEqual(result["counts"]["all"], 2)

    def test_literal_search_does_not_interpret_wildcards_or_sql(self):
        self.assertEqual(self.get("worklist/processing", start="2026-11-01", end="2026-11-01", q="100%", modality="X-Ray")["total"], 3)
        self.assertEqual(self.get("worklist/processing", start="2026-11-01", end="2026-11-01", q="' OR 1=1 --")["total"], 0)
        self.assertEqual(self.get("inventory", kind="user", q="% ")["total"], 0)

    def test_ist_day_boundaries_and_pagination_are_enforced(self):
        self.assertEqual(self.get("worklist/processing", portal="pacs", start="2026-11-01", end="2026-11-01")["total"], 1)
        self.assertEqual(self.get("worklist/processing", start="2026-10-31", end="2026-10-31")["total"], 0)
        self.assertEqual(self.get("inventory", kind="user", page=2)["items"], [])
        response = self.client.get("/api/v1/command/worklist/processing", params={"start":"2024-01-01","end":"2026-11-01"})
        self.assertEqual(response.status_code, 422)

    def test_clinical_snapshots_never_leak_into_other_portals_or_clients(self):
        params = {"start":"2026-11-01","end":"2026-11-01"}
        self.assertEqual(self.get("worklist/studies", portal="goyal", **params)["total"], 0)
        self.assertEqual(self.get("worklist/reports", client="goyal", **params)["total"], 0)
        reports = self.get("worklist/reports", portal="marengo", modality="X-Ray", **params)
        self.assertEqual(reports["total"], 1)
        self.assertEqual(reports["items"][0]["centerName"], "marengo center")
        self.assertNotIn("Must not leave", str(reports))
        self.assertEqual(datetime.fromisoformat(reports["items"][0]["createdAt"].replace("Z", "+00:00")).utcoffset().total_seconds(), 0)

    def test_worklists_reject_unsupported_status_and_are_read_only_for_viewers(self):
        self.assertEqual(self.client.get("/api/v1/command/worklist/studies?state=PUSHED").status_code, 422)
        self.assertEqual(self.client.post("/api/v1/command/inventory", json={}).status_code, 405)
        self.assertEqual(self.get("inventory", kind="user")["total"], 3)

    def test_source_user_tabs_use_verified_roles_and_group_membership(self):
        self.db.add_all([
            PortalResource(portal_code="marengo", resource_type="user", source_id="group-admin", name="Group admin", enabled=True, details={"role":"CLIENT_USER","clientKind":"GROUP"}),
            PortalResource(portal_code="marengo", resource_type="user", source_id="radiologist", name="Reader", enabled=True, details={"role":"RADIOLOGIST"}),
        ])
        self.db.commit()
        admins=self.get("inventory",kind="user",portal="marengo",role="GROUP_ADMIN")
        self.assertEqual([r["id"] for r in admins["items"]],["group-admin"])
        readers=self.get("inventory",kind="user",portal="marengo",role="RADIOLOGIST")
        self.assertEqual([r["id"] for r in readers["items"]],["radiologist"])

    def test_source_audit_requires_audit_permission_and_stays_in_selected_portal(self):
        for code in ("marengo","goyal"):
            self.db.add(UserActivity(portal_code=code,source_id="same-log-id",client_code=code,actor_id="actor",actor_name="Team member",action=f"{code} login",occurred_at=datetime(2026,11,1,tzinfo=timezone.utc)))
        self.db.commit()
        self.assertEqual(self.client.get("/api/v1/command/source-activity?portal=marengo").status_code,403)
        self.db.add(TeamRole(user_id=self.user.id,role="operations"))
        self.db.commit()
        result=self.get("source-activity",portal="marengo",start="2026-11-01",end="2026-11-01")
        self.assertEqual(result["total"],1)
        self.assertEqual(result["items"][0]["action"],"marengo login")

