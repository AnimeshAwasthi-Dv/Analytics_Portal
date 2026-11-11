import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
import pydicom
from fastapi import HTTPException
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage, generate_uid

from app import pacs_viewer as viewer


def dicom_bytes(study_uid):
    meta = FileMetaDataset()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
    meta.MediaStorageSOPInstanceUID = generate_uid()
    ds = FileDataset(None, {}, file_meta=meta, preamble=b"\0" * 128)
    ds.StudyInstanceUID = study_uid
    ds.SeriesInstanceUID = generate_uid()
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.PatientName = "Synthetic^Viewer"
    ds.Modality = "DX"
    ds.Rows = ds.Columns = 32
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.PixelData = np.arange(1024, dtype="uint16").tobytes()
    output = io.BytesIO()
    pydicom.dcmwrite(output, ds, enforce_file_format=True)
    return output.getvalue()


class ViewerArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.uid = generate_uid()
        self.data = dicom_bytes(self.uid)
        self.path = self.root / "study.zip"
        with zipfile.ZipFile(self.path, "w") as archive:
            archive.writestr("DICOM/one.dcm", self.data)
            archive.writestr("DICOM/other-study.dcm", dicom_bytes(generate_uid()))
            archive.writestr("notes.txt", "not a DICOM image")

    def tearDown(self):
        self.temp.cleanup()

    def test_manifest_only_contains_requested_study_and_no_storage_paths(self):
        indexed = viewer.index_archive(self.path, self.uid)
        manifest = indexed["manifest"]
        self.assertEqual(manifest["instanceCount"], 1)
        self.assertEqual(manifest["studyInstanceUid"], self.uid)
        self.assertEqual(manifest["series"][0]["instances"][0]["rows"], 32)
        self.assertNotIn(str(self.path), json.dumps(manifest))
        self.assertEqual(viewer.image_bytes(indexed, 0), self.data)
        with self.assertRaises(HTTPException) as e:
            viewer.image_bytes(indexed, -1)
        self.assertEqual(e.exception.status_code, 404)

    def test_wrong_study_uid_never_falls_back_to_other_images(self):
        with self.assertRaises(HTTPException) as e:
            viewer.index_archive(self.path, generate_uid())
        self.assertEqual(e.exception.status_code, 404)

    def test_local_paths_are_confined_to_configured_upload_roots(self):
        allowed = self.root / "uploads"
        allowed.mkdir()
        image = allowed / "study.zip"
        image.write_bytes(self.path.read_bytes())
        self.assertEqual(viewer.local_file(str(image), [str(allowed)]), image)
        self.assertIsNone(viewer.local_file(str(self.path), [str(allowed)]))
        self.assertEqual(viewer.local_file("C:/old/portal/uploads/study.zip", [str(allowed)]), image)
        self.assertIsNone(viewer.local_file("C:/old/portal/uploads/../study.zip", [str(allowed)]))
        self.assertIsNone(viewer.local_file("s3://bucket/study.zip", [str(allowed)]))

    def test_manifest_binary_preview_and_export_are_no_store(self):
        indexed = viewer.index_archive(self.path, self.uid)
        source = SimpleNamespace(code="pacs")
        with patch.object(viewer, "get_index", return_value=indexed):
            for path in ["manifest", "instances/0", "instances/0/preview", "export"]:
                response = viewer.handle(source, "quickview/bridge-study/s1/"+path, {})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["cache-control"], "private, no-store")
            preview = viewer.handle(source, "quickview/bridge-study/s1/instances/0/preview", {})
            self.assertTrue(preview.body.startswith(b"\xff\xd8"))

    def test_quickview_cache_always_rechecks_source_record(self):
        key = ("pacs", "bridge-study", "deleted")
        viewer._cache[key] = {"expires": float("inf")}
        try:
            with patch.object(viewer, "resolve", side_effect=HTTPException(404, "Not found")):
                with self.assertRaises(HTTPException):
                    viewer.get_index(SimpleNamespace(code="pacs"), "bridge-study", "deleted")
        finally:
            viewer._cache.pop(key, None)

    def test_report_job_and_bridge_resolution_preserve_client_scope(self):
        source = Mock()
        with patch.object(viewer, "private_row", side_effect=[
            {"id":"r1", "clientId":"client-a", "studyUid":self.uid, "aiReportJson":{"processingJob":{"id":"j1"}}},
            {"id":"j1", "clientId":"client-a"},
            {"id":"b1", "clientId":"client-a", "studyInstanceUid":self.uid},
        ]) as read:
            bridge, job = viewer.resolve(source, "report", "r1")
            self.assertEqual(bridge["id"], "b1")
            self.assertEqual(job["id"], "j1")
            self.assertEqual(read.call_args_list[1].kwargs, {"id":"j1", "clientId":"client-a"})
            self.assertEqual(read.call_args_list[2].kwargs, {"clientId":"client-a", "studyInstanceUid":self.uid})

    def test_ct_and_mri_choose_full_viewer_without_quickview_download(self):
        for modalities, service, size in [(["CT"],"ct-chest",0),([],"mri-brain",0),(["DX"],"xray",viewer.MAX_BYTES+1)]:
            with patch.object(viewer,"resolve",return_value=({"modalities":modalities,"totalSizeBytes":size},{"serviceType":service})), patch.object(viewer,"external_session",return_value={"enabled":True,"mode":"external","viewerUrl":"https://viewer.example/session"}) as full, patch.object(viewer,"get_index") as quick:
                response=viewer.handle(Mock(),"reports/r1/viewer-session",{})
                self.assertEqual(json.loads(response.body)["mode"],"external")
                full.assert_called_once()
                quick.assert_not_called()

    def test_storage_credentials_are_scoped_to_selected_portal(self):
        with patch.dict("os.environ", {"PACS_VIEWER_S3_ACCESS_KEY_ID":"pacs-key", "MARENGO_VIEWER_S3_ACCESS_KEY_ID":"marengo-key"}, clear=True):
            self.assertEqual(viewer.config("pacs"), {"S3_ACCESS_KEY_ID":"pacs-key"})
            self.assertEqual(viewer.config("marengo"), {"S3_ACCESS_KEY_ID":"marengo-key"})


if __name__ == "__main__":
    unittest.main()
