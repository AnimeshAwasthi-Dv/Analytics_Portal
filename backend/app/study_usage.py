"""Reported study accounting. Source reads never mutate billing or clinical records."""
import hashlib
import re
from datetime import datetime, timezone

from sqlalchemy import text

REPORTED = {"APPROVED", "PUSHED", "REPORTED"}
DELIVERED = {"reported", "pacs_sent", "sent_to_pacs", "report_delivered"}
ALIASES = {"CR":"X-Ray","DX":"X-Ray","DR":"X-Ray","XR":"X-Ray","XRAY":"X-Ray","X RAY":"X-Ray",
           "CT":"CT","MR":"MRI","MRI":"MRI","MG":"Mammography","MAMMOGRAPHY":"Mammography",
           "US":"USG","USG":"USG","ULTRASOUND":"USG","PT":"PET-CT","PET CT":"PET-CT"}


def study_key(client, uid):
    # A collision-resistant, length-bounded identity; no patient identifiers in snapshots.
    return "study:"+hashlib.sha256((str(client)+"\0"+str(uid)).encode()).hexdigest()


def modality_for(modalities=(), report_modality=None, service=None):
    def normalize(value):
        return re.sub(r"[-_]+"," ",str(value or "").strip()).upper()
    established={ALIASES[v] for m in (modalities or []) if (v:=normalize(m)) in ALIASES}
    if not established and normalize(report_modality) in ALIASES:
        established.add(ALIASES[normalize(report_modality)])
    name=normalize(service)
    if "MAMMO" in name and (not established or established<={"X-Ray","Mammography"}):
        return "Mammography"
    if "SPECIAL" in name and ("XRAY" in name or "X RAY" in name):
        return "Special X-Ray" if not established or established=={"X-Ray"} else "Mixed"
    if len(established)==1:
        return next(iter(established))
    if len(established)>1:
        return "Mixed"
    for prefix,family in [("PET","PET-CT"),("MAMMO","Mammography"),("MRI","MRI"),("MR","MRI"),("CT","CT"),("USG","USG"),("ULTRASOUND","USG")]:
        if name==prefix or name.startswith(prefix+" "):
            return family
    if any(v in name for v in ("XRAY","X RAY")):
        return "X-Ray"
    return "Unclassified"


def positive(value):
    return value if isinstance(value,int) and not isinstance(value,bool) and 0<value<=2147483647 else None


def xray_views(modality, instance_count=None, processing_images=None, tariff_parts=None):
    if modality not in {"X-Ray","Special X-Ray"}:
        return None,None
    # Tariff units may be one COMPLETE STUDY; only explicit per-view breakdowns
    # establish billed views. Never use generic billing units or CT image counts.
    parts=[p for p in (tariff_parts or []) if isinstance(p,dict) and "view" in str(p.get("key","")).lower()]
    complete=any("additional" not in str(p.get("key","")).lower() for p in parts)
    if parts and complete:
        counts=[positive(p.get("units")) for p in parts]
        if all(counts) and sum(counts)<=2147483647:
            return sum(counts),"tariff_view_breakdown"
    if positive(instance_count):
        return instance_count,"dicom_image_count"
    if positive(processing_images):
        return processing_images,"processing_image_count"
    return None,None


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def study_payload(row, portal, clients, fallback_client):
    # A completed report's service identifies the performed exam. An unrelated
    # subscription/billing service must not reclassify its radiography as mammography.
    service=modality_for(row.get("modalities"),row.get("report_modality"),row.get("report_service") or row.get("job_service") or row.get("billing_service"))
    workflow=re.sub(r"[ -]+","_",str(row.get("workflow_status") or "").lower())
    reported=str(row.get("report_status") or "").upper() in REPORTED or workflow in DELIVERED
    received=utc(row["received_at"])
    reported_at=utc(row.get("reported_at") or row.get("updated_at")) if reported else None
    duration=(reported_at-utc(row.get("submitted_at") or received)).total_seconds()*1000 if reported_at else None
    views,evidence=xray_views(service,row.get("instance_count"),row.get("image_count"),row.get("tariff_parts"))
    return dict(portal_code=portal,source_id=study_key(row["client_id"],row["study_uid"]),
        source_reference=row.get("bridge_id") or "report:"+row["report_id"],client_code=clients.get(row["client_id"],fallback_client),
        center_id=row["client_id"],service=service,status="SUCCESS" if reported else "NOT_PROCESSED",
        workflow="REPORTED" if reported else "REPORTING" if row.get("job_id") or row.get("submitted_at") or row.get("report_id") else "AVAILABLE",
        view_count=views,view_source=evidence,received_at=received,reported_at=reported_at,occurred_at=reported_at or received,
        updated_at=utc(row["updated_at"]),duration_ms=duration if duration is not None and duration>=0 else None)


# Static SQL contracts. Only keyset cursors and identity arrays are bound at runtime.
CHANGES = [
    '''SELECT id,"updatedAt" AS changed_at,"clientId" AS client_id,"studyInstanceUid" AS study_uid
       FROM public.available_bridge_studies WHERE ("updatedAt",id)>(:at,:id) AND "updatedAt"<=:until ORDER BY "updatedAt",id LIMIT :limit''',
    '''SELECT id,"updatedAt" AS changed_at,"clientId" AS client_id,COALESCE(NULLIF("studyUid",''),'report:'||id) AS study_uid
       FROM public.report_reviews WHERE ("updatedAt",id)>(:at,:id) AND "updatedAt"<=:until ORDER BY "updatedAt",id LIMIT :limit''',
    '''SELECT j.id,j."updatedAt" AS changed_at,j."clientId" AS client_id,b."studyInstanceUid" AS study_uid
       FROM (SELECT * FROM public.processing_jobs WHERE ("updatedAt",id)>(:at,:id) AND "updatedAt"<=:until ORDER BY "updatedAt",id LIMIT :limit) j
       LEFT JOIN public.available_bridge_studies b ON b."processingJobId"=j.id ORDER BY j."updatedAt",j.id''',
    '''SELECT x.id,x."updatedAt" AS changed_at,x."clientId" AS client_id,COALESCE(b."studyInstanceUid",s."studyUid") AS study_uid
       FROM (SELECT * FROM public.study_billing_transactions WHERE ("updatedAt",id)>(:at,:id) AND "updatedAt"<=:until ORDER BY "updatedAt",id LIMIT :limit) x
       LEFT JOIN public.available_bridge_studies b ON b."processingJobId"=x."processingJobId"
       LEFT JOIN public.studies s ON s.id=x."studyId" ORDER BY x."updatedAt",x.id''',
]

SNAPSHOT = '''
WITH keys AS (SELECT * FROM unnest(CAST(:clients AS text[]),CAST(:uids AS text[])) AS k(client_id,study_uid))
SELECT k.client_id,k.study_uid,b.id AS bridge_id,r.id AS report_id,b.modalities,r.modality AS report_modality,
       j."serviceType" AS job_service,r."serviceName" AS report_service,x."serviceName" AS billing_service,
       b."workflowStatus" AS workflow_status,r.status AS report_status,j.id AS job_id,
       b."instanceCount" AS instance_count,j."imageCount" AS image_count,
       x.metadata->'clientTariff'->'breakdown' AS tariff_parts,
       COALESCE(b."createdAt",r."createdAt") AS received_at,b."submittedAt" AS submitted_at,
       COALESCE(r."approvedAt",r."pushedAt",r."reviewedAt",r."generatedAt",r."updatedAt",b."updatedAt") AS reported_at,
       GREATEST(b."updatedAt",r."updatedAt",j."updatedAt",x."updatedAt") AS updated_at
FROM keys k
LEFT JOIN LATERAL (
 SELECT b.id,b.modalities,b."workflowStatus",b."instanceCount",b."submittedAt",b."createdAt",b."updatedAt",b."processingJobId"
 FROM public.available_bridge_studies b WHERE b."clientId"=k.client_id AND b."studyInstanceUid"=k.study_uid
 ORDER BY CASE WHEN lower(b."workflowStatus") IN ('reported','pacs_sent','sent_to_pacs','report_delivered') THEN 0 ELSE 1 END,b."updatedAt" DESC,b.id LIMIT 1
) b ON TRUE
LEFT JOIN LATERAL (
 SELECT r.id,r."studyId",r.modality,r."serviceName",r.status,r."approvedAt",r."pushedAt",r."reviewedAt",r."generatedAt",r."createdAt",r."updatedAt"
 FROM public.report_reviews r WHERE r."clientId"=k.client_id AND (r."studyUid"=k.study_uid OR (k.study_uid LIKE 'report:%' AND r.id=substring(k.study_uid from 8) AND NULLIF(r."studyUid",'') IS NULL))
 ORDER BY CASE WHEN r.status::text IN ('APPROVED','PUSHED','REPORTED') THEN 0 ELSE 1 END,
 COALESCE(r."approvedAt",r."pushedAt",r."reviewedAt",r."generatedAt",r."createdAt") ASC,r.id LIMIT 1
) r ON TRUE
LEFT JOIN public.processing_jobs j ON j.id=b."processingJobId" AND j."clientId"=k.client_id
LEFT JOIN LATERAL (
 SELECT x."serviceName",x.metadata,x."updatedAt" FROM public.study_billing_transactions x
 WHERE x."clientId"=k.client_id AND (x."processingJobId"=j.id OR x."studyId"=r."studyId")
 ORDER BY x."updatedAt" DESC,x.id DESC LIMIT 1
) x ON TRUE
WHERE b.id IS NOT NULL OR r.id IS NOT NULL
'''


def sync_studies(src, db, portal, clients, watermark, started, upsert, batch_size=500):
    from app.command_models import StudyFact, ServiceEvent
    first=db.query(StudyFact.source_id).filter_by(portal_code=portal.code).first() is None
    since=datetime(1970,1,1,tzinfo=timezone.utc) if first else watermark
    if portal.code=="onprem":
        # On-prem currently supplies teleradiology study status, but no modality/views.
        query=db.query(ServiceEvent).filter(ServiceEvent.portal_code==portal.code,ServiceEvent.updated_at>=since)
        payload=[]
        for r in query.yield_per(batch_size):
            payload.append(dict(portal_code=portal.code,source_id=study_key(r.center_id,r.source_id),source_reference=r.source_id,
                client_code=r.client_code,center_id=r.center_id,service=r.service,status="SUCCESS" if r.status=="SUCCESS" else "NOT_PROCESSED",
                workflow="REPORTED" if r.status=="SUCCESS" else "REPORTING",view_count=None,view_source=None,
                received_at=r.occurred_at,reported_at=r.updated_at if r.status=="SUCCESS" else None,
                occurred_at=r.updated_at if r.status=="SUCCESS" else r.occurred_at,updated_at=r.updated_at,duration_ms=r.duration_ms))
            if len(payload)>=batch_size:
                upsert(db,StudyFact,payload,["portal_code","source_id"]);payload=[]
        upsert(db,StudyFact,payload,["portal_code","source_id"])
        return
    for sql in CHANGES:
        at,identity=since,""
        while True:
            changed=src.execute(text(sql),{"at":at,"id":identity,"until":started,"limit":batch_size}).mappings().all()
            if not changed:
                break
            pairs=sorted({(r["client_id"],r["study_uid"]) for r in changed if r["study_uid"]})
            if pairs:
                rows=src.execute(text(SNAPSHOT),{"clients":[c for c,u in pairs],"uids":[u for c,u in pairs]}).mappings().all()
                payload=[study_payload(r,portal.code,clients,portal.client_code) for r in rows]
                upsert(db,StudyFact,payload,["portal_code","source_id"])
            at,identity=changed[-1]["changed_at"],changed[-1]["id"]
