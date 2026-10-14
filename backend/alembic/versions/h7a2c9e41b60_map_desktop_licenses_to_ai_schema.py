"""Map desktop licenses and plans to the supplied ai schema."""
import os
from typing import Sequence, Union

from alembic import op

revision: str = "h7a2c9e41b60"
down_revision: Union[str, Sequence[str], None] = "g6d3c1a8f204"
branch_labels = None
depends_on = None


def upgrade() -> None:
    xray_test_type_id = int(os.getenv("XRAY_TEST_TYPE_ID", "1"))
    ct_test_type_id = int(os.getenv("CT_TEST_TYPE_ID", "2"))
    op.execute("CREATE SCHEMA IF NOT EXISTS ai")
    op.execute("""
        CREATE TABLE IF NOT EXISTS ai.license_plans (
          plan_id BIGINT PRIMARY KEY,
          test_type_id INTEGER,
          plan_name VARCHAR NOT NULL,
          credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
          validity_days INTEGER NOT NULL DEFAULT 0 CHECK (validity_days >= 0),
          plan_cost NUMERIC NOT NULL DEFAULT 0 CHECK (plan_cost >= 0)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS ai.license_detail (
          license_id BIGINT PRIMARY KEY,
          license_key VARCHAR NOT NULL,
          plan_id BIGINT NOT NULL REFERENCES ai.license_plans(plan_id),
          status VARCHAR NOT NULL DEFAULT 'A' CHECK (status IN ('A','U','CF','B')),
          app_version_type VARCHAR NOT NULL CHECK (app_version_type IN ('DCP','DXP','CXR')),
          license_app_scope VARCHAR,
          credit_left INTEGER NOT NULL DEFAULT 0 CHECK (credit_left >= 0),
          credit_available_online INTEGER NOT NULL DEFAULT 0 CHECK (credit_available_online >= 0),
          ct_credits INTEGER NOT NULL DEFAULT 0 CHECK (ct_credits >= 0),
          start_date TIMESTAMP, end_date TIMESTAMP, system_hash VARCHAR, mac_address VARCHAR,
          last_sync TIMESTAMP,
          activation_count INTEGER NOT NULL DEFAULT 0 CHECK (activation_count >= 0),
          activation_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (activation_attempt_count >= 0),
          successful_validation_count INTEGER NOT NULL DEFAULT 0 CHECK (successful_validation_count >= 0),
          last_validation_at TIMESTAMP,
          fraud_detected BOOLEAN NOT NULL DEFAULT FALSE,
          fraud_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (fraud_attempt_count >= 0),
          last_fraud_attempt TIMESTAMP, last_fraud_reason TEXT,
          rate_limit_triggered BOOLEAN NOT NULL DEFAULT FALSE,
          fullname VARCHAR, username VARCHAR, mobile VARCHAR, address TEXT, vendor_name VARCHAR,
          geo_location VARCHAR,
          carried_forward_from BIGINT REFERENCES ai.license_detail(license_id),
          carried_forward_to BIGINT REFERENCES ai.license_detail(license_id),
          carry_forward_date TIMESTAMP, blocked_at TIMESTAMP, blocked_reason TEXT, error_logs TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now(),
          UNIQUE (license_key, app_version_type)
        )
    """)
    # Always provide generated IDs even if these tables were first created from the user's DDL.
    op.execute("CREATE SEQUENCE IF NOT EXISTS ai.license_plans_plan_id_seq")
    op.execute("CREATE SEQUENCE IF NOT EXISTS ai.license_detail_license_id_seq")
    op.execute("ALTER TABLE ai.license_plans ALTER COLUMN plan_id SET DEFAULT nextval('ai.license_plans_plan_id_seq')")
    op.execute("ALTER SEQUENCE ai.license_plans_plan_id_seq OWNED BY ai.license_plans.plan_id")
    op.execute("ALTER TABLE ai.license_detail ALTER COLUMN license_id SET DEFAULT nextval('ai.license_detail_license_id_seq')")
    op.execute("ALTER SEQUENCE ai.license_detail_license_id_seq OWNED BY ai.license_detail.license_id")
    op.execute(f"""
        INSERT INTO ai.license_plans(plan_id, test_type_id, plan_name, credits, validity_days, plan_cost)
        SELECT id, CASE WHEN upper(service) = 'CT' THEN {ct_test_type_id} ELSE {xray_test_type_id} END, name, credits,
               COALESCE(validity_days, 0), COALESCE(cost, 0)
        FROM public.license_plans ON CONFLICT (plan_id) DO NOTHING
    """)
    op.execute("""
        INSERT INTO ai.license_detail(
          license_id, license_key, plan_id, status, app_version_type, license_app_scope,
          credit_left, credit_available_online, ct_credits, start_date, end_date,
          fullname, username, mobile, address, vendor_name, geo_location, created_at, updated_at
        )
        SELECT d.id, d.license_key, d.plan_id,
          CASE upper(d.status) WHEN 'AVAILABLE' THEN 'A' WHEN 'IN USE' THEN 'U'
               WHEN 'CARRIED FORWARD' THEN 'CF' ELSE 'B' END,
          CASE WHEN upper(d.platform) IN ('DCP','DXP','CXR') THEN upper(d.platform) ELSE 'CXR' END,
          upper(d.service), d.credits_remaining, d.credits_remaining,
          CASE WHEN upper(d.service) = 'CT' THEN d.credits_remaining ELSE 0 END,
          d.starts_at, d.ends_at, d.full_name, d.username, d.mobile, d.location, d.vendor,
          CASE WHEN d.latitude IS NOT NULL AND d.longitude IS NOT NULL
               THEN d.latitude::text || ',' || d.longitude::text END,
          COALESCE(d.created_at, now()), COALESCE(d.updated_at, now())
        FROM public.desktop_licenses d
        JOIN ai.license_plans p ON p.plan_id = d.plan_id
        ON CONFLICT (license_id) DO NOTHING
    """)
    op.execute("SELECT setval('ai.license_plans_plan_id_seq', GREATEST(COALESCE((SELECT max(plan_id) FROM ai.license_plans), 0), 1), true)")
    op.execute("SELECT setval('ai.license_detail_license_id_seq', GREATEST(COALESCE((SELECT max(license_id) FROM ai.license_detail), 0), 1), true)")


def downgrade() -> None:
    # Keep migrated records intact; reverting application code must not drop license data.
    op.execute("ALTER TABLE ai.license_detail ALTER COLUMN license_id DROP DEFAULT")
    op.execute("ALTER TABLE ai.license_plans ALTER COLUMN plan_id DROP DEFAULT")
