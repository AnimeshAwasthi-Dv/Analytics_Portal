"""Authorized archive reads for the original PACS QuickView and external viewer.

Storage locations come only from the selected source record and server config.
Nothing starts the PACS ingestion, reporting or notification workers.
"""
import io
import os
from concurrent.futures import ThreadPoolExecutor
import tempfile
import threading
import time
import zipfile
from collections import OrderedDict
from pathlib import Path
from urllib.parse import urlsplit

import boto3
import numpy as np
import pydicom
import httpx
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image
from pydicom.pixels import apply_voi_lut
from sqlalchemy import column, select, table

MAX_BYTES = 256 * 1024 * 1024
MAX_INSTANCES = 500
HEADERS = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
_cache = OrderedDict()
_lock = threading.RLock()
_imports = {}
_storage_locations = {}
_bucket_names = {}


def config(code):
    prefix = code.upper() + "_VIEWER_"
    return {key[len(prefix):]: value for key, value in os.environ.items() if key.startswith(prefix)}


def private_row(source, name, fields, **filters):
    # Identifiers are internal constants; record IDs are bound SQL parameters.
    columns = source.columns.get(name, set())
    if not columns or any(key not in columns for key in filters):
        return None
    t = table(name, *(column(k) for k in fields.split() if k in columns), schema="public")
    row = source.connection.execute(select(t).where(*(t.c[k] == v for k, v in filters.items())).limit(1)).mappings().first()
    return dict(row) if row else None


def resolve(source, kind, identity):
    bridge = job = None
    uid = client = None
    if kind == "bridge-study":
        bridge = private_row(source, "available_bridge_studies", "id clientId publicStudyId studyInstanceUid archivePath archiveName modalities processingJobId totalSizeBytes", id=identity)
        if bridge:
            uid, client = bridge.get("studyInstanceUid"), bridge.get("clientId")
    elif kind in {"report", "radiologist-report"}:
        report = private_row(source, "report_reviews", "id clientId studyUid aiReportJson editedReportJson", id=identity)
        if report:
            uid, client = report.get("studyUid"), report.get("clientId")
            for value in [report.get("editedReportJson"), report.get("aiReportJson")]:
                job_id = value.get("processingJob", {}).get("id") if isinstance(value, dict) and isinstance(value.get("processingJob"), dict) else None
                if job_id:
                    job = private_row(source, "processing_jobs", "id clientId uploadPath uploadName upstreamStatus serviceType", id=job_id, clientId=client)
                    if job:
                        break
            if uid:
                bridge = private_row(source, "available_bridge_studies", "id clientId publicStudyId studyInstanceUid archivePath archiveName modalities processingJobId totalSizeBytes", clientId=client, studyInstanceUid=uid)
    elif kind == "job":
        job = private_row(source, "processing_jobs", "id clientId uploadPath uploadName upstreamStatus serviceType", id=identity)
        if job:
            bridge = private_row(source, "available_bridge_studies", "id clientId publicStudyId studyInstanceUid archivePath archiveName modalities processingJobId totalSizeBytes", processingJobId=identity)
    elif kind == "archive":
        archive = private_row(source, "patient_study_archives", "id clientId studyInstanceUid modality", id=identity)
        if not archive:
            raise HTTPException(404, "Archived study not found in this portal.")
        uid, client = archive.get("studyInstanceUid"), archive.get("clientId")
        bridge = private_row(source, "available_bridge_studies", "id clientId publicStudyId studyInstanceUid archivePath archiveName modalities processingJobId totalSizeBytes", clientId=client, studyInstanceUid=uid) if uid else None
        if not bridge:
            f = private_row(source, "patient_study_archive_files", "id archiveId role filePath originalName", archiveId=identity, role="STUDY")
            if f:
                bridge = {"id": identity, "clientId": client, "studyInstanceUid": uid, "archivePath": f.get("filePath"), "archiveName": f.get("originalName"), "modalities": [archive.get("modality")]}
    else:
        raise HTTPException(404, "Unknown viewer resource.")
    if bridge and bridge.get("processingJobId") and not job:
        job = private_row(source, "processing_jobs", "id clientId uploadPath uploadName upstreamStatus serviceType", id=bridge["processingJobId"], clientId=bridge["clientId"])
    if not bridge and not job:
        raise HTTPException(404, "Study or its DICOM archive was not found in this portal.")
    return bridge or {}, job or {}


def local_file(candidate, roots):
    if not candidate or str(candidate).startswith("s3://"):
        return None
    normalized = str(candidate).replace("\\", "/")
    suffix = normalized.lower().rfind("/uploads/")
    for root in roots:
        root = Path(root).resolve()
        for path in [Path(candidate), *([root / normalized[suffix + 9:]] if suffix >= 0 else [])]:
            path = path.resolve()
            if path.is_relative_to(root) and path.is_file():
                return path
    return None


def storage(source, bridge, job):
    cfg = config(source.code)
    roots = [r for r in cfg.get("UPLOAD_ROOTS", "").split(";") if r]
    for candidate in [bridge.get("archivePath"), job.get("uploadPath")]:
        local = local_file(candidate, roots)
        if local:
            if local.stat().st_size > MAX_BYTES:
                raise HTTPException(413, "This study exceeds the in-app viewer limit. Open the full viewer.")
            return {"local": local}
    if not cfg.get("S3_ACCESS_KEY_ID") or not cfg.get("S3_SECRET_ACCESS_KEY"):
        raise HTTPException(503, "DICOM storage credentials are not configured for this portal.")
    s3 = boto3.client("s3", aws_access_key_id=cfg["S3_ACCESS_KEY_ID"], aws_secret_access_key=cfg["S3_SECRET_ACCESS_KEY"],
        region_name=cfg.get("S3_REGION", "us-east-1"), endpoint_url=cfg.get("S3_ENDPOINT") or None,
        config=Config(connect_timeout=4, read_timeout=12, retries={"max_attempts": 1}, s3={"addressing_style": "path" if cfg.get("S3_FORCE_PATH_STYLE") == "true" else "auto"}))
    buckets = list(dict.fromkeys(v for k, v in cfg.items() if k.startswith("S3_") and k.endswith("_BUCKET")))
    modality = target_modalities(bridge, job)
    preferred = cfg.get("S3_CT_STUDIES_BUCKET") if "CT" in modality else cfg.get("S3_MRI_STUDIES_BUCKET") if modality & {"MR","MRI"} else cfg.get("S3_MAMMOGRAPHY_STUDIES_BUCKET") if "MG" in modality else cfg.get("S3_XRAY_STUDIES_BUCKET")
    buckets.sort(key=lambda b:b != preferred)
    prefixes = list(dict.fromkeys(["", *(v.strip("/") for k, v in cfg.items() if k.startswith("S3_") and k.endswith("_PREFIX"))]))
    status = job.get("upstreamStatus") or {}
    original = (status.get("storage", status).get("originalStudy") or {}) if isinstance(status, dict) and isinstance(status.get("storage", status), dict) else {}
    candidates = []
    location_key = (source.code, bridge.get("id"), job.get("id"))
    cached_location = _storage_locations.get(location_key)
    if cached_location and cached_location["expires"] > time.monotonic():
        return {"s3":s3, **{k:v for k,v in cached_location.items() if k != "expires"}}
    if original.get("bucket") in buckets and original.get("key"):
        candidates.append((original["bucket"], original["key"]))
    path = bridge.get("archivePath") or ""
    if path.startswith("s3://"):
        parsed = urlsplit(path)
        if parsed.netloc in buckets:
            candidates.append((parsed.netloc, parsed.path.lstrip("/")))
    names = list(dict.fromkeys(n for n in [bridge.get("archiveName"), job.get("uploadName"), *[str(bridge[k])+".zip" for k in ["studyInstanceUid", "publicStudyId", "id"] if bridge.get(k)]] if n))
    normalized_path = str(path).replace("\\", "/").lstrip("/")
    if len(normalized_path)>2 and normalized_path[1:3]==":/":
        normalized_path=normalized_path[3:]
    keys = ([normalized_path] if normalized_path and not path.startswith("s3://") else []) + list(names)
    for name in names:
        for identity in [job.get("id"), bridge.get("id"), bridge.get("publicStudyId")]:
            if identity:
                keys.extend([f"studies/{identity}/{name}", f"viewer-imports/{identity}/{name}"])
    for bucket in buckets:
        for prefix in prefixes:
            candidates.extend((bucket, f"{prefix}/{key}".lstrip("/")) for key in keys)
    deadline = time.monotonic() + 25
    def check(candidate):
        bucket,key=candidate
        if time.monotonic() > deadline:
            return None
        try:
            head = s3.head_object(Bucket=bucket, Key=key)
            return {"s3":s3,"bucket":bucket,"key":key,"size":head["ContentLength"]}
        except ClientError as error:
            if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") not in {403, 404}:
                raise HTTPException(503, "DICOM storage is temporarily unavailable.") from None
        except BotoCoreError:
            raise HTTPException(503, "DICOM storage could not be reached.") from None
        return None
    candidates=list(dict.fromkeys(candidates))
    with ThreadPoolExecutor(max_workers=8) as executor:
        for offset in range(0,len(candidates),8):
            found=next((r for r in executor.map(check,candidates[offset:offset+8]) if r),None)
            if found:
                if len(_storage_locations)>500: _storage_locations.clear()
                _storage_locations[location_key]={k:v for k,v in found.items() if k != "s3"} | {"expires":time.monotonic()+300}
                return found
    # Older imports have nested directory layouts. Match the exact UID ZIP name
    # only when the complete bounded bucket listing contains one unique object.
    uid_name = str(bridge.get("studyInstanceUid") or "") + ".zip"
    if uid_name != ".zip":
        for bucket in buckets:
            index_key=(source.code,bucket)
            cached=_bucket_names.get(index_key)
            if not cached or cached["expires"]<time.monotonic():
                listing={}; continuation=None; complete=False
                try:
                    for page in range(20):
                        args={"Bucket":bucket,"MaxKeys":1000}
                        if continuation: args["ContinuationToken"]=continuation
                        result=s3.list_objects_v2(**args)
                        for item in result.get("Contents",[]):
                            name=item["Key"].rsplit("/",1)[-1]
                            listing.setdefault(name,[]).append(item["Key"])
                        continuation=result.get("NextContinuationToken")
                        if not result.get("IsTruncated"):
                            complete=True;break
                    cached={"names":listing if complete else {},"expires":time.monotonic()+300}
                    _bucket_names[index_key]=cached
                except (ClientError,BotoCoreError):
                    continue
            matches=cached["names"].get(uid_name,[])
            if len(matches)==1:
                deadline=time.monotonic()+8
                found=check((bucket,matches[0]))
                if found: return found
    raise HTTPException(404, "The source archive is not available in connected storage. The study may still be on its acquisition workstation.")


def number(value, integer=False):
    try:
        if not isinstance(value, (str, bytes)) and hasattr(value, "__len__"):
            value = value[0]
        return int(value) if integer else float(value)
    except (TypeError, ValueError, IndexError):
        return None


def target_modalities(bridge, job):
    values = {str(m).upper() for m in bridge.get("modalities", [])}
    service = str(job.get("serviceType", "")).lower()
    if not values:
        if service.startswith("ct"):
            values.add("CT")
        elif service.startswith(("mri", "mra", "mrcp")):
            values.add("MR")
        elif service == "mammography":
            values.add("MG")
    return values


def index_archive(path, expected_uid=None):
    instances, series, first = [], {}, None
    archive = zipfile.ZipFile(path) if zipfile.is_zipfile(path) else None
    entries = archive.infolist() if archive else [None]
    total = 0
    try:
        if len(entries) > 2000:
            raise HTTPException(413, "Use the full viewer for archives with more than 2,000 files.")
        for entry in entries:
            size = entry.file_size if entry else path.stat().st_size
            if entry and entry.is_dir():
                continue
            total += size
            if size > 64 * 1024 * 1024 or total > MAX_BYTES * 2:
                raise HTTPException(413, "Study archive exceeds the safe viewer size limit.")
            try:
                with archive.open(entry) if archive else path.open("rb") as stream:
                    ds = pydicom.dcmread(stream, stop_before_pixels=True)
            except (pydicom.errors.InvalidDicomError, EOFError, ValueError):
                continue
            if not ds.get("Rows") or not ds.get("Columns"):
                continue
            if int(ds.Rows) * int(ds.Columns) > 64_000_000 or int(ds.get("NumberOfFrames", 1)) > 500:
                raise HTTPException(413, "Use the full viewer for this image's dimensions or frame count.")
            if expected_uid and str(ds.get("StudyInstanceUID", "")) != expected_uid:
                continue
            if len(instances) >= MAX_INSTANCES:
                raise HTTPException(413, "Use the full DICOM viewer for studies with more than 500 images.")
            first = first if first is not None else ds
            sid = str(ds.get("SeriesInstanceUID", "unknown"))
            item = {"index": len(instances), "sopInstanceUid": str(ds.get("SOPInstanceUID", "")), "instanceNumber": number(ds.get("InstanceNumber"), True),
                "rows": int(ds.Rows), "columns": int(ds.Columns), "frames": int(ds.get("NumberOfFrames", 1)), "windowCenter": number(ds.get("WindowCenter")), "windowWidth": number(ds.get("WindowWidth")),
                "photometricInterpretation": str(ds.get("PhotometricInterpretation", "")), "sizeBytes": size,
                "pixelSpacing": [float(v) for v in ds.PixelSpacing] if ds.get("PixelSpacing") else None,
                "patientOrientation": list(ds.PatientOrientation) if ds.get("PatientOrientation") else None, "sliceThickness": number(ds.get("SliceThickness"))}
            series.setdefault(sid, {"seriesInstanceUid": sid, "seriesNumber": number(ds.get("SeriesNumber"), True), "description": str(ds.get("SeriesDescription", "")), "modality": str(ds.get("Modality", "")), "instances": []})["instances"].append(item)
            instances.append(entry.filename if entry else None)
    finally:
        if archive:
            archive.close()
    if not instances:
        raise HTTPException(404, "No DICOM images matching this study were found in its archive.")
    manifest = {key: str(first.get(tag, "")) for key, tag in {"studyInstanceUid": "StudyInstanceUID", "patientName": "PatientName", "patientId": "PatientID", "patientSex": "PatientSex", "patientAge": "PatientAge", "studyDate": "StudyDate", "studyDescription": "StudyDescription"}.items()}
    manifest.update(instanceCount=len(instances), modalities=list(dict.fromkeys(s["modality"] for s in series.values())), series=list(series.values()))
    return {"path": path, "entries": instances, "manifest": manifest}


def get_index(source, kind, identity):
    # Resolve the source again on every request, including cached image requests.
    bridge, job = resolve(source, kind, identity)
    key = (source.code, kind, identity)
    with _lock:
        cached = _cache.get(key)
        if cached and cached["expires"] > time.monotonic():
            _cache.move_to_end(key)
            return cached
        location = storage(source, bridge, job)
        temp = None
        if "local" in location:
            path = location["local"]
        else:
            if location["size"] > MAX_BYTES:
                raise HTTPException(413, "This study exceeds the in-app viewer limit. Open the full viewer.")
            temp = tempfile.TemporaryDirectory(prefix="dectrocel-dicom-")
            path = Path(temp.name) / "study.zip"
            body = location["s3"].get_object(Bucket=location["bucket"], Key=location["key"])["Body"]
            try:
                with path.open("wb") as output:
                    size = 0
                    for chunk in body.iter_chunks(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise HTTPException(413, "Study archive exceeds the in-app viewer limit.")
                        output.write(chunk)
            finally:
                body.close()
        result = index_archive(path, bridge.get("studyInstanceUid"))
        result.update(temp=temp, expires=time.monotonic()+600)
        _cache[key] = result
        while len(_cache) > 12:
            _cache.popitem(last=False)
        return result


def image_bytes(index, position):
    if position < 0 or position >= len(index["entries"]):
        raise HTTPException(404, "DICOM image not found.")
    entry = index["entries"][position]
    if entry is None:
        return index["path"].read_bytes()
    with zipfile.ZipFile(index["path"]) as archive:
        return archive.read(entry)


def external_session(source, kind, identity):
    bridge, job = resolve(source, kind, identity)
    cfg = config(source.code)
    base, secret = cfg.get("DICOM_VIEWER_API_URL", ""), cfg.get("DICOM_VIEWER_SERVICE_API_KEY", "")
    if not base or not secret:
        raise HTTPException(503, "The full DICOM viewer service is not configured for this portal.")
    location = storage(source, bridge, job)
    if "local" in location:
        raise HTTPException(409, "This archive is local only. Use the in-app viewer; the full viewer requires its synced storage copy.")
    modalities = target_modalities(bridge, job)
    modality = "CT" if "CT" in modalities else "MRI" if modalities & {"MR", "MRI"} else "MAMMOGRAPHY" if "MG" in modalities else "XRAY"
    cache_key = (source.code, location["bucket"], location["key"])
    try:
        with httpx.Client(base_url=base.rstrip("/"), headers={"Authorization": f"Bearer {secret}"}, timeout=20) as client:
            cached = _imports.get(cache_key)
            if not cached or cached["expires"] < time.monotonic():
                response = client.post("/api/v1/studies", json={"zipKey": location["key"], "modality": modality})
                response.raise_for_status()
                cached = {"id": response.json()["id"], "expires": time.monotonic()+300}
                if len(_imports) > 100:
                    _imports.clear()
                _imports[cache_key] = cached
            for _ in range(15):
                response = client.get(f"/api/v1/studies/{cached['id']}")
                response.raise_for_status()
                status = response.json().get("status")
                if status == "completed":
                    break
                if status == "failed":
                    _imports.pop(cache_key, None)
                    raise HTTPException(502, "The full viewer could not index this study. Try the in-app viewer.")
                time.sleep(1)
            else:
                raise HTTPException(503, "The full viewer is still indexing this study. Try again shortly.")
            response = client.post("/api/v1/sessions", json={"studyId": cached["id"]})
            response.raise_for_status()
            url = response.json().get("viewerUrl", "")
            parsed = urlsplit(url)
            allowed = {urlsplit(base).netloc, urlsplit(cfg.get("DICOM_VIEWER_PUBLIC_URL", "")).netloc}
            if parsed.scheme not in {"http", "https"} or parsed.netloc not in allowed or parsed.username:
                raise HTTPException(502, "The viewer service returned an invalid session.")
            return {"enabled": True, "mode": "external", "viewerUrl": url}
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(503, "The full DICOM viewer service is unavailable. Try the in-app viewer.") from None


def handle(source, path, query):
    routes = {"client/study-sync/available-studies": "bridge-study", "reports": "report", "radiologist/reports": "radiologist-report", "processing-jobs": "job", "patient-study-archives": "archive"}
    for prefix, kind in routes.items():
        parts = path.removeprefix(prefix+"/").split("/")
        if path.startswith(prefix+"/") and len(parts) == 2 and parts[1] == "viewer-session":
            bridge, job = resolve(source, kind, parts[0])
            modalities = target_modalities(bridge, job)
            if query.get("viewer") == "full" or modalities & {"CT", "MR", "MRI", "PT"} or int(bridge.get("totalSizeBytes") or 0) > MAX_BYTES:
                return JSONResponse(external_session(source, kind, parts[0]), headers=HEADERS)
            # Ensure files really exist before advertising a usable QuickView session.
            get_index(source, kind, parts[0])
            return JSONResponse({"enabled": True, "mode": "quick", "quickViewUrl": f"/api/pacs/{source.code}/quickview/{kind}/{parts[0]}"}, headers=HEADERS)
    parts = path.split("/")
    if len(parts) < 4 or parts[0] != "quickview":
        raise HTTPException(404, "Unknown viewer endpoint.")
    index = get_index(source, parts[1], parts[2])
    if parts[3:] == ["manifest"]:
        return Response(__import__("json").dumps(index["manifest"]), media_type="application/json", headers=HEADERS)
    if parts[3:] == ["export"]:
        return FileResponse(index["path"], filename="study.zip" if zipfile.is_zipfile(index["path"]) else "study.dcm", headers=HEADERS)
    if len(parts) in {5, 6} and parts[3] == "instances" and parts[4].isdigit():
        data = image_bytes(index, int(parts[4]))
        if len(parts) == 5:
            return Response(data, media_type="application/dicom", headers=HEADERS)
        if parts[5] == "preview":
            try:
                ds = pydicom.dcmread(io.BytesIO(data))
                pixels = pydicom.pixels.pixel_array(ds, index=0)
                if pixels.ndim == 2:
                    pixels = apply_voi_lut(pixels, ds).astype(float)
                    low, high = np.min(pixels), np.max(pixels)
                    pixels = (pixels-low) * (255 / (high-low or 1))
                    if ds.get("PhotometricInterpretation") == "MONOCHROME1":
                        pixels = 255-pixels
                image = Image.fromarray(np.clip(pixels, 0, 255).astype("uint8"))
                image.thumbnail((1024, 1024))
                output = io.BytesIO(); image.convert("RGB").save(output, format="JPEG", quality=85)
                return Response(output.getvalue(), media_type="image/jpeg", headers=HEADERS)
            except (RuntimeError, ValueError, NotImplementedError):
                # Browser codecs still decode the original lossless DICOM.
                return Response(status_code=204, headers=HEADERS)
    raise HTTPException(404, "Unknown viewer endpoint.")
