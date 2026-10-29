import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import patch

from sqlalchemy.dialects import postgresql

from app.marengo_analytics_sync import _record_values, _upsert_batch
from app.modality import normalize_modality
from app.models import Instance, SyncRecord
from app.source_sync import (
    SOURCE_SQL,
    Source,
    import_source,
    install_source_trigger,
    make_payload,
)


class CreditCalculationTests(unittest.TestCase):
    def test_supported_modality_codes_are_canonicalized(self):
        examples = {
            "CR": "X-Ray",
            "DX": "X-Ray",
            "RF": "Special X-Ray",
            "CT": "CT",
            "MR": "MRI",
            "MG": "Mammography",
            "PT": "PET-CT",
            "US": "USG",
            "SR": "SR",
        }
        for source_value, expected in examples.items():
            with self.subTest(source_value=source_value):
                self.assertEqual(normalize_modality(source_value), expected)

    def test_combined_modality_uses_imaging_category_before_sr(self):
        self.assertEqual(normalize_modality("CT, SR"), "CT")

    def test_unknown_and_ambiguous_codes_are_not_guessed(self):
        self.assertIsNone(normalize_modality("MCT"))
        self.assertIsNone(normalize_modality("OTHER"))
        self.assertIsNone(make_payload({"modality": "MCT"})["modality"])

    def test_non_xray_modalities_use_one_credit_even_with_many_instances(self):
        for modality in ("CT", "MR", "MG", "PT", "US", "SR"):
            with self.subTest(modality=modality):
                self.assertEqual(
                    make_payload({"modality": modality, "image_count": 744})[
                        "credits_used"
                    ],
                    1,
                )

    def test_xray_credits_equal_source_image_count(self):
        self.assertEqual(make_payload({"modality": "CR", "image_count": 1})["credits_used"], 1)
        self.assertEqual(make_payload({"modality": "DX", "image_count": 10})["credits_used"], 10)
        self.assertEqual(make_payload({"modality": "RF", "image_count": 7})["credits_used"], 7)
        special = make_payload({"modality": "", "study_description": "BARIUM SWALLOW", "image_count": 7})
        self.assertEqual(special["modality"], "Special X-Ray")
        self.assertEqual(special["credits_used"], 7)

    def test_invalid_xray_counts_are_rejected_instead_of_defaulting_to_one(self):
        for image_count in (None, 0, -1, "invalid"):
            with self.subTest(image_count=image_count):
                with self.assertLogs("portal-source-sync", level="WARNING"):
                    with self.assertRaisesRegex(ValueError, "instanceCount"):
                        make_payload({"modality": "DX", "image_count": image_count})

    def test_pacs_query_uses_bridge_instance_count_and_existing_job_relation(self):
        query = SOURCE_SQL["pacs"].text
        self.assertIn('abs."instanceCount" AS image_count', query)
        self.assertIn('abs."studyInstanceUid" AS source_study_uid', query)
        self.assertIn('b."processingJobId" = pj.id', query)
        self.assertIn('LEFT JOIN public.clients AS c ON c.id = pj."clientId"', query)
        self.assertIn("c.kind::text)) = 'CENTER'", query)
        self.assertNotIn('pj."imageCount" AS image_count', query)
        self.assertIn('CAST(:source_id AS TEXT)', query)

    def test_missing_bridge_record_does_not_guess_xray_credits(self):
        # The PACS query's LEFT JOIN produces a NULL count when no bridge row
        # exists; the payload builder must reject that X-ray record.
        with self.assertLogs("portal-source-sync", level="WARNING"):
            with self.assertRaises(ValueError):
                make_payload({"modality": "CR", "image_count": None})

    def test_pacs_notifications_install_bridge_retry_trigger(self):
        statements = []

        class FakeConnection:
            def execute(self, statement):
                statements.append(str(statement))

        class FakeEngine:
            @contextmanager
            def begin(self):
                yield FakeConnection()

            def dispose(self):
                pass

        class FakeInspector:
            def get_columns(self, table, schema=None):
                if table == "processing_jobs":
                    return [{"name": name} for name in ("id", "status")]
                return [{"name": name} for name in (
                    "processingJobId", "instanceCount", "studyInstanceUid",
                    "modalities", "studyDescription", "updatedAt", "createdAt",
                )]

        with patch("app.source_sync.create_engine", return_value=FakeEngine()), patch(
            "app.source_sync.inspect", return_value=FakeInspector()
        ):
            install_source_trigger(Source("PACS", "pacs", "pacs-01", "unused"))

        bridge_trigger = "\n".join(statements)
        self.assertIn("CREATE TRIGGER portal_sync_notify_bridge", bridge_trigger)
        self.assertIn('"instanceCount"', bridge_trigger)
        self.assertIn('NEW."processingJobId"::text', bridge_trigger)

    def test_repeated_pacs_notification_does_not_duplicate_credits(self):
        stored_records = []
        instance = Instance(name="PACS", identifier="pacs-01")
        source_row = {
            "source_id": "job-id-text",
            "modality": "CR",
            "image_count": 10,
            "service_type": "CR",
            "study_description": "Chest X-Ray",
            "source_study_uid": "1.2.3",
            "centre_id": "centre-1",
            "centre_name": "Centre One",
            "centre_kind": "CENTER",
            "processing_created_at": datetime.now(timezone.utc),
            "processing_completed_at": datetime.now(timezone.utc),
        }

        class FakeQuery:
            def __init__(self, model):
                self.model = model

            def filter(self, *_conditions):
                return self

            def first(self):
                return instance if self.model is Instance else None

            def all(self):
                return list(stored_records)

        class FakePortalSession:
            def query(self, model):
                return FakeQuery(model)

            def add(self, record):
                if isinstance(record, SyncRecord):
                    stored_records.append(record)

            def commit(self):
                pass

            def rollback(self):
                pass

            def close(self):
                pass

        class FakeResult:
            def mappings(self):
                return self

            def all(self):
                return [source_row]

        class FakeSourceConnection:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

            def execute(self, *_args):
                return FakeResult()

        class FakeSourceEngine:
            def connect(self):
                return FakeSourceConnection()

            def dispose(self):
                pass

        source = Source("PACS", "pacs", "pacs-01", "unused")
        with patch("app.source_sync.SessionLocal", return_value=FakePortalSession()), patch(
            "app.source_sync.create_engine", return_value=FakeSourceEngine()
        ):
            first = import_source(source, batch_size=10, only_source_id="job-id-text")
            source_row["image_count"] = 99
            source_row["centre_name"] = "Centre Renamed"
            second = import_source(source, batch_size=10, only_source_id="job-id-text")

        self.assertEqual(first["imported"], 1)
        self.assertEqual(second["duplicates"], 1)
        self.assertEqual(len(stored_records), 1)
        self.assertEqual(stored_records[0].credits_used, 10)
        self.assertEqual(stored_records[0].centre_name, "Centre Renamed")
        self.assertEqual(stored_records[0].source_study_uid, "1.2.3")

    def test_marengo_clone_calculates_study_credits_from_processing_jobs(self):
        with patch("app.marengo_analytics_sync.logger.warning"):
            ct = _record_values(
                "studies", {"id": "ct1", "modality": "CT", "image_count": 744}
            )
            xray = _record_values(
                "studies", {"id": "xr1", "modality": "DX", "image_count": 744}
            )
        self.assertEqual(ct["credits_used"], 1)
        self.assertEqual(xray["credits_used"], 744)
        self.assertNotIn("image_count", ct)

    def test_marengo_study_keeps_centre_mapping_only_for_centres(self):
        values = _record_values("studies", {
            "id": "study-1", "modality": "CT", "image_count": 20,
            "centre_id": "client-1", "centre_name": "Centre One",
            "centre_kind": "CENTER",
        })
        self.assertEqual(values["centre_id"], "client-1")
        self.assertEqual(values["centre_name"], "Centre One")
        self.assertNotIn("centre_kind", values)
        group = _record_values("studies", {
            "id": "study-2", "modality": "CT", "image_count": 20,
            "centre_id": "group-1", "centre_name": "Group One", "centre_kind": "GROUP",
        })
        self.assertIsNone(group["centre_id"])
        self.assertIsNone(group["centre_name"])

    def test_marengo_missing_xray_count_is_zero(self):
        with self.assertLogs("portal-marengo-analytics", level="WARNING"):
            values = _record_values(
                "studies", {"id": "xr1", "modality": "CR", "image_count": None}
            )
        self.assertEqual(values["credits_used"], 0)

    def test_repeated_marengo_clone_does_not_recalculate_existing_credits(self):
        class CaptureSession:
            statement = None

            def execute(self, statement):
                self.statement = str(statement.compile(dialect=postgresql.dialect()))

        session = CaptureSession()
        _upsert_batch(
            session,
            "marengo-01",
            "studies",
            [{"id": "xr1", "modality": "CR", "image_count": 744}],
        )
        self.assertIn("ON CONFLICT", session.statement)
        self.assertNotIn("credits_used = excluded.credits_used", session.statement)


if __name__ == "__main__":
    unittest.main()
