"""Compatibility API for the copied Common PACS frontend.

Central authentication remains cookie based. Source reads use explicit public
field lists, bound values, capped pages and read-only source transactions.
Clinical mutations are never approximated by generic SQL updates.
"""
import csv
import io
import json
import os
from datetime import datetime, timezone
from functools import lru_cache
from hashlib import sha256
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import String, cast, column, func, or_, select, table, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.command_api import SOURCE_ENV, create_command, CommandInput, date_bounds, portals
from app.command_sync import source_engine
from app.command_models import StudyFact
from app.study_usage import study_key, modality_for, xray_views
from app.database import get_db
from app.permissions import ROLE_PERMISSIONS, role_for

router = APIRouter(prefix="/api/pacs", tags=["PACS frontend"])
CLINICAL_ROLES = {"super_admin", "operations", "support"}

# These lists are API contracts, not client-provided SQL identifiers. In
# particular user credentials, integration tokens and storage paths are absent.
PUBLIC = {
 "clients":"id code name kind parentClientId hospitalSlug facilityType primaryContact email location status studySyncEnabled autoReportingModalities billingDiscountPercent demoModeEnabled demoStudyLimit createdAt updatedAt",
 "users":"id userId name email role portalRole clientId providerCode active createdAt",
 "services":"id name code description enabled",
 "client_services":"id clientId serviceId status workflowType credits usedCredits validFrom validUntil pacsAeTitle pacsHost pacsPort outputFormat createdAt",
 "studies":"id clientId studyUid modality status createdAt patientId",
 "jobs":"id clientId studyId serviceName status attempts error latencyMs createdAt updatedAt",
 "usage_logs":"id clientId serviceName studyUid creditsUsed success message createdAt",
 "processing_jobs":"id clientId serviceType status internalJobId workflowType clinicalStatus priority providerJobId upstreamStatus imageCount uploadName error completedAt createdAt updatedAt patientId submissionRetryCount",
 "available_bridge_studies":"id publicStudyId clientId agentName studyInstanceUid patientId patientName patientSex patientAge accessionNumber studyDate studyTime studyDescription modalities institutionName referringPhysician seriesCount instanceCount totalSizeBytes clinicalIndication priority processingJobId availabilityStatus workflowStatus lastSyncedAt receivedAt submittedAt autoSubmitAt createdAt updatedAt",
 "bridge_study_attachments":"id clientId bridgeStudyId originalName mimeType sizeBytes createdAt",
 "report_reviews":"id clientId studyId radiologistId serviceName patientName patientId studyUid accession modality status aiReportJson editedReportJson outputFormat locked generatedAt pushedAt reviewedAt approvedAt createdAt updatedAt patientProfileId",
 "report_format_settings":"id clientId serviceName dicomReturnFormat outputFormat reportMode radiologistReviewEnabled includeRadiologistSignature signatureDetailFields enabledSections structuredHeaderJson",
 "radiologist_profiles":"id userId providerCode registrationNumber qualification specialization experienceYears phone active signatureName signatureDesignation createdAt updatedAt",
 "patients":"id clientId patientIdentifier name dateOfBirth age gender sex phone email address clinicalHistory medicalHistory followUpInfo createdAt updatedAt",
 "patient_follow_ups":"id clientId patientId reportId required followUpDate reason status notes assignedUserId createdAt updatedAt",
 "patient_study_archives":"id clientId patientId studyInstanceUid accessionNumber studyDate modality studyDescription bodyRegion clinicalIndication institutionName referringPhysician seriesCount instanceCount createdAt updatedAt",
 "patient_study_archive_files":"id archiveId role originalName mimeType sizeBytes createdAt",
 "radiologist_feedback":"id clientId patientId studyId reportId radiologistUserId feedbackType comment overallRating accuracyAssessment falsePositive falseNegative missedFinding incorrectFinding severity categories status internalNotes reviewedById reviewedAt renewistStatus createdAt updatedAt",
 "report_call_bookings":"id reportId clientId radiologistId slotStart slotEnd status requestedDurationMinutes actualDurationMinutes communicationMode pricePerMinuteMinor estimatedAmountMinor finalAmountMinor meetingRoom meetingUrl reason requestMessage urgency confirmedAt cancelledAt createdAt updatedAt",
 "support_tickets":"id ticketNumber clientId relatedStudyId category priority subject description status assignedTeam assignedAgentId createdByUserId firstResponseAt resolvedAt closedAt createdAt updatedAt",
 "support_ticket_messages":"id ticketId authorUserId authorRole visibility channel body createdAt",
 "demo_requests":"id requestNumber clientId name organization email phone source requestedProduct purpose status assignedUserId notes contactedAt scheduledAt completedAt createdAt updatedAt",
 "notification_outbox":"id eventType aggregateType aggregateId status attempts nextAttemptAt createdAt processedAt",
 "notification_events":"id eventType category aggregateType aggregateId clientId stage status title message occurredAt createdAt",
 "notification_deliveries":"id eventId clientId recipientUserId channel status attempts sentAt deliveredAt readAt createdAt updatedAt",
 "notification_recipients":"id name role organization clientId userId phoneE164 notificationCategories active consentStatus consentAt consentSource optOutAt verificationStatus verifiedAt lastNotificationAt accessCategories quietHours createdAt updatedAt",
 "technical_incidents":"id probeId service center detail status observedStatus openedAt lastObservedAt acknowledgedAt acknowledgedBy resolvedAt resolvedBy resolution reminderCount",
 "technical_alert_events":"id incidentId event actor detail createdAt",
 "technical_monitor_state":"id lastCheckAt lastTickAt lastError checks",
 "study_billing_transactions":"id clientId processingJobId studyId serviceName workflowType priority category units unitPriceMinor amountMinor currency status invoiceId createdAt updatedAt",
 "billing_invoices":"id clientId invoiceNumber periodStart periodEnd status subtotalMinor taxMinor totalMinor paidMinor currency createdAt updatedAt",
 "billing_disputes":"id clientId invoiceId settlementId dectrocelJobId type expectedAmountMinor appliedAmountMinor reason status resolution createdAt updatedAt",
 "audit_logs":"id clientId actorUserId action createdAt",
 "teleradiology_providers":"id code name active createdAt",
}


def native(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    if isinstance(value, dict):
        return {k: native(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [native(v) for v in value]
    return value


@lru_cache(maxsize=4)
def read_engine(url):
    return source_engine(url)


@lru_cache(maxsize=4)
def source_columns(url):
    with read_engine(url).connect() as connection:
        rows = connection.execute(text("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(:names)"), {"names": list(PUBLIC)}).all()
    result = {}
    for name, field in rows:
        result.setdefault(name, set()).add(field)
    return result


class Source:
    def __init__(self, code):
        url = os.getenv(SOURCE_ENV.get(code, ""), "")
        if code == "onprem" or not url:
            raise HTTPException(409, "This portal's PACS API connection is not configured. Select a connected portal.")
        self.columns = source_columns(url)
        self.connection = read_engine(url).connect()
        self.code = code
        self._clients = None
        self._models = {}

    def close(self):
        self.connection.close()

    def model(self, name):
        if name not in PUBLIC:
            raise HTTPException(404, "Unknown source resource.")
        if name not in self.columns:
            raise HTTPException(409, "This source schema does not provide this PACS module.")
        # Predicates and SELECT must share the same TableClause identity. Building
        # it twice introduces duplicate FROM entries for date-filtered queries.
        if not hasattr(self,"_models"):
            self._models={}
        if name not in self._models:
            self._models[name]=table(name, *(column(k) for k in PUBLIC[name].split() if k in self.columns[name]), schema="public")
        return self._models[name]

    def read(self, name, *, filters=None, q="", page=1, limit=100, cursor=None, order=None, optional=False, conditions=None, exclude=()):
        if optional and name not in self.columns:
            return []
        t = self.model(name)
        conditions = list(conditions or [])
        for key, value in (filters or {}).items():
            if key not in t.c:
                if value is not None and value != "":
                    raise HTTPException(409,"This source schema cannot apply the requested record scope.")
                continue
            if isinstance(value, list):
                conditions.append(t.c[key].in_(value))
            elif value is not None and value != "":
                conditions.append(cast(t.c[key], String) == str(value))
        if q:
            escaped = q[:120].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            terms = [cast(t.c[k], String).ilike(f"%{escaped}%", escape="\\") for k in ("id", "name", "patientName", "patientIdentifier", "patientId", "accessionNumber", "studyDescription", "subject", "comment", "action", "accession", "studyUid", "studyInstanceUid", "studyId", "processingJobId", "serviceName", "serviceType", "message", "error", "actorUserId") if k in t.c]
            if terms:
                conditions.append(or_(*terms))
        if cursor and "id" in t.c:
            conditions.append(t.c.id > cursor[:160])
        stmt = select(*(c for c in t.c if c.name not in exclude)).where(*conditions)
        sort = order or ("id" if cursor is not None else "updatedAt" if "updatedAt" in t.c else "createdAt" if "createdAt" in t.c else "id")
        if sort in t.c:
            stmt = stmt.order_by(t.c[sort] if cursor is not None else t.c[sort].desc())
        if "id" in t.c and sort != "id":
            stmt = stmt.order_by(t.c.id)
        rows = self.connection.execute(stmt.limit(min(2000, max(1, limit))).offset((min(10000, max(1, page))-1)*min(limit,2000))).mappings().all()
        return [native(dict(row)) for row in rows]

    def count(self, name, filters=None, q=""):
        t = self.model(name)
        stmt = select(func.count()).select_from(t)
        for key, value in (filters or {}).items():
            if key in t.c and value is not None and value != "":
                stmt = stmt.where(cast(t.c[key], String) == str(value))
        if q:
            escaped = q[:120].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            terms = [cast(t.c[k], String).ilike(f"%{escaped}%", escape="\\") for k in ("id", "name", "patientName", "patientIdentifier", "patientId", "accessionNumber", "studyDescription", "subject", "comment", "action", "accession", "studyUid", "studyInstanceUid", "studyId", "processingJobId", "serviceName", "serviceType", "message", "error", "actorUserId") if k in t.c]
            if terms:
                stmt = stmt.where(or_(*terms))
        return int(self.connection.execute(stmt).scalar() or 0)

    def clients(self):
        if self._clients is None:
            self._clients = self.read("clients", limit=2000)
        return {r["id"]: r for r in self._clients}

    def hydrate(self, rows):
        clients = self.clients()
        for row in rows:
            if "clientId" in row:
                c = clients.get(row["clientId"])
                row["client"] = {k: c.get(k) for k in ("id","name","code","kind")} if c else None
        return rows

    def organization(self):
        rows = list(self.clients().values())
        users = self.read("users", limit=2000)
        for row in rows:
            row["users"] = [u for u in users if u.get("clientId") == row["id"]]
            row["services"] = []
            row["processingJobs"] = []
            row["reportReviews"] = []
            row["availableBridgeStudies"] = []
            row["autoReportingModalities"] = row.get("autoReportingModalities") or []
            row["_count"] = {"childClients": sum(c.get("parentClientId")==row["id"] for c in rows)}
        # Grouped counts avoid fetching patient/report payloads for directory statistics.
        for name, key in (("available_bridge_studies","availableBridgeStudies"),("report_reviews","reportReviews")):
            if name not in self.columns:
                continue
            t = self.model(name)
            counts = dict(self.connection.execute(select(t.c.clientId,func.count()).group_by(t.c.clientId)).all())
            for row in rows:
                row["_count"][key] = int(counts.get(row["id"],0))
        return rows

    def report_rows(self, full=False, **options):
        rows = self.hydrate(self.read("report_reviews", exclude=() if full else ("aiReportJson","editedReportJson"), **options))
        for row in rows:
            row["status"] = row.get("status") or "PENDING"
            row["generatedAt"] = row.get("generatedAt") or row.get("createdAt")
            row["auditLogs"] = []
            if not full:
                # The original frontend retrieves full JSON only when a report opens.
                row.pop("aiReportJson", None)
                row.pop("editedReportJson", None)
                row["jsonPartial"] = True
        return rows

    def bridges(self, **options):
        rows = self.hydrate(self.read("available_bridge_studies", **options))
        job_ids = [r["processingJobId"] for r in rows if r.get("processingJobId")]
        jobs = {j["id"]:j for j in self.read("processing_jobs", filters={"id":job_ids},limit=500)} if job_ids else {}
        study_uids = [r.get("studyInstanceUid") for r in rows if r.get("studyInstanceUid")]
        reports = self.report_rows(filters={"studyUid":study_uids},limit=2000) if study_uids else []
        report_map={}
        for report in reports:
            key=(report.get("clientId"),report.get("studyUid"))
            current=report_map.get(key)
            if current is None or (report.get("status") in {"APPROVED","PUSHED","REPORTED"} and current.get("status") not in {"APPROVED","PUSHED","REPORTED"}):
                report_map[key]=report
        usage_db=getattr(self,"usage_db",None)
        usage={}
        if usage_db is not None and rows:
            keys=[study_key(r.get("clientId"),r.get("studyInstanceUid")) for r in rows]
            usage={f.source_id:f for f in usage_db.query(StudyFact).filter(StudyFact.portal_code==self.code,StudyFact.source_id.in_(keys)).all()}
        attachments = self.read("bridge_study_attachments", filters={"bridgeStudyId":[r["id"] for r in rows]}, limit=2000, optional=True) if rows else []
        for row in rows:
            row["modalities"] = row.get("modalities") or []
            row["lastSyncedAt"] = row.get("lastSyncedAt") or row.get("updatedAt") or row.get("createdAt")
            row["receivedAt"] = row.get("receivedAt") or row.get("createdAt") or row["lastSyncedAt"]
            row["attachments"] = [a for a in attachments if a.get("bridgeStudyId")==row["id"]]
            row["attachmentCount"] = len(row["attachments"])
            row["processingJob"] = jobs.get(row.get("processingJobId"))
            row["report"] = report_map.get((row.get("clientId"),row.get("studyInstanceUid")))
            fact=usage.get(study_key(row.get("clientId"),row.get("studyInstanceUid")))
            modality=fact.service if fact else modality_for(row["modalities"],(row["report"] or {}).get("modality"),(row["processingJob"] or {}).get("serviceType"))
            views,evidence=(fact.view_count,fact.view_source) if fact else xray_views(modality,row.get("instanceCount"),(row["processingJob"] or {}).get("imageCount"))
            row.update(usageModality=modality,xrayViewCount=views,xrayViewSource=evidence)
            row["seriesCount"] = row.get("seriesCount") or 0
            row["instanceCount"] = row.get("instanceCount") or 0
            row["totalSizeBytes"] = str(row.get("totalSizeBytes") or 0)
        return rows

    def worklist(self):
        """Load the complete slim worklist in bulk; clinical documents stay on demand."""
        b = self.model("available_bridge_studies")
        rows = self.hydrate([native(dict(r)) for r in self.connection.execute(
            select(*(c for c in b.c if c.name != "clinicalIndication")).order_by(b.c.id)
        ).mappings()])
        j = self.model("processing_jobs")
        job_fields = "id clientId serviceType status workflowType priority imageCount completedAt createdAt updatedAt".split()
        jobs = {r["id"]:native(dict(r)) for r in self.connection.execute(select(*(j.c[k] for k in job_fields if k in j.c))).mappings()}
        t = self.model("report_reviews")
        report_fields = "id clientId studyId patientName patientId studyUid accession modality serviceName status generatedAt approvedAt pushedAt reviewedAt createdAt updatedAt".split()
        reports = self.hydrate([native(dict(r)) for r in self.connection.execute(select(*(t.c[k] for k in report_fields if k in t.c))).mappings()])
        report_map = {}
        for r in sorted(reports,key=lambda r:str(r.get("updatedAt") or "")):
            key = (r.get("clientId"),r.get("studyUid"))
            prior = report_map.get(key)
            if prior is None or r.get("status") in {"APPROVED","PUSHED","REPORTED"} or prior.get("status") not in {"APPROVED","PUSHED","REPORTED"}:
                report_map[key] = {**r,"jsonPartial":True}
        usage_db = getattr(self,"usage_db",None)
        usage = {r.source_id:r for r in usage_db.query(StudyFact).filter_by(portal_code=self.code)} if usage_db is not None else {}
        for row in rows:
            job = jobs.get(row.get("processingJobId"))
            report = report_map.get((row.get("clientId"),row.get("studyInstanceUid")))
            row.update(processingJob=job,report=report,modalities=row.get("modalities") or [])
            row["receivedAt"] = row.get("receivedAt") or row.get("createdAt") or row.get("lastSyncedAt")
            row["lastSyncedAt"] = row.get("lastSyncedAt") or row.get("updatedAt") or row.get("createdAt")
            fact = usage.get(study_key(row.get("clientId"),row.get("studyInstanceUid")))
            modality = fact.service if fact else modality_for(row["modalities"],(report or {}).get("modality"),(report or {}).get("serviceName") or (job or {}).get("serviceType"))
            views,evidence = (fact.view_count,fact.view_source) if fact else xray_views(modality,row.get("instanceCount"),(job or {}).get("imageCount"))
            row.update(usageModality=modality,xrayViewCount=views,xrayViewSource=evidence)
            row["totalSizeBytes"] = str(row.get("totalSizeBytes") or 0)
        return rows


def me(user, db):
    role = role_for(user,db)
    return {"id":f"central:{user.id}","name":user.name,"email":user.email,"userId":user.email,"role":"SUPER_ADMIN",
            "active":True,"centralRole":role,"centralPermissions":sorted(ROLE_PERMISSIONS[role]),
            "deploymentFeatures":{"profile":"default","marengoMinimal":False,"billing":True,"calling":True,"notifications":True,"support":True,"dashboardPollMs":60000,"availableStudiesPollMs":60000}}


def clinical(user, db):
    if role_for(user,db) not in CLINICAL_ROLES:
        raise HTTPException(403,"Your internal team role does not include clinical record access.")


def page_value(query, key, default=1, maximum=10000):
    try:
        return max(1,min(maximum,int(query.get(key,default))))
    except (ValueError,TypeError):
        raise HTTPException(422,"Invalid pagination value.")


def overview(source, full, can_clinical):
    clients = source.organization()
    services = source.read("services", limit=500)
    subscriptions = source.read("client_services", limit=2000)
    by_service = {s["id"]:s for s in services}
    for row in subscriptions:
        row["service"] = by_service.get(row.get("serviceId"),{})
        row["creditsRemaining"] = max(0,(row.get("credits") or 0)-(row.get("usedCredits") or 0))
    for c in clients:
        c["services"] = [s for s in subscriptions if s.get("clientId")==c["id"]]
    reports = source.report_rows(limit=200) if full and can_clinical else []
    jobs = source.hydrate(source.read("processing_jobs",limit=200)) if full and can_clinical else []
    bridges = source.bridges(limit=200,cursor="") if full and can_clinical else []
    bridge_jobs = {r.get("processingJobId"):r for r in bridges if r.get("processingJobId")}
    for job in jobs:
        job["bridgeStudy"] = bridge_jobs.get(job["id"])
    profiles=source.read("radiologist_profiles",limit=500,optional=True) if full else []
    users={u["id"]:u for u in source.read("users",filters={"role":"RADIOLOGIST"},limit=2000)} if profiles else {}
    radiologists=[{**p,"user":users[p["userId"]],"reportReviews":[]} for p in profiles if p.get("userId") in users]
    return {"centralCoverage":{"reportsLoaded":len(reports),"reportsTotal":source.count("report_reviews") if full and can_clinical else 0,"jobsLoaded":len(jobs),"jobsTotal":source.count("processing_jobs") if full and can_clinical else 0},"dashboard":{"totalClients":len(clients),"activeClients":sum(c.get("status")=="ACTIVE" for c in clients),"blockedClients":sum(c.get("status")=="BLOCKED" for c in clients),"totalStudies":source.count("studies"),"failedJobs":source.count("processing_jobs",{"status":"FAILED"}),"liveJobs":source.count("processing_jobs",{"status":"PROCESSING"})},
            "clients":clients,"services":services,"jobs":source.hydrate(source.read("jobs",limit=200)) if full and can_clinical else [],"usageLogs":source.hydrate(source.read("usage_logs",limit=200)) if full and can_clinical else [],"reportSettings":source.read("report_format_settings",limit=200) if full else [],"reportReviews":reports,"radiologists":radiologists,"processingJobs":jobs,"availableBridgeStudies":bridges,"auditLogs":[]}


@router.api_route("/{portal}/{path:path}", methods=["GET","POST","PATCH","PUT","DELETE"])
async def pacs_bridge(portal: str, path: str, request: Request, db: Session=Depends(get_db), user=Depends(get_current_user)):
    if portal not in {"all","marengo","goyal","pacs","onprem"}:
        raise HTTPException(404,"Unknown portal workspace.")
    if request.method != "GET":
        return await mutation(portal,path,request,db,user)
    # Database work runs in the thread pool rather than blocking FastAPI's event loop.
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(read_bridge,portal,path,request,db,user)


def read_bridge(portal,path,request,db,user):
    q=request.query_params
    if path.startswith("v1/support/"):
        path=path[3:]
    if path == "me":
        return me(user,db)
    if path == "central/registry":
        return portals(db,user)
    if portal in {"all", "onprem"}:
        # Global mode never invents a source patient/worklist by merging clinical identities.
        if path == "admin/overview":
            return {"dashboard":{},"clients":[],"services":[],"jobs":[],"usageLogs":[],"reportSettings":[],"reportReviews":[],"radiologists":[],"processingJobs":[],"availableBridgeStudies":[]}
        if path == "client/study-sync/available-studies":
            return {"studies":[],"nextCursor":None,"asOf":datetime.now(timezone.utc)}
        if path == "admin/organization":
            return {"records":[]}
        if path == "notifications/unread-count":
            return {"count":0}
        raise HTTPException(409,"Select a portal to access its PACS records.")
    source = None
    clinical_path = path.startswith(("records","patients","follow-ups","feedback","client/study-sync","workspace/studies","admin/console/studies","reports","support","operations","notifications","workspace/analytics","workspace/billing","v1/whatsapp","quickview/","radiologist/reports/","processing-jobs/","patient-study-archives/"))
    if clinical_path and path != "notifications/unread-count":
        clinical(user,db)
    try:
        source = Source(portal)
        source.usage_db=db
        if path == "records":
            datasets = {"studies":"available_bridge_studies","reports":"report_reviews","processing":"processing_jobs","jobs":"jobs","usage":"usage_logs","billing":"study_billing_transactions","audit":"audit_logs"}
            kind = q.get("kind","studies")
            if kind not in datasets:
                raise HTTPException(422,"Choose a supported record type.")
            if kind == "audit" and "audit:read" not in ROLE_PERMISSIONS[role_for(user,db)]:
                raise HTTPException(403,"Your role does not permit source audit access.")
            name = datasets[kind]
            page = page_value(q,"page",1,10000)
            search = q.get("q","")[:120]
            rows = source.hydrate(source.read(name,page=page,limit=100,q=search,exclude=("aiReportJson","editedReportJson","upstreamStatus")))
            return {"items":rows,"total":source.count(name,q=search),"page":page,"pageSize":100,"kind":kind}
        from app.pacs_documents import pdf, download
        parts = path.split("/")
        if len(parts) >= 3 and parts[-1] in {"pdf", "download"}:
            if parts[0] == "reports" or parts[:2] in (["client","reports"], ["radiologist","reports"]):
                return pdf(source, parts[-2])
            if parts[:3] == ["client","study-sync","available-studies"]:
                return download(source, "bridge-study", parts[-2])
        if path == "reports":
            limit = page_value(q,"limit",500,500)
            rows = source.report_rows(limit=limit,cursor=q.get("cursor", ""))
            return {"reports":rows,"nextCursor":rows[-1]["id"] if len(rows)==limit else None,"total":source.count("report_reviews")}
        if path.endswith("/viewer-session") or path.startswith("quickview/"):
            clinical(user,db)
            from app.pacs_viewer import handle
            return handle(source,path,q)
        if path == "admin/overview":
            return overview(source,q.get("scope")!="dashboard",role_for(user,db) in CLINICAL_ROLES)
        if path == "admin/organization":
            return {"records":source.organization()}
        if path == "admin/clients":
            return {"clients":source.organization()}
        if path in {"admin/client-groups","workspace/clients"}:
            return {"clients":[c for c in source.organization() if c.get("kind")=="GROUP"]}
        if path == "admin/group-admins":
            clients=source.clients()
            users=source.read("users",filters={"role":"CLIENT_USER"},limit=2000)
            rows=[{**r,"client":clients.get(r.get("clientId"))} for r in users if clients.get(r.get("clientId"),{}).get("kind")=="GROUP"]
            return {"groupAdmins":rows,"admins":rows}
        if path == "admin/radiologists":
            profiles=source.read("radiologist_profiles",limit=500)
            users={u["id"]:u for u in source.read("users",filters={"role":"RADIOLOGIST"},limit=2000)}
            return {"radiologists":[{**p,"user":users.get(p.get("userId")),"reportReviews":[]} for p in profiles]}
        if path == "client/study-sync/available-studies":
            if q.get("view") == "worklist" and q.get("all") == "1":
                started = datetime.now(timezone.utc)
                rows = source.worklist()
                return {"studies":rows,"total":len(rows),"nextCursor":None,"asOf":started,"resync":True}
            limit=page_value(q,"limit",100,500)
            rows=source.bridges(limit=limit,cursor=q.get("cursor", ""))
            return {"studies":rows,"nextCursor":rows[-1]["id"] if len(rows)==limit else None,"asOf":datetime.now(timezone.utc),"resync":True}
        if path.startswith("client/study-sync/available-studies/") and len(path.split("/"))==4:
            rows=source.bridges(filters={"id":path.split("/")[-1]},limit=1)
            if not rows:
                raise HTTPException(404,"Study not found in this portal.")
            return {"study": rows[0]}
        if path.startswith("reports/") and len(path.split("/"))==2:
            rows=source.report_rows(full=True,filters={"id":path.split("/")[1]},limit=1)
            if not rows:
                raise HTTPException(404,"Report not found in this portal.")
            return rows[0]
        if path == "admin/console/studies":
            page=page_value(q,"page")
            rows=source.bridges(filters={"clientId":q.get("centerId")},q=q.get("q", ""),page=page,limit=30)
            return {"rows":[{"id":r["id"],"patient":r.get("patientName"),"patientId":r.get("patientId"),"accession":r.get("accessionNumber"),"center":(r.get("client") or {}).get("name",""),"description":r.get("studyDescription"),"modality":", ".join(r["modalities"]),"status":r.get("workflowStatus"),"jobStatus":(r.get("processingJob") or {}).get("status"),"received":r.get("receivedAt"),"updatedAt":r.get("updatedAt") or r.get("lastSyncedAt")} for r in rows],"total":source.count("available_bridge_studies",{"clientId":q.get("centerId")},q.get("q","")),"page":page,"centers":[{"id":r["id"],"name":r["name"]} for r in source.clients().values() if r.get("kind")=="CENTER"]}
        if path == "patients":
            rows=source.hydrate(source.read("patients",filters={"clientId":q.get("clientId")},q=q.get("q",""),limit=100))
            counts={}
            ids=[r["id"] for r in rows]
            for name,key,field in [("studies","studies","patientId"),("report_reviews","reports","patientProfileId"),("patient_follow_ups","followUps","patientId"),("patient_study_archives","archivedStudies","patientId")]:
                if ids and name in source.columns and field in source.columns[name]:
                    t=source.model(name)
                    counts[key]=dict(source.connection.execute(select(t.c[field],func.count()).where(t.c[field].in_(ids)).group_by(t.c[field])).all())
            for row in rows:
                row["_count"]={key:int(values.get(row["id"],0)) for key,values in counts.items()}
            return {"items":rows}
        if path.startswith("patients/") and len(path.split("/"))==2:
            rows=source.hydrate(source.read("patients",filters={"id":path.split("/")[1]},limit=1))
            if not rows:
                raise HTTPException(404,"Patient not found in this portal.")
            row=rows[0]
            archives=source.read("patient_study_archives",filters={"patientId":row["id"]},limit=100,optional=True)
            files=source.read("patient_study_archive_files",filters={"archiveId":[a["id"] for a in archives]},limit=1000,optional=True) if archives else []
            for archive in archives:
                archive["files"]=[f for f in files if f.get("archiveId")==archive["id"]]
            reports=source.report_rows(filters={"patientProfileId":row["id"]},limit=100)
            row.update(reports=reports,reportReviews=reports,followUps=source.read("patient_follow_ups",filters={"patientId":row["id"]},limit=100),archivedStudies=archives,studyArchives=archives,
                       studies=source.read("studies",filters={"patientId":row["id"]},limit=100),processingJobs=source.read("processing_jobs",filters={"patientId":row["id"]},limit=100),bridgeStudies=[])
            return row
        if path == "follow-ups":
            rows=source.hydrate(source.read("patient_follow_ups",filters={"status":q.get("status")},limit=100))
            patients={p["id"]:p for p in source.read("patients",filters={"id":[r["patientId"] for r in rows]},limit=100)} if rows else {}
            return [{**r,"patient":patients.get(r.get("patientId"))} for r in rows]
        if path == "feedback":
            rows=source.hydrate(source.read("radiologist_feedback",filters={"status":q.get("status")},q=q.get("q",""),limit=100))
            reports={r["id"]:r for r in source.report_rows(filters={"id":[r.get("reportId") for r in rows]},limit=100)} if rows else {}
            users={r["id"]:r for r in source.read("users",filters={"id":[r.get("radiologistUserId") for r in rows]},limit=100)} if rows else {}
            patients={r["id"]:r for r in source.read("patients",filters={"id":[r.get("patientId") for r in rows]},limit=100)} if rows else {}
            return [{**r,"categories":r.get("categories") or [],"report":reports.get(r.get("reportId")),"radiologist":users.get(r.get("radiologistUserId")),"patient":patients.get(r.get("patientId"))} for r in rows]
        if path.startswith("operations/"):
            name={"demo-requests":"demo_requests","call-requests":"report_call_bookings","queries":"support_tickets"}.get(path.split("/")[1])
            if name:
                rows=source.hydrate(source.read(name,limit=100))
                if name=="support_tickets":
                    return tickets(source,rows)
                return rows
        if path == "notifications/unread-count":
            return {"count":0,"note":"Central users do not impersonate source notification recipients."}
        if path == "notifications":
            events={r["id"]:r for r in source.read("notification_events",filters={"category":q.get("category")},limit=200)}
            return [{**r,"event":events[r["eventId"]]} for r in source.read("notification_deliveries",limit=100) if r.get("eventId") in events]
        if path.startswith("support") and path in {"support","support/tickets"}:
            return tickets(source,source.hydrate(source.read("support_tickets",limit=100)))
        if path == "v1/whatsapp/config":
            recipients=source.read("notification_recipients",limit=1000,optional=True)
            for row in recipients:
                row["notificationCategories"]=row.get("notificationCategories") or []
                row["accessCategories"]=row.get("accessCategories") or []
            outbox=source.read("notification_outbox",limit=100,optional=True)
            summary={"pendingCount":0,"sentCount":0,"failedCount":0}
            if "notification_outbox" in source.columns:
                t=source.model("notification_outbox")
                counts=dict(source.connection.execute(select(t.c.status,func.count()).group_by(t.c.status)).all())
                summary={"pendingCount":sum(v for k,v in counts.items() if k in {"PENDING","PROCESSING","RETRY"}),"sentCount":sum(v for k,v in counts.items() if k in {"SENT","PROCESSED","COMPLETED"}),"failedCount":sum(v for k,v in counts.items() if k in {"FAILED","DEAD"})}
            return {"physicianReportReady":False,"physicianReportTemplateName":"","callRequests":[],"cloudApiEnabled":False,"demoMode":False,"hasCloudApiToken":False,"hasPhoneNumberId":False,"hasWebhookVerifyToken":False,"hasAppSecret":False,"hasUtilityTemplate":False,"outboundReady":False,"webhookUrl":"","commandExample":"","recipients":recipients,"outbox":outbox,"summary":summary,"connectionNote":"Source recipient directory connected. Messaging runtime credentials are not configured in central command."}
        if path in {"whatsapp/recipients","notification-recipients","v1/whatsapp/recipients"}:
            return source.hydrate(source.read("notification_recipients",limit=100))
        if path == "technical-alerts":
            rows=source.read("technical_incidents",filters={"status":q.get("status")},page=page_value(q,"page"),limit=50)
            states=source.read("technical_monitor_state",limit=1)
            state=states[0] if states else {}
            return {"rows":rows,"total":source.count("technical_incidents",{"status":q["status"]}) if q.get("status") else source.count("technical_incidents"),"page":page_value(q,"page"),"monitor":{"enabled":bool(states),"telegramConfigured":False,"lastCheckAt":state.get("lastCheckAt"),"lastTickAt":state.get("lastTickAt"),"lastError":state.get("lastError")}}
        if path.startswith("technical-alerts/") and path.endswith("/events"):
            return source.read("technical_alert_events",filters={"incidentId":path.split("/")[1]},limit=100)
        if path == "admin/console/evidence":
            if "audit:read" not in ROLE_PERMISSIONS[role_for(user,db)]:
                raise HTTPException(403,"Your role does not permit audit access.")
            if q.get("studyId"):
                raise HTTPException(409,"Per-study integration evidence requires the original PACS API connection. Organization audit records have not been substituted.")
            try:
                start=datetime.fromisoformat(q["from"]).date() if q.get("from") else None
                end=datetime.fromisoformat(q["to"]).date() if q.get("to") else None
            except ValueError:
                raise HTTPException(422,"Use valid ISO dates for the evidence range.")
            lower,upper,_,_=date_bounds(start,end)
            t=source.model("audit_logs")
            predicates=[t.c.createdAt>=lower.replace(tzinfo=None),t.c.createdAt<upper.replace(tzinfo=None)]
            if q.get("source") and q["source"]!=portal:
                predicates.append(t.c.id.is_(None))
            search=q.get("q","")
            if search:
                escaped=search[:120].replace("\\","\\\\").replace("%","\\%").replace("_","\\_")
                predicates.append(or_(cast(t.c.action,String).ilike(f"%{escaped}%",escape="\\"),cast(t.c.id,String).ilike(f"%{escaped}%",escape="\\")))
            total=int(source.connection.execute(select(func.count()).select_from(t).where(*predicates)).scalar() or 0)
            rows=source.read("audit_logs",conditions=predicates,page=page_value(q,"page"),limit=2000 if q.get("format")=="csv" else 50)
            if q.get("format")=="csv":
                stream=io.StringIO();writer=csv.writer(stream);writer.writerow(["id","timestampUTC","portal","actorId","action"])
                for row in rows:
                    writer.writerow([safe_csv(row.get(k)) for k in ("id","createdAt")] + [portal,safe_csv(row.get("actorUserId")),safe_csv(row.get("action"))])
                return Response(stream.getvalue(),media_type="text/csv",headers={"Content-Disposition":"attachment; filename=source-audit.csv"})
            users={u["id"]:u for u in source.read("users",limit=2000)}
            return {"rows":[{"id":r["id"],"at":r["createdAt"],"source":portal,"action":r["action"],"actor":users.get(r.get("actorUserId"),{}).get("name","System"),"actorId":r.get("actorUserId"),"exportSha256":sha256(json.dumps(r,default=str,sort_keys=True).encode()).hexdigest(),"details":r} for r in rows],"total":total,"page":page_value(q,"page"),"sources":[portal],"statuses":[],"study":None}
        if path == "workspace/healthcheck":
            return {"rows":[{"id":portal,"service":"PACS source database","center":"All authorized centers","status":"Healthy","detail":"Read-only database connection verified; portal runtime uptime is not measured.","observedAt":datetime.now(timezone.utc)}],"updatedAt":datetime.now(timezone.utc)}
        if path.startswith("workspace/analytics") or path.startswith("workspace/billing"):
            raise HTTPException(409,"Use the central Analytics tab for measured service usage. Source billing and clinical statistics require the original PACS API connection.")
        raise HTTPException(409,"This PACS action requires its original service integration. No source changes were made.")
    except SQLAlchemyError:
        raise HTTPException(503,"The selected portal database could not serve this PACS module. Check its connection and schema.")
    finally:
        if source:
            source.close()


async def mutation(portal,path,request,db,user):
    parts=path.split("/")
    if parts[-1] == "public-share" and (parts[0] == "reports" or parts[:3] == ["client","study-sync","available-studies"]):
        clinical(user, db)
        from app.pacs_documents import create_share, PublicShare
        kind = "report" if parts[0] == "reports" else "bridge-study"
        identity = parts[-2]
        if request.method == "DELETE":
            from app.command_api import audit
            db.query(PublicShare).filter_by(portal_code=portal,kind=kind,target_id=identity).delete(synchronize_session=False)
            audit(db,user,"share.revoked",f"{portal}/{kind}/{identity}",{})
            db.commit()
            return {"revoked":True}
        if request.method == "POST":
            body = await request.json()
            source = Source(portal)
            try:
                return create_share(source,kind,identity,body.get("includeViewer",False) if kind=="report" else True,request,db,user)
            finally:
                source.close()
    if "portals:control" not in ROLE_PERMISSIONS[role_for(user,db)]:
        raise HTTPException(403,"Your team role does not permit portal changes.")
    parts=path.split("/")
    # Preserve the worker's validated absolute-state controls and mandatory audit reason.
    if request.method=="PATCH" and len(parts)==4 and parts[0]=="admin" and parts[1] in {"clients","group-admins","radiologists"} and parts[3]=="status":
        body=await request.json()
        reason=body.get("reason","")
        if len(reason.strip())<8:
            raise HTTPException(422,"Provide an operational reason of at least eight characters. No change has been queued.")
        action="center_access" if parts[1]=="clients" else "user_access"
        enabled=body.get("status")=="ACTIVE" if action=="center_access" else body.get("active")
        if not isinstance(enabled,bool):
            raise HTTPException(422,"Choose a valid desired access state.")
        result=create_command(portal,CommandInput(action=action,targetId=parts[2],enabled=enabled,reason=reason,requestKey=body.get("requestKey") or str(uuid4())),db,user)
        return {**result,"message":"Access change queued for source application; refresh to verify its observed state."}
    raise HTTPException(409,"This workflow needs the original PACS service integration. The central workspace has not changed source data.")


def tickets(source,rows):
    messages=source.read("support_ticket_messages",filters={"ticketId":[r["id"] for r in rows]},limit=2000,optional=True) if rows else []
    for row in rows:
        row["messages"]=[m for m in messages if m.get("ticketId")==row["id"]]
    return rows



def safe_csv(value):
    rendered=str(value) if value is not None else ""
    return "'"+rendered if rendered.lstrip().startswith(("=","+","-","@")) else rendered
