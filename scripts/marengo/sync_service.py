import os
import time
import json
import sqlite3
import logging

from datetime import datetime, timezone

import psycopg2
import requests

from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv


# --------------------------------------------------
# 1. LOAD CONFIGURATION
# --------------------------------------------------

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "sslmode": os.getenv("DB_SSLMODE", "require"),
    "connect_timeout": 10,
}

PORTAL_API_URL = os.getenv("PORTAL_API_URL")
PORTAL_API_KEY = os.getenv("PORTAL_API_KEY")

POLL_SECONDS = int(os.getenv("POLL_SECONDS", "5"))
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "50"))

SQLITE_FILE = "sync_state.db"


# --------------------------------------------------
# 2. LOGGING
# --------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

logger = logging.getLogger("decxpert-sync")


# --------------------------------------------------
# 3. LOCAL CHECKPOINT DATABASE
# --------------------------------------------------

def init_checkpoint():

    with sqlite3.connect(SQLITE_FILE) as conn:

        conn.execute("""
            CREATE TABLE IF NOT EXISTS sync_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                last_synced_at TEXT,
                last_report_id TEXT
            )
        """)

        conn.execute("""
            INSERT OR IGNORE INTO sync_state (
                id,
                last_synced_at,
                last_report_id
            )
            VALUES (1, NULL, NULL)
        """)

        conn.commit()


def get_checkpoint():

    with sqlite3.connect(SQLITE_FILE) as conn:

        row = conn.execute("""
            SELECT last_synced_at, last_report_id
            FROM sync_state
            WHERE id = 1
        """).fetchone()

    return row


def save_checkpoint(pushed_at, report_id):

    with sqlite3.connect(SQLITE_FILE) as conn:

        conn.execute("""
            UPDATE sync_state
            SET last_synced_at = ?,
                last_report_id = ?
            WHERE id = 1
        """, (
            pushed_at.isoformat(),
            str(report_id)
        ))

        conn.commit()


def initialize_first_checkpoint():

    last_time, last_id = get_checkpoint()

    if last_time is not None:
        return

    initial_time = os.getenv("INITIAL_SYNC_FROM", "").strip()

    if initial_time:

        parsed_time = datetime.fromisoformat(
            initial_time.replace("Z", "+00:00")
        )

    else:

        parsed_time = datetime.now(timezone.utc)

        logger.warning(
            "No INITIAL_SYNC_FROM provided. "
            "Starting from current UTC time; "
            "older reports will not be backfilled."
        )

    save_checkpoint(parsed_time, "")

    logger.info(
        "Initial checkpoint established: %s",
        parsed_time.isoformat()
    )


# --------------------------------------------------
# 4. DATABASE CONNECTION
# --------------------------------------------------

def get_db_connection():

    return psycopg2.connect(
        **DB_CONFIG,
        cursor_factory=RealDictCursor
    )


# --------------------------------------------------
# 5. FETCH NEW PUSHED REPORTS
# --------------------------------------------------

def fetch_new_reports():

    last_time, last_id = get_checkpoint()

    if not last_time:
        return []

    checkpoint_time = datetime.fromisoformat(last_time)

    query = """
        SELECT
            rr."id" AS report_id,
            rr."studyId" AS study_id,
            rr."clientId" AS client_id,

            rr."studyUid" AS study_uid,
            rr."serviceName" AS service_name,
            rr."modality" AS modality,
            rr."status" AS report_status,

            rr."generatedAt" AS ai_generated_at,
            rr."reviewedAt" AS reviewed_at,
            rr."approvedAt" AS approved_at,
            rr."pushedAt" AS pushed_at,

            s."createdAt" AS study_created_at,

            c."code" AS client_code,

            COALESCE(
                (
                    SELECT SUM(ul."creditsUsed")
                    FROM "usage_logs" ul
                    WHERE ul."clientId" = rr."clientId"
                      AND ul."studyUid" = rr."studyUid"
                      AND ul."serviceName" = rr."serviceName"
                      AND ul."success" = TRUE
                ),
                0
            ) AS credits_used

        FROM "report_reviews" rr

        JOIN "clients" c
            ON c."id" = rr."clientId"

        LEFT JOIN "studies" s
            ON s."id" = rr."studyId"

        WHERE
            rr."status" = 'PUSHED'
            AND rr."pushedAt" IS NOT NULL
            AND (
                rr."pushedAt" > %s
                OR (
                    rr."pushedAt" = %s
                    AND rr."id"::text > %s
                )
            )

        ORDER BY
            rr."pushedAt" ASC,
            rr."id"::text ASC

        LIMIT %s
    """

    with get_db_connection() as conn:

        with conn.cursor() as cursor:

            cursor.execute(query, (
                checkpoint_time,
                checkpoint_time,
                last_id,
                BATCH_SIZE
            ))

            return cursor.fetchall()


# --------------------------------------------------
# 6. DATETIME CONVERSION
# --------------------------------------------------

def format_datetime(value):

    if value is None:
        return None

    return value.isoformat()


# --------------------------------------------------
# 7. BUILD PORTAL PAYLOAD
# --------------------------------------------------

def build_payload(row):

    return {
        "report_id": str(row["report_id"]),

        "study_uid": row["study_uid"],

        "client_code": row["client_code"],

        "modality": row["modality"],

        "service_name": row["service_name"],

        "report_status": row["report_status"],

        "timestamps": {
            "study_created_at": format_datetime(
                row["study_created_at"]
            ),

            "ai_generated_at": format_datetime(
                row["ai_generated_at"]
            ),

            "reviewed_at": format_datetime(
                row["reviewed_at"]
            ),

            "approved_at": format_datetime(
                row["approved_at"]
            ),

            "pushed_at": format_datetime(
                row["pushed_at"]
            ),
        },

        "credits": {
            "credits_used": int(row["credits_used"])
        }
    }


# --------------------------------------------------
# 8. SEND DATA TO PORTAL
# --------------------------------------------------

def send_to_portal(payload):

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {PORTAL_API_KEY}",

        # Portal must support this idempotency key
        "Idempotency-Key": payload["report_id"]
    }

    response = requests.post(
        PORTAL_API_URL,
        json=payload,
        headers=headers,
        timeout=30
    )

    if not response.ok:

        raise RuntimeError(
            f"Portal API failed: "
            f"{response.status_code} - {response.text}"
        )

    logger.info(
        "Portal accepted report %s",
        payload["report_id"]
    )


# --------------------------------------------------
# 9. ONE SYNC CYCLE
# --------------------------------------------------

def sync_once():

    reports = fetch_new_reports()

    if not reports:

        logger.info("No new reports")

        return

    logger.info(
        "Found %s new report(s)",
        len(reports)
    )

    for row in reports:

        report_id = str(row["report_id"])

        try:

            payload = build_payload(row)

            logger.info(
                "Sending report: %s",
                report_id
            )

            send_to_portal(payload)

            # Save checkpoint ONLY after portal success
            save_checkpoint(
                row["pushed_at"],
                row["report_id"]
            )

            logger.info(
                "Checkpoint updated: %s",
                report_id
            )

        except Exception:

            logger.exception(
                "Failed report %s. "
                "Checkpoint not advanced.",
                report_id
            )

            # Stop here; retry this report next cycle
            break


# --------------------------------------------------
# 10. CONTINUOUS SERVICE
# --------------------------------------------------

def run_service():

    init_checkpoint()

    initialize_first_checkpoint()

    logger.info(
        "DecXpert sync service started. Polling every %s seconds.",
        POLL_SECONDS
    )

    while True:

        try:

            sync_once()

        except Exception:

            logger.exception(
                "Sync cycle failed"
            )

        time.sleep(POLL_SECONDS)


# --------------------------------------------------
# 11. ENTRY POINT
# --------------------------------------------------

if __name__ == "__main__":

    run_service()