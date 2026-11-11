import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.auth import get_current_user
from app.database import get_db
from app.main import app
from app.pacs_api import PUBLIC, Source, native, safe_csv


class PacsAccessTests(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[get_db] = lambda: Mock()
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1,name="Internal user",email="user@example.com")
        self.client=TestClient(app)
        self.role=patch("app.pacs_api.role_for",return_value="viewer").start()
        self.source=patch("app.pacs_api.Source").start()

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        patch.stopall()

    def test_viewer_cannot_access_clinical_records_even_with_source_ui_role(self):
        for path in ["records","patients","reports/r1","follow-ups","feedback","client/study-sync/available-studies","client/study-sync/available-studies/study-1","admin/console/studies","operations/queries","notifications","v1/support/tickets","v1/whatsapp/config","reports/r1/viewer-session","quickview/bridge-study/s1/manifest","quickview/bridge-study/s1/instances/0","quickview/bridge-study/s1/export","processing-jobs/j1/viewer-session","patient-study-archives/a1/viewer-session","radiologist/reports/r1/viewer-session"]:
            with self.subTest(path=path):
                self.assertEqual(self.client.get("/api/pacs/marengo/"+path).status_code,403)
        self.source.assert_not_called()

    def test_unknown_portal_cannot_choose_a_connection(self):
        self.assertEqual(self.client.get("/api/pacs/arbitrary/me").status_code,404)
        self.source.assert_not_called()

    def test_pacs_patch_preflight_is_allowed_from_local_frontend(self):
        response=self.client.options("/api/pacs/marengo/admin/clients/c1/status",headers={"Origin":"http://127.0.0.1:5173","Access-Control-Request-Method":"PATCH","Access-Control-Request-Headers":"content-type"})
        self.assertEqual(response.status_code,200)
        self.assertIn("PATCH",response.headers["access-control-allow-methods"])

    def test_global_boot_does_not_read_a_clinical_source(self):
        for portal in ["all","onprem"]:
            for path in ["admin/overview","admin/organization","notifications/unread-count"]:
                self.assertEqual(self.client.get(f"/api/pacs/{portal}/{path}").status_code,200)
        self.source.assert_not_called()

    def test_unsupported_writes_never_open_source_or_queue_a_command(self):
        self.role.return_value="operations"
        with patch("app.pacs_api.create_command") as command:
            self.assertEqual(self.client.post("/api/pacs/marengo/patients",json={"name":"Patient"}).status_code,409)
            self.assertEqual(self.client.patch("/api/pacs/marengo/admin/clients/c1/status",json={"status":"BLOCKED"}).status_code,422)
            command.assert_not_called()
        self.source.assert_not_called()

    def test_viewer_cannot_change_source_access(self):
        self.assertEqual(self.client.patch("/api/pacs/marengo/admin/clients/c1/status",json={"status":"BLOCKED","reason":"Routine change"}).status_code,403)
        self.source.assert_not_called()

    def test_queries_use_actual_support_ticket_table_and_hydrate_messages(self):
        self.role.return_value="operations"
        source=self.source.return_value
        source.read.side_effect=[[{"id":"ticket-1","subject":"Query"}],[{"id":"message-1","ticketId":"ticket-1","body":"Message"}]]
        source.hydrate.side_effect=lambda rows:rows
        response=self.client.get("/api/pacs/marengo/operations/queries")
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()[0]["messages"][0]["id"],"message-1")
        self.assertEqual(source.read.call_args_list[0].args[0],"support_tickets")
        source.close.assert_called_once()

    def test_study_drawer_reads_one_source_study_with_view_evidence(self):
        self.role.return_value="operations"
        source=self.source.return_value
        source.bridges.return_value=[{"id":"study-1","xrayViewCount":3,"xrayViewSource":"tariff_view_breakdown"}]
        result=self.client.get("/api/pacs/pacs/client/study-sync/available-studies/study-1")
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json()["study"]["xrayViewCount"],3)
        source.bridges.assert_called_once_with(filters={"id":"study-1"},limit=1)
        source.close.assert_called_once()


class SourceQueryTests(unittest.TestCase):
    def test_bulk_worklist_keeps_all_rows_and_center_qualified_report_links(self):
        source=Source.__new__(Source)
        source.code="marengo"
        source.columns={name:set(fields.split()) for name,fields in PUBLIC.items()}
        source._clients=[{"id":"a","name":"A"},{"id":"b","name":"B"}]
        source.connection=Mock()
        bridges=[{"id":str(i),"clientId":"a" if i%2 else "b","studyInstanceUid":"shared-uid","modalities":["DX"],"instanceCount":2} for i in range(801)]
        reports=[{"id":"ra","clientId":"a","studyUid":"shared-uid","status":"APPROVED","serviceName":"X-ray Suite"},{"id":"rb","clientId":"b","studyUid":"shared-uid","status":"APPROVED","serviceName":"X-ray Suite"}]
        outputs=[]
        for rows in (bridges,[],reports):
            result=Mock();result.mappings.return_value=iter(rows);outputs.append(result)
        source.connection.execute.side_effect=outputs
        rows=source.worklist()
        self.assertEqual(len(rows),801)
        self.assertTrue(all(row["report"]["clientId"]==row["clientId"] for row in rows))
        self.assertEqual(source.connection.execute.call_count,3)
        for call in source.connection.execute.call_args_list:
            query=str(call.args[0])
            for forbidden in ('"upstreamStatus"','"aiReportJson"','"editedReportJson"','"clinicalIndication"'):
                self.assertNotIn(forbidden,query)

    def setUp(self):
        self.source=Source.__new__(Source)
        self.source.columns={name:set(fields.split()) for name,fields in PUBLIC.items()}
        self.source.connection=Mock()
        self.source.connection.execute.return_value.mappings.return_value.all.return_value=[]

    def test_literal_search_and_identity_are_bound_and_page_size_is_capped(self):
        needle="%' OR 1=1 --"
        self.source.read("available_bridge_studies",q=needle,filters={"clientId":"other' OR 1=1"},limit=900000,page=200000)
        statement=self.source.connection.execute.call_args.args[0]
        compiled=statement.compile(dialect=postgresql.dialect())
        self.assertNotIn(needle,str(compiled))
        self.assertNotIn("other'",str(compiled))
        self.assertIn("other' OR 1=1",compiled.params.values())
        self.assertIn(2000,compiled.params.values())
        self.assertTrue(any("\\%" in v for v in compiled.params.values() if isinstance(v,str)))

    def test_study_cursor_is_bound_with_stable_ascending_order(self):
        self.source.read("available_bridge_studies",cursor="last-id")
        compiled=self.source.connection.execute.call_args.args[0].compile(dialect=postgresql.dialect())
        self.assertIn("last-id",compiled.params.values())
        self.assertIn("ORDER BY public.available_bridge_studies.id",str(compiled))

    def test_date_predicates_share_table_identity_without_a_cross_join(self):
        t=self.source.model("audit_logs")
        self.source.read("audit_logs",conditions=[t.c.createdAt>=datetime(2026,11,1)])
        statement=self.source.connection.execute.call_args.args[0]
        self.assertEqual(len(statement.get_final_froms()),1)

    def test_missing_scope_column_is_rejected_instead_of_broadening_records(self):
        from fastapi import HTTPException
        self.source.columns["report_reviews"].remove("patientProfileId")
        with self.assertRaises(HTTPException) as caught:
            self.source.read("report_reviews",filters={"patientProfileId":"patient-1"})
        self.assertEqual(caught.exception.status_code,409)
        self.source.connection.execute.assert_not_called()

    def test_list_queries_do_not_select_full_report_json(self):
        self.source.read("report_reviews",exclude=("aiReportJson","editedReportJson"))
        rendered=str(self.source.connection.execute.call_args.args[0])
        self.assertNotIn("aiReportJson",rendered)
        self.assertNotIn("editedReportJson",rendered)
        self.assertIn("patientName",rendered)

    def test_credentials_are_excluded_from_source_contract(self):
        for fields in PUBLIC.values():
            for field in fields.split():
                self.assertNotIn(field.lower(),{"password","passwordhash","hashed_password","lastgeneratedpassword","token","secret","storagepath"})

    def test_read_engine_normalizes_prisma_options_and_enforces_read_only(self):
        from app.command_sync import source_engine
        with patch("app.command_sync.create_engine") as create:
            source_engine("postgresql://example:password@localhost/db?schema=public&sslmode=require")
            url=create.call_args.args[0]
            self.assertNotIn("schema",url.query)
            self.assertEqual(url.query["sslmode"],"require")
            self.assertIn("default_transaction_read_only=on",create.call_args.kwargs["connect_args"]["options"])

    def test_timestamps_and_csv_are_safe_for_consumers(self):
        self.assertEqual(native(datetime(2026,11,1)).tzinfo,timezone.utc)
        self.assertEqual(safe_csv("=formula"),"'=formula")
        self.assertEqual(safe_csv("normal action"),"normal action")

    def test_explicit_shared_client_mapping_includes_group_audit_actions(self):
        from app.command_sync import mapped_clients
        result=mapped_clients({"center":"pacs:center"},"pacs",{"pacs:center":"goyal","pacs:group":"goyal","marengo:other":"marengo"})
        self.assertEqual(result,{"center":"goyal","group":"goyal"})
