import os
import unittest
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException

# Test with in-memory SQLite for isolated, fast unit tests
os.environ["APP_ENV"] = "development"
os.environ["SSO_SHARED_SECRET"] = "pacs_taskmanager_secure_sso_shared_secret_key_2026_987654321"
os.environ["SSO_ISSUER"] = "pacs-analytics-portal"
os.environ["SSO_AUDIENCE"] = "task-manager-portal"
os.environ["TASK_MANAGER_SSO_URL"] = "https://task.admindectrocel.online"

from app.database import Base
from app.models import User
from app.sso import (
    create_sso_authorization_code,
    verify_and_consume_sso_code,
    ensure_sso_tables,
    hash_code,
    SSO_SHARED_SECRET,
)

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class TestCommonPacsSso(unittest.TestCase):
    def setUp(self):
        User.__table__.create(bind=engine, checkfirst=True)
        self.db = TestingSessionLocal()
        ensure_sso_tables(self.db)

        # Create active test users
        self.admin_user = User(
            name="PACS Admin",
            email="admin@central-sync.com",
            hashed_password="hashed_pw_test",
            is_active=True,
        )
        self.lead_user = User(
            name="Lead Doctor",
            email="lead@central-sync.com",
            hashed_password="hashed_pw_test",
            is_active=True,
        )
        self.viewer_user = User(
            name="PACS Viewer",
            email="viewer@central-sync.com",
            hashed_password="hashed_pw_test",
            is_active=True,
        )
        self.inactive_user = User(
            name="Inactive User",
            email="inactive@central-sync.com",
            hashed_password="hashed_pw_test",
            is_active=False,
        )
        self.db.add_all([self.admin_user, self.lead_user, self.viewer_user, self.inactive_user])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        User.__table__.drop(bind=engine, checkfirst=True)

    def test_1_opaque_authorization_code_format(self):
        """Verify redirect URL contains random, opaque code only - NOT a JWT or access token."""
        result = create_sso_authorization_code(
            user=self.admin_user,
            pacs_role="super_admin",
            db=self.db,
        )
        self.assertIn("code", result)
        self.assertIn("redirectUrl", result)
        code = result["code"]

        # Must be opaque authorization code (starts with pacs_ac_)
        self.assertTrue(code.startswith("pacs_ac_"))
        # Must NOT be a dot-separated JWT
        self.assertNotIn(".", code)
        # Redirect URL must point to task manager sso callback with the opaque code
        self.assertEqual(
            result["redirectUrl"],
            f"https://task.admindectrocel.online/sso/callback?code={code}"
        )
        self.assertEqual(result["expiresIn"], 60)

    def test_2_single_use_verification_and_burning(self):
        """Backend verification validates the code, burns it, and returns user identity."""
        auth_data = create_sso_authorization_code(
            user=self.lead_user,
            pacs_role="operations",
            db=self.db,
        )
        code = auth_data["code"]

        # First verification succeeds
        verified = verify_and_consume_sso_code(
            code=code,
            db=self.db,
            auth_secret=SSO_SHARED_SECRET,
        )
        self.assertTrue(verified["valid"])
        self.assertEqual(verified["email"], "lead@central-sync.com")
        self.assertEqual(verified["pacsRole"], "operations")

        # Second verification of the SAME code must fail (single-use replay rejection)
        with self.assertRaises(HTTPException) as cm:
            verify_and_consume_sso_code(
                code=code,
                db=self.db,
                auth_secret=SSO_SHARED_SECRET,
            )
        self.assertEqual(cm.exception.status_code, 401)
        self.assertIn("already been used", cm.exception.detail)

    def test_3_expired_code_rejection(self):
        """Expired code must be rejected during verification."""
        auth_data = create_sso_authorization_code(
            user=self.viewer_user,
            pacs_role="viewer",
            db=self.db,
        )
        code = auth_data["code"]
        digest = hash_code(code)

        # Manually backdate expiration in DB to simulate expiry
        past_time = datetime.now(timezone.utc) - timedelta(seconds=10)
        from sqlalchemy import text
        self.db.execute(
            text("UPDATE sso_authorization_codes SET expires_at = :past WHERE code_hash = :hash"),
            {"past": past_time, "hash": digest}
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as cm:
            verify_and_consume_sso_code(
                code=code,
                db=self.db,
                auth_secret=SSO_SHARED_SECRET,
            )
        self.assertEqual(cm.exception.status_code, 401)
        self.assertIn("expired", cm.exception.detail)

    def test_4_inactive_user_cannot_initiate_sso(self):
        """Inactive user is forbidden from initiating SSO."""
        with self.assertRaises(HTTPException) as cm:
            create_sso_authorization_code(
                user=self.inactive_user,
                pacs_role="viewer",
                db=self.db,
            )
        self.assertEqual(cm.exception.status_code, 403)

    def test_5_invalid_shared_secret_rejection(self):
        """Backend verification with wrong credentials is unauthorized."""
        auth_data = create_sso_authorization_code(
            user=self.admin_user,
            pacs_role="super_admin",
            db=self.db,
        )
        with self.assertRaises(HTTPException) as cm:
            verify_and_consume_sso_code(
                code=auth_data["code"],
                db=self.db,
                auth_secret="wrong-secret",
            )
        self.assertEqual(cm.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
