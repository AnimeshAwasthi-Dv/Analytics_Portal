
import os
import time
import json
import logging
import requests
import psycopg2

from datetime import datetime, timezone
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor, Json

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
PORTAL_URL = os.getenv("PORTAL_URL")
PORTAL_TOKEN = os.getenv("PORTAL_TOKEN")

REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "15"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "8"))
BASE_RETRY_SECONDS = int(os.getenv("BASE_RETRY_SECONDS", "5"))
MAX_RETRY_SECONDS = int(os.getenv("MAX_RETRY_SECONDS", "300"))
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "50"))

CHANNEL = "report_sync_channel"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)


def get_connection():
    return psycopg2.connect(DATABASE_URL)


# --------------------------------------------------
# DATABASE SETUP
# --------------------------------------------------

def initialize_database():
    conn = get_connection()

    try:
        with conn:
            with conn.cursor() as cur:

                cur.execute("""
                    CREATE TABLE IF NOT EXISTS report_sync_outbox (
                        id BIGSERIAL PRIMARY KEY,
                        study_id TEXT NOT NULL,
                        delivery_status TEXT NOT NULL DEFAULT 'PENDING',
                        attempts INTEGER NOT NULL DEFAULT 0,
                        next_attempt_at TIMESTAMPTZ NOT NULL
                            DEFAULT CURRENT_TIMESTAMP,
                        claimed_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ NOT NULL
                            DEFAULT CURRENT_TIMESTAMP,
                        sent_at TIMESTAMPTZ,
                        last_error TEXT
                    );
                """)

                cur.execute("""
                    CREATE INDEX IF NOT EXISTS
                    idx_report_sync_pending
                    ON report_sync_outbox
                    (next_attempt_at, id)
                    WHERE delivery_status IN ('PENDING', 'PROCESSING');
                """)

                cur.execute("""
                    CREATE OR REPLACE FUNCTION enqueue_report_sync()
                    RETURNS TRIGGER AS $$
                    BEGIN
                        IF TG_OP = 'INSERT' THEN
                            IF NEW.status = 'SUCCESS' THEN
                                INSERT INTO report_sync_outbox (study_id)
                                VALUES (NEW.id);
                            END IF;

                        ELSIF NEW.status = 'SUCCESS'
                              AND OLD.status IS DISTINCT FROM 'SUCCESS' THEN

                            INSERT INTO report_sync_outbox (study_id)
                            VALUES (NEW.id);
                        END IF;

                        RETURN NEW;
                    END;
                    $$ LANGUAGE plpgsql;
                """)

                cur.execute("""
                    DROP TRIGGER IF EXISTS trg_report_sync ON studies;
                """)

                cur.execute("""
                    CREATE TRIGGER trg_report_sync
                    AFTER INSERT OR UPDATE OF status ON studies
                    FOR EACH ROW
                    EXECUTE FUNCTION enqueue_report_sync();
                """)

    finally:
        conn.close()

    logging.info("Database trigger and outbox initialized.")


# --------------------------------------------------
# FETCH STUDY DATA
# --------------------------------------------------

def fetch_study_payload(study_id):
    conn = get_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            cur.execute("""
                SELECT
                    s.id,
                    s.modality,

                    pj."createdAt" AS processing_created_at,
                    pj."completedAt" AS processing_completed_at,
                    pj."imageCount" AS image_count,
                    pj."serviceType" AS service_type,

                    abs."studyDescription" AS investigation_name

                FROM studies s

                LEFT JOIN LATERAL (
                    SELECT
                        p."createdAt",
                        p."completedAt",
                        p."imageCount",
                        p."serviceType",
                        p.id

                    FROM processing_jobs p
                    WHERE p."internalJobId" = s.id

                    ORDER BY p."createdAt" DESC
                    LIMIT 1
                ) pj ON TRUE

                LEFT JOIN available_bridge_studies abs
                    ON abs."processingJobId" = pj.id

                WHERE s.id = %s
                  AND s.status = 'SUCCESS'

                LIMIT 1;
            """, (study_id,))

            row = cur.fetchone()

            if not row:
                raise ValueError(
                    f"Successful study data not found: {study_id}"
                )

            modality = (row["modality"] or "").strip().upper()

            investigation = " ".join([
                str(row["investigation_name"] or ""),
                str(row["service_type"] or "")
            ]).upper()

            xray_modalities = {"XR", "CR", "CRI", "DX", "MG"}

            xray_keywords = (
                "X-RAY",
                "XRAY",
                "MAMMO",
                "MAMMOGRAPHY",
                "BARIUM SWALLOW",
                "MCT",
                "MCU",
                "URETHROGRAM",
                "CYSTOURETHROGRAM",
                "GENITOURETHROGRAM",
                "BARIUM ENEMA",
                "FLUORO",
                "FLUOROSCOPY",
                "IVU",
                "CONTRAST SWALLOW",
                "FISTULOGRAM",
                "DYE STUDY"
            )

            is_xray = (
                modality in xray_modalities
                or any(word in investigation for word in xray_keywords)
            )

            if is_xray:
                credits_used = int(row["image_count"] or 0)

                if credits_used <= 0:
                    raise ValueError(
                        "X-Ray image count is missing or zero. "
                        "Not sending an incorrect credit value."
                    )
            else:
                credits_used = 1

            payload = {
                "modality": row["modality"],
                "processing_created_at": (
                    row["processing_created_at"].isoformat()
                    if row["processing_created_at"] else None
                ),
                "processing_completed_at": (
                    row["processing_completed_at"].isoformat()
                    if row["processing_completed_at"] else None
                ),
                "credits_used": credits_used
            }

            return payload

    finally:
        conn.close()


# --------------------------------------------------
# CLAIM EVENTS
# --------------------------------------------------

def claim_pending_events():
    conn = get_connection()

    try:
        with conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:

                # Recover events abandoned by a crashed worker.
                cur.execute("""
                    UPDATE report_sync_outbox
                    SET delivery_status = 'PENDING',
                        claimed_at = NULL
                    WHERE delivery_status = 'PROCESSING'
                      AND claimed_at < NOW() - INTERVAL '5 minutes';
                """)

                cur.execute("""
                    WITH selected AS (
                        SELECT id
                        FROM report_sync_outbox
                        WHERE delivery_status = 'PENDING'
                          AND next_attempt_at <= NOW()
                        ORDER BY id
                        LIMIT %s
                        FOR UPDATE SKIP LOCKED
                    )
                    UPDATE report_sync_outbox o
                    SET delivery_status = 'PROCESSING',
                        claimed_at = NOW()
                    FROM selected
                    WHERE o.id = selected.id
                    RETURNING o.id, o.study_id, o.attempts;
                """, (BATCH_SIZE,))

                return cur.fetchall()

    finally:
        conn.close()


# --------------------------------------------------
# PORTAL REQUEST
# --------------------------------------------------

def send_to_portal(event_id, payload):
    headers = {
        "Authorization": f"Bearer {PORTAL_TOKEN}",
        "Content-Type": "application/json",
        "Idempotency-Key": str(event_id)
    }

    response = requests.post(
        PORTAL_URL,
        json=payload,
        headers=headers,
        timeout=REQUEST_TIMEOUT
    )

    response.raise_for_status()

    return response.status_code


# --------------------------------------------------
# DELIVERY STATUS
# --------------------------------------------------

def mark_sent(event_id):
    conn = get_connection()

    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE report_sync_outbox
                    SET delivery_status = 'SENT',
                        sent_at = NOW(),
                        claimed_at = NULL,
                        last_error = NULL
                    WHERE id = %s;
                """, (event_id,))

    finally:
        conn.close()


def mark_retry(event_id, attempts, error):
    delay = min(
        BASE_RETRY_SECONDS * (2 ** attempts),
        MAX_RETRY_SECONDS
    )

    conn = get_connection()

    try:
        with conn:
            with conn.cursor() as cur:

                if attempts >= MAX_RETRIES:
                    cur.execute("""
                        UPDATE report_sync_outbox
                        SET delivery_status = 'DEAD',
                            attempts = %s,
                            claimed_at = NULL,
                            last_error = %s
                        WHERE id = %s;
                    """, (attempts, str(error)[:4000], event_id))

                    logging.error(
                        "Event %s exhausted retries.", event_id
                    )

                else:
                    cur.execute("""
                        UPDATE report_sync_outbox
                        SET delivery_status = 'PENDING',
                            attempts = %s,
                            next_attempt_at =
                                NOW() + (%s * INTERVAL '1 second'),
                            claimed_at = NULL,
                            last_error = %s
                        WHERE id = %s;
                    """, (
                        attempts,
                        delay,
                        str(error)[:4000],
                        event_id
                    ))

                    logging.warning(
                        "Event %s retry in %s seconds.",
                        event_id, delay
                    )

    finally:
        conn.close()


# --------------------------------------------------
# PROCESS EVENTS
# --------------------------------------------------

def process_pending_events():
    events = claim_pending_events()

    for event in events:
        event_id = event["id"]
        study_id = event["study_id"]
        attempts = event["attempts"]

        try:
            payload = fetch_study_payload(study_id)

            logging.info(
                "Sending event %s | payload=%s",
                event_id,
                json.dumps(payload)
            )

            status_code = send_to_portal(event_id, payload)

            mark_sent(event_id)

            logging.info(
                "Event %s delivered. HTTP %s",
                event_id, status_code
            )

        except Exception as exc:
            mark_retry(event_id, attempts + 1, exc)

            logging.exception(
                "Event %s delivery failed.", event_id
            )


# --------------------------------------------------
# LISTENER
# --------------------------------------------------

def main():
    if not DATABASE_URL or not PORTAL_URL or not PORTAL_TOKEN:
        raise RuntimeError("Missing required .env configuration.")

    initialize_database()

    while True:
        conn = None

        try:
            conn = get_connection()
            conn.autocommit = True

            with conn.cursor() as cur:
                cur.execute(f"LISTEN {CHANNEL};")

            logging.info("Listening on PostgreSQL channel.")

            # Drain existing events after LISTEN is active.
            process_pending_events()

            while True:
                if conn.notifies:
                    conn.notifies.clear()
                    process_pending_events()

                # Wait for a notification; no periodic DB polling.
                if not conn.poll():
                    time.sleep(0.2)

        except KeyboardInterrupt:
            logging.info("Worker stopped.")
            break

        except Exception:
            logging.exception(
                "Listener disconnected. Reconnecting in 5 seconds."
            )
            time.sleep(5)

        finally:
            if conn:
                conn.close()


if __name__ == "__main__":
    main()