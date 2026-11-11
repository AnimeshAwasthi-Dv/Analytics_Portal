"""Read-only source documents and centrally stored, expiring public capabilities."""
import base64
import hashlib
import io
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse, JSONResponse
from fastapi.encoders import jsonable_encoder
from sqlalchemy import Boolean, Column, DateTime, Integer, String

from app.database import Base, get_db


class PublicShare(Base):
    __tablename__ = "command_public_shares"
    token_hash = Column(String(64), primary_key=True)
    portal_code = Column(String(50), nullable=False, index=True)
    target_id = Column(String(180), nullable=False)
    kind = Column(String(20), nullable=False)
    include_viewer = Column(Boolean, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_by = Column(Integer, nullable=False)


public_router = APIRouter(prefix="/api/public/reports", tags=["Shared documents"])
PRIVATE = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}


def report(source, identity):
    rows = source.report_rows(full=True, filters={"id": identity}, limit=1)
    if not rows:
        raise HTTPException(404, "Report not found in this portal.")
    return rows[0]


def signed_document(source, payload, variant="with-letterhead", format="pdf"):
    """Read the original provider file, never the placeholder report HTML."""
    import boto3
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError, ClientError
    from app.pacs_viewer import config, local_file
    if variant not in {"with-letterhead", "without-letterhead"} or format not in {"pdf", "docx"}:
        raise HTTPException(422, "Unsupported report version.")
    files = payload.get("signedReportFiles") or (payload.get("renewist") or {}).get("signedFiles") or {}
    key = ("withoutLetterheadPdf" if variant == "without-letterhead" else "pdf") if format == "pdf" else "docx"
    file = files.get(key)
    if not file:
        raise HTTPException(404, "This signed report version is not available from Renewist.")
    location = file.get("storage") or {}
    cfg = config(source.code)
    local = local_file(location.get("localPath") or file.get("path"), [r for r in cfg.get("UPLOAD_ROOTS", "").split(";") if r])
    limit = 32 * 1024 * 1024
    if local:
        if local.stat().st_size > limit:
            raise HTTPException(413, "Signed report exceeds the document size limit.")
        data = local.read_bytes()
    else:
        buckets = {v for k,v in cfg.items() if k.startswith("S3_") and k.endswith("_BUCKET") and v}
        if location.get("bucket") not in buckets or not location.get("key"):
            raise HTTPException(404, "Signed report is not available in connected storage.")
        if not cfg.get("S3_ACCESS_KEY_ID") or not cfg.get("S3_SECRET_ACCESS_KEY"):
            raise HTTPException(503, "Report storage credentials are not configured for this portal.")
        client = boto3.client("s3", aws_access_key_id=cfg["S3_ACCESS_KEY_ID"], aws_secret_access_key=cfg["S3_SECRET_ACCESS_KEY"],
            region_name=cfg.get("S3_REPORT_REGION") or cfg.get("S3_REGION", "us-east-1"), endpoint_url=cfg.get("S3_ENDPOINT") or None,
            config=Config(connect_timeout=4, read_timeout=12, retries={"max_attempts":1}, s3={"addressing_style":"path" if cfg.get("S3_FORCE_PATH_STYLE")=="true" else "auto"}))
        try:
            obj = client.get_object(Bucket=location["bucket"], Key=location["key"])
            body = obj["Body"]
            try:
                if obj.get("ContentLength", 0) > limit:
                    raise HTTPException(413, "Signed report exceeds the document size limit.")
                data = body.read(limit + 1)
            finally:
                body.close()
        except (BotoCoreError, ClientError):
            raise HTTPException(503, "The signed report could not be retrieved from source storage.") from None
    if len(data) > limit:
        raise HTTPException(413, "Signed report exceeds the document size limit.")
    if format == "pdf" and not data.startswith(b"%PDF-"):
        raise HTTPException(502, "The source signed report is not a valid PDF.")
    mime = "application/pdf" if format == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return Response(data, media_type=mime, headers={**PRIVATE, "Content-Disposition": f'inline; filename="signed-report.{format}"'})


def pdf(source, identity, variant="with-letterhead", format="pdf"):
    from urllib.request import urlopen
    row = report(source, identity)
    payload = row.get("editedReportJson") or row.get("aiReportJson") or {}
    if isinstance(payload, dict) and (payload.get("renewist") or payload.get("signedReportFiles")):
        return signed_document(source, payload, variant, format)
    if format != "pdf":
        raise HTTPException(404, "This report has no original Word document.")
    html = payload.get("htmlReport") if isinstance(payload, dict) else None
    if not html:
        raise HTTPException(404, "This report has no printable document.")
    from weasyprint import HTML
    # Source HTML cannot use the PDF renderer to access server files or internal URLs.
    def fetch(url, *args, **kwargs):
        if not url.startswith("data:"):
            raise ValueError("External document resources are disabled")
        with urlopen(url) as response:
            return {"string":response.read(), "mime_type":response.headers.get_content_type(), "redirected_url":url}
    data = HTML(string=html, url_fetcher=fetch).write_pdf()
    return Response(data, media_type="application/pdf", headers={**PRIVATE, "Content-Disposition": 'inline; filename="report.pdf"'})


def download(source, kind, identity):
    from app.pacs_viewer import resolve, storage
    bridge, job = resolve(source, kind, identity)
    location = storage(source, bridge, job)
    if "local" in location:
        from fastapi.responses import FileResponse
        return FileResponse(location["local"], filename="study.zip", headers=PRIVATE)
    obj = location["s3"].get_object(Bucket=location["bucket"], Key=location["key"])
    body = obj["Body"]
    def chunks():
        try:
            for chunk in body.iter_chunks(chunk_size=1024 * 1024):
                yield chunk
        finally:
            body.close()
    return StreamingResponse(chunks(), media_type="application/zip", headers={**PRIVATE, "Content-Disposition": 'attachment; filename="study.zip"'})


def create_share(source, kind, identity, include_viewer, request, db, user):
    import qrcode
    if kind == "report":
        row = report(source, identity)
        if row.get("status") not in {"APPROVED", "PUSHED", "REPORTED"}:
            raise HTTPException(409, "Only completed reports can be shared.")
    else:
        from app.pacs_viewer import resolve
        resolve(source, kind, identity)
    raw = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=7)
    db.add(PublicShare(token_hash=hashlib.sha256(raw.encode()).hexdigest(), portal_code=source.code,
                       target_id=identity, kind=kind, include_viewer=bool(include_viewer), expires_at=expires, created_by=user.id))
    from app.command_api import audit
    audit(db, user, "share.created", f"{source.code}/{kind}/{identity}", {"includeViewer":bool(include_viewer), "expiresAt":expires.isoformat()})
    db.commit()
    origin = os.getenv("PUBLIC_APP_URL") or str(request.base_url).rstrip("/")
    url = origin.rstrip("/") + "/shared/" + raw
    image = qrcode.make(url); out = io.BytesIO(); image.save(out, format="PNG")
    return {"token":raw, "expiresAt":expires, "url":url, "qr":"data:image/png;base64,"+base64.b64encode(out.getvalue()).decode()}


@public_router.get("/{token}/{rest:path}")
@public_router.get("/{token}")
def shared(token: str, request: Request, rest: str = "", db=Depends(get_db)):
    from app.pacs_api import Source
    from app.pacs_viewer import handle
    share = db.get(PublicShare, hashlib.sha256(token.encode()).hexdigest())
    if not share or share.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
        raise HTTPException(404, "This share link has expired or was revoked.")
    source = Source(share.portal_code)
    prefix = f"/api/public/reports/{token}"
    try:
        if not rest:
            if share.kind == "report":
                row = report(source, share.target_id)
                return JSONResponse(jsonable_encoder({**{key:row.get(key) for key in ("id","patientName","patientId","modality","serviceName","updatedAt","generatedAt","status")}, "includeViewer":share.include_viewer, "jsonPartial":False}),headers=PRIVATE)
            return JSONResponse({"id":share.target_id, "includeViewer":True, "studyOnly":True, "patientName":"Shared study"},headers=PRIVATE)
        if rest == "pdf" and share.kind == "report":
            return pdf(source, share.target_id, request.query_params.get("variant", "with-letterhead"), request.query_params.get("format", "pdf"))
        if not share.include_viewer:
            raise HTTPException(403, "This link includes the report only.")
        if rest == "download":
            return download(source, share.kind, share.target_id)
        if rest == "viewer-session":
            route = "reports" if share.kind == "report" else "client/study-sync/available-studies"
            result = handle(source, f"{route}/{share.target_id}/viewer-session", request.query_params)
            if isinstance(result, Response):
                import json
                result = json.loads(result.body)
            if isinstance(result, dict) and result.get("quickViewUrl"):
                result["quickViewUrl"] = prefix + "/quickview"
            return JSONResponse(jsonable_encoder(result),headers=PRIVATE)
        if rest.startswith("quickview/"):
            # The capability fixes both the portal and target; never accept another target in the URL.
            return handle(source, f"quickview/{share.kind}/{share.target_id}/{rest[len('quickview/'):]}", request.query_params)
        raise HTTPException(404, "Shared document action not found.")
    finally:
        source.close()
