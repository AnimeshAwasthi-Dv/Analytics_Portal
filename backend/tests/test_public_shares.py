import hashlib
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.pacs_documents import PublicShare, shared


class PublicShareTests(unittest.TestCase):
    def test_invalid_expired_and_report_only_links_cannot_open_images(self):
        engine=create_engine("sqlite://")
        PublicShare.__table__.create(engine)
        with Session(engine) as db:
            request=Mock()
            with patch("app.pacs_api.Source") as source:
                with self.assertRaises(HTTPException): shared("unknown",request,"",db)
                source.assert_not_called()
                row=PublicShare(token_hash=hashlib.sha256(b"secret").hexdigest(),portal_code="marengo",target_id="report-1",kind="report",include_viewer=False,created_by=1,expires_at=datetime.now(timezone.utc)-timedelta(seconds=1))
                db.add(row);db.commit()
                with self.assertRaises(HTTPException): shared("secret",request,"",db)
                source.assert_not_called()
                row.expires_at=datetime.now(timezone.utc)+timedelta(days=1);db.commit()
                with self.assertRaises(HTTPException) as error: shared("secret",request,"quickview/manifest",db)
                self.assertEqual(error.exception.status_code,403)
                source.return_value.close.assert_called_once()
        engine.dispose()
