import os
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch,Mock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine,event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import get_db
from app.main import app
from app.models import User
from app.command_models import Center,Portal,ServiceEvent,StudyFact,UsageFact,UserActivity
from app.study_usage import modality_for,study_key,study_payload,xray_views


class StudyRulesTests(unittest.TestCase):
    def row(self,**patches):
        now=datetime(2026,11,1,6)
        row=dict(client_id="center",study_uid="1.2.3",bridge_id="bridge",report_id=None,modalities=["DX"],
                 report_modality=None,job_service="xray",job_id=None,workflow_status="Available",report_status=None,
                 received_at=now,updated_at=now,reported_at=None,instance_count=2,image_count=1)
        return {**row,**patches}

    def test_ai_and_teleradiology_reported_studies_are_successful_modality_uses(self):
        for service in ["xray","X-Ray Chest","DecXpert X-ray Suite"]:
            fact=study_payload(self.row(report_id="r",report_status="APPROVED",job_service=service,reported_at=datetime(2026,11,2)),"pacs",{"center":"goyal"},"pacs")
            self.assertEqual((fact["status"],fact["service"],fact["client_code"]),("SUCCESS","X-Ray","goyal"))
            self.assertEqual(fact["occurred_at"],fact["reported_at"])

    def test_completed_xray_report_is_not_reclassified_by_unrelated_billing_service(self):
        fact=study_payload(self.row(report_id="r",report_status="APPROVED",report_modality="DX",report_service="X-ray Suite",billing_service="Mammography"),"marengo",{},"marengo")
        self.assertEqual(fact["service"],"X-Ray")

    def test_available_reporting_and_technical_errors_remain_not_processed(self):
        for workflow,job in [("Available",None),("Processing","job"),("ProcessingFailed","job"),("SubmittedToTeleradiology","job")]:
            fact=study_payload(self.row(workflow_status=workflow,job_id=job,report_status="FAILED"),"pacs",{},"pacs")
            self.assertEqual(fact["status"],"NOT_PROCESSED")
            self.assertIsNone(fact["reported_at"])
            self.assertEqual(fact["occurred_at"],fact["received_at"])

    def test_duplicate_reports_and_jobs_share_one_study_identity(self):
        first=study_payload(self.row(report_id="report-1",job_id="job-1"),"pacs",{},"pacs")
        second=study_payload(self.row(report_id="report-2",job_id="job-2",bridge_id="other-agent"),"pacs",{},"pacs")
        self.assertEqual(first["source_id"],second["source_id"])
        self.assertNotEqual(study_key("center","1.2.3"),study_key("other-center","1.2.3"))

    def test_billing_tariff_counts_first_and_additional_views_not_study_units(self):
        parts=[{"key":"X RAY|Radiography|First view","units":1},{"key":"X RAY|Radiography|Additional view","units":2}]
        self.assertEqual(xray_views("X-Ray",1,1,parts),(3,"tariff_view_breakdown"))
        self.assertEqual(xray_views("X-Ray",3,1),(3,"dicom_image_count"))
        self.assertEqual(xray_views("X-Ray",0,2),(2,"processing_image_count"))

    def test_unknown_views_are_never_assumed_to_be_one(self):
        for value in [None,0,-1,True,"2"]:
            self.assertEqual(xray_views("X-Ray",value,None),(None,None))
        self.assertEqual(xray_views("X-Ray",None,None,[{"key":"Additional view","units":2}]),(None,None))

    def test_ct_mammography_and_mixed_studies_are_not_billed_as_xray_views(self):
        for family in ["CT","MRI","Mammography","Mixed"]:
            self.assertEqual(xray_views(family,2000,2000),(None,None))
        self.assertEqual(modality_for(["DX","CT"]),"Mixed")
        self.assertEqual(modality_for(["MG"],None,"X-ray Suite"),"Mammography")
        self.assertEqual(modality_for(["DX"],None,"Mammography"),"Mammography")
        self.assertEqual(modality_for(["CR"]),"X-Ray")
        self.assertEqual(xray_views("Special X-Ray",3,3),(3,"dicom_image_count"))

    def test_worklist_report_links_and_views_are_qualified_by_client(self):
        from app.pacs_api import Source
        source=Source.__new__(Source);source.code="pacs"
        source._clients=[{"id":"a","name":"Center A"},{"id":"b","name":"Center B"}]
        tables={"available_bridge_studies":[{"id":"a-study","clientId":"a","studyInstanceUid":"same-uid","instanceCount":1,"modalities":["DX"]},{"id":"b-study","clientId":"b","studyInstanceUid":"same-uid","instanceCount":2,"modalities":["DX"]}],
                "report_reviews":[{"id":"a-report","clientId":"a","studyUid":"same-uid","status":"APPROVED"},{"id":"b-report","clientId":"b","studyUid":"same-uid","status":"PUSHED"}],"bridge_study_attachments":[]}
        source.read=Mock(side_effect=lambda name,**options:tables.get(name,[]))
        rows=source.bridges()
        self.assertEqual([r["report"]["id"] for r in rows],["a-report","b-report"])
        self.assertEqual([r["xrayViewCount"] for r in rows],[1,2])


class StudyAnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.engine=create_engine("sqlite://",connect_args={"check_same_thread":False},poolclass=StaticPool)
        @event.listens_for(self.engine,"connect")
        def dates(connection,_):
            connection.create_function("timezone",2,lambda zone,value:(datetime.fromisoformat(value)+timedelta(hours=5,minutes=30)).strftime("%Y-%m-%d %H:%M:%S") if value else None)
            connection.create_function("to_char",2,lambda value,pattern:(value[:4]+"-01-01" if pattern=="YYYY-01-01" else value[:7]+"-01" if pattern=="YYYY-MM-01" else value[:10]) if value else None)
        for model in [User,Portal,Center,StudyFact,ServiceEvent,UsageFact,UserActivity]:
            model.__table__.create(self.engine)
        self.db=Session(self.engine)
        self.user=User(id=1,name="Analyst",email="reader@example.com",hashed_password="unused",is_active=True)
        self.db.add_all([self.user,Portal(code="pacs",name="PACS",client_code="pacs",kind="shared"),Portal(code="marengo",name="Marengo",client_code="marengo",kind="dedicated")])
        at=datetime(2026,11,1,6,tzinfo=timezone.utc)
        self.db.add_all([Center(portal_code="pacs",source_id="same-center",name="Goyal",client_code="goyal"),Center(portal_code="marengo",source_id="same-center",name="Marengo",client_code="marengo")])
        for identity,status,views,portal,service in [("r1","SUCCESS",2,"pacs","X-Ray"),("r2","SUCCESS",4,"pacs","X-Ray"),("r3","SUCCESS",None,"pacs","X-Ray"),("u1","NOT_PROCESSED",3,"pacs","X-Ray"),("ct","SUCCESS",None,"pacs","CT"),("other","SUCCESS",9,"marengo","X-Ray")]:
            self.db.add(StudyFact(portal_code=portal,source_id=identity,source_reference=identity,client_code="goyal" if portal=="pacs" else "marengo",center_id="same-center",service=service,status=status,workflow="REPORTED" if status=="SUCCESS" else "REPORTING",view_count=views,view_source="dicom_image_count" if views else None,received_at=at,reported_at=at if status=="SUCCESS" else None,occurred_at=at,updated_at=at,duration_ms=60000 if status=="SUCCESS" else 900000))
        # Failed processing attempts must not turn a study into a failed image or
        # inflate successful usage. Source debit credits are a separate metric.
        self.db.add(ServiceEvent(portal_code="pacs",source_id="failed-attempt",client_code="goyal",service="xray",status="FAILED",occurred_at=at,updated_at=at))
        self.db.add(UsageFact(portal_code="pacs",source_id="debit",client_code="goyal",service="X-Ray Chest",credits=99,success=True,occurred_at=at))
        self.db.commit()
        app.dependency_overrides[get_db]=lambda:self.db
        app.dependency_overrides[get_current_user]=lambda:self.user
        self.client=TestClient(app)
        self.roles=patch("app.permissions.role_for",return_value="viewer");self.roles.start()

    def tearDown(self):
        self.client.close();app.dependency_overrides.clear();self.roles.stop();self.db.close();self.engine.dispose()

    def analytics(self,**filters):
        result=self.client.get("/api/v1/command/analytics",params={"start":"2026-11-01","end":"2026-11-01",**filters})
        self.assertEqual(result.status_code,200,result.text)
        return result.json()

    def test_default_analytics_includes_historical_studies(self):
        historical = self.db.query(StudyFact).filter_by(source_id="r1").one()
        historical.occurred_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
        self.db.commit()
        response = self.client.get("/api/v1/command/analytics", params={"portal":"pacs"})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["totals"]["success"], 4)
        self.assertTrue(any(row["key"].startswith("2020") for row in result["daily"]))
        filtered = self.analytics(portal="pacs")
        self.assertEqual(filtered["totals"]["success"], 3)

    def test_multi_year_ranges_preserve_totals_and_use_month_buckets(self):
        response=self.client.get("/api/v1/command/analytics",params={"start":"2025-01-01","end":"2027-12-31","portal":"pacs"})
        self.assertEqual(response.status_code,200,response.text)
        result=response.json()
        self.assertEqual(result["dailyBucket"],"month")
        self.assertEqual(sum(row["success"] for row in result["daily"]),result["totals"]["success"])
        self.assertLessEqual(len(result["daily"]),36)
        response=self.client.get("/api/v1/command/analytics",params={"start":"2000-01-01","end":"2027-12-31","portal":"pacs"})
        self.assertEqual(response.status_code,200,response.text)
        result=response.json()
        self.assertEqual(result["dailyBucket"],"year")
        self.assertEqual(sum(row["success"] for row in result["daily"]),result["totals"]["success"])

    def test_successes_unprocessed_views_and_denominator_are_scoped(self):
        result=self.analytics(portal="pacs",modality="X-Ray")
        totals=result["totals"]
        self.assertEqual((totals["success"],totals["notProcessed"],totals["failed"]),(3,1,0))
        self.assertEqual((totals["xrayViews"],totals["averageXrayViews"],totals["xrayUnknownViewStudies"]),(6,3,1))
        self.assertEqual(totals["xrayAdditionalViews"],4)
        self.assertEqual(result["usage"]["credits"],99)
        self.assertEqual(totals["averageDurationMs"],60000)
        self.assertEqual(result["byCenter"][0]["name"],"Goyal")

    def test_group_totals_and_time_buckets_use_reported_usage(self):
        result=self.analytics(client="goyal")
        self.assertEqual(result["totals"]["success"],4)
        self.assertEqual(sum(d["success"] for d in result["daily"]),4)
        self.assertEqual(sum(d["success"] for d in result["hourly"]),4)
        self.assertEqual(result["peakHour"],"11")
        self.assertEqual({r["key"] for r in result["byService"]},{"X-Ray","CT"})

    def test_completion_date_counts_old_received_study_once_without_new_attempts(self):
        row=self.db.get(StudyFact,("pacs","r1"))
        row.received_at=datetime(2026,9,1,tzinfo=timezone.utc)
        self.db.commit()
        self.assertEqual(self.analytics(portal="pacs",modality="X-Ray")["totals"]["success"],3)

    def test_ist_completion_boundary_and_weighted_view_average(self):
        totals=self.analytics()["totals"]
        self.assertEqual(totals["averageXrayViews"],5)
        row=self.db.get(StudyFact,("pacs","r1"))
        row.occurred_at=datetime(2026,10,31,18,29,59,tzinfo=timezone.utc)
        self.db.commit()
        self.assertEqual(self.analytics(portal="pacs",modality="X-Ray")["totals"]["success"],2)
        row.occurred_at+=timedelta(seconds=1)
        self.db.commit()
        self.assertEqual(self.analytics(portal="pacs",modality="X-Ray")["totals"]["success"],3)

    def test_per_study_views_are_bounded_and_do_not_leak_other_portals(self):
        result=self.client.get("/api/v1/command/analytics/xray-studies",params={"portal":"pacs","start":"2026-11-01","end":"2026-11-01"})
        self.assertEqual(result.status_code,200)
        data=result.json();self.assertEqual(data["total"],4)
        self.assertTrue(all(r["portal"]=="pacs" for r in data["items"]))
        self.assertEqual({r["views"] for r in data["items"]},{None,2,3,4})
        self.assertNotIn("FAILED",str(data))

    def test_special_xray_has_views_but_remains_a_separate_endpoint_modality(self):
        donor=self.db.get(StudyFact,("pacs","r1"))
        values={column.name:getattr(donor,column.name) for column in StudyFact.__table__.columns}
        values.update(source_id="special",source_reference="special",service="Special X-Ray",view_count=3)
        self.db.add(StudyFact(**values));self.db.commit()
        special=self.analytics(portal="pacs",modality="Special X-Ray")["totals"]
        self.assertEqual((special["success"],special["xrayViews"]),(1,3))
        self.assertEqual(self.analytics(portal="pacs",modality="X-Ray")["totals"]["xrayViews"],6)
        result=self.client.get("/api/v1/command/analytics/xray-studies",params={"portal":"pacs","start":"2026-11-01","end":"2026-11-01","modality":"Special X-Ray"})
        self.assertEqual(result.json()["total"],1)
        self.assertEqual(result.json()["items"][0]["views"],3)
