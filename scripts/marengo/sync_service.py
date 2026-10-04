
import os
import json
import time
import queue
import logging
import threading
import select
import requests
import psycopg2

from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor


# ==================================================
# CONFIGURATION
# ==================================================

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
PORTAL_URL = os.getenv("PORTAL_URL")
PORTAL_TOKEN = os.getenv("PORTAL_TOKEN")

REQUEST_TIMEOUT = int(
    os.getenv("REQUEST_TIMEOUT", "15")
)


# This is basically the channel when ever a new study is success 
# this sends notifiaction 
CHANNEL = "report_sync_channel"

# In-memory FIFO queue  -> this is only active when the portal fails 
# to send the study and it keeps it in the queue.
report_queue = queue.Queue()

# Prevent duplicate enqueueing while an event is
# currently waiting or being processed.
queued_studies = set()

queue_lock = threading.Lock()
# delivery worker and listner acts differently

# ==================================================
# LOGGING
# ==================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)


# ==================================================
# DATABASE CONNECTION
# ==================================================

def get_connection():
    return psycopg2.connect(DATABASE_URL)


# ==================================================
# DATABASE TRIGGER SETUP
# ==================================================

# cursor -> tool that allows python to communicate SQL commands to postgresql.
# 

def initialize_database():

    conn = get_connection()

    try:
        with conn:
            with conn.cursor() as cur:

                cur.execute("""
                    CREATE OR REPLACE FUNCTION
                    notify_successful_report()

                    RETURNS TRIGGER AS $$

                    BEGIN

                        IF TG_OP = 'INSERT' THEN

                            IF NEW.status = 'SUCCESS' THEN

                                PERFORM pg_notify(
                                    'report_sync_channel',
                                    NEW.id::TEXT
                                );

                            END IF;

                        ELSIF NEW.status = 'SUCCESS'
                              AND OLD.status IS DISTINCT FROM 'SUCCESS'
                        THEN

                            PERFORM pg_notify(
                                'report_sync_channel',
                                NEW.id::TEXT
                            );

                        END IF;

                        RETURN NEW;

                    END;

                    $$ LANGUAGE plpgsql;
                """)

                cur.execute("""
                    DROP TRIGGER IF EXISTS
                    trg_report_sync ON studies;
                """)

                cur.execute("""
                    CREATE TRIGGER trg_report_sync

                    AFTER INSERT OR UPDATE OF status
                    ON studies

                    FOR EACH ROW

                    EXECUTE FUNCTION
                    notify_successful_report();
                """)

    finally:
        conn.close()

    logging.info("PostgreSQL notification trigger initialized.")


# ==================================================
# FETCH REPORT DATA
# ==================================================

def fetch_study_payload(study_id):

    conn = get_connection()

    try:

        with conn.cursor(
            cursor_factory=RealDictCursor
        ) as cur:

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
                    f"Successful study not found: {study_id}"
                )

            modality = (
                row["modality"] or ""
            ).strip().upper()

            investigation = " ".join([
                str(row["investigation_name"] or ""),
                str(row["service_type"] or "")
            ]).upper()

            xray_modalities = {
                "XR", "CR", "CRI", "DX", "MG"
            }

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
                or any(
                    word in investigation
                    for word in xray_keywords
                )
            )

            if is_xray:

                credits_used = int(
                    row["image_count"] or 0
                )

                if credits_used <= 0:

                    raise ValueError(
                        "X-Ray image count is missing or zero."
                    )

            else:

                credits_used = 1

            payload = {

                "modality": row["modality"],

                "processing_created_at": (
                    row["processing_created_at"].isoformat()
                    if row["processing_created_at"]
                    else None
                ),

                "processing_completed_at": (
                    row["processing_completed_at"].isoformat()
                    if row["processing_completed_at"]
                    else None
                ),

                "credits_used": credits_used

            }

            return payload

    finally:
        conn.close()


# ==================================================
# PORTAL DELIVERY
# ==================================================

def send_to_portal(study_id, payload):
    """Send one report, retrying with capped exponential backoff."""
    headers = {
        "Authorization": f"Bearer {PORTAL_TOKEN}",
        "Content-Type": "application/json",
        # Effective only if the portal backend honors this key.
        "Idempotency-Key": str(study_id),
    }

    attempt = 0
    while True:
        attempt += 1
        try:
            logging.info("Sending study %s | Attempt %s", study_id, attempt)
            response = requests.post(
                PORTAL_URL,
                json=payload,
                headers=headers,
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            logging.info(
                "Study %s successfully delivered. HTTP %s",
                study_id,
                response.status_code,
            )
            return response.status_code
        except requests.RequestException as exc:
            delay = min(2 ** (attempt - 1), 30)
            logging.exception(
                "Portal delivery failed for study %s on attempt %s. "
                "Retrying in %s seconds.",
                study_id,
                attempt,
                delay,
            )
            time.sleep(delay)


# ==================================================
# SINGLE FIFO DELIVERY WORKER
# ==================================================

def delivery_worker():
    logging.info("Sequential FIFO delivery worker started.")

    while True:
        study_id = report_queue.get()
        attempt = 0

        # Keep the current study at the head of processing until it is
        # delivered. The listener can continue adding new studies meanwhile.
        while True:
            attempt += 1
            try:
                logging.info(
                    "Processing FIFO report: %s | Processing attempt %s",
                    study_id,
                    attempt,
                )
                payload = fetch_study_payload(study_id)
                logging.info("Report payload for %s: %s", study_id, json.dumps(payload))
                send_to_portal(study_id, payload)
                logging.info("Completed delivery: %s", study_id)
                break
            except Exception:
                delay = min(2 ** (attempt - 1), 30)
                logging.exception(
                    "Could not prepare/deliver study %s. Retrying this same "
                    "study in %s seconds; later queue items will wait.",
                    study_id,
                    delay,
                )
                time.sleep(delay)

        with queue_lock:
            queued_studies.discard(study_id)
        report_queue.task_done()


# ==================================================
# ENQUEUE REPORT
# ==================================================

def enqueue_report(study_id):

    with queue_lock:

        if study_id in queued_studies:

            logging.info(
                "Study %s already queued. Skipping duplicate.",
                study_id
            )

            return

        queued_studies.add(study_id)
        report_queue.put(study_id)

    logging.info(
        "Study %s added to FIFO queue. Queue size: %s",
        study_id,
        report_queue.qsize()
    )


# ==================================================
# POSTGRESQL LISTENER
# ==================================================

def listen_for_reports():

    conn = get_connection()

    conn.autocommit = True

    with conn.cursor() as cur:
        cur.execute(f"LISTEN {CHANNEL};")

    logging.info(
        "Listening for successful report notifications."
    )

    try:

        while True:

            readable, _, _ = select.select(
                [conn],
                [],
                [],
                1
            )

            if readable:

                conn.poll()

                while conn.notifies:

                    notification = conn.notifies.pop(0)

                    study_id = notification.payload

                    logging.info(
                        "New successful report received: %s",
                        study_id
                    )

                    enqueue_report(study_id)

    finally:

        conn.close()


# ==================================================
# MAIN
# ==================================================

def main():

    if not DATABASE_URL or not PORTAL_URL or not PORTAL_TOKEN:

        raise RuntimeError(
            "Missing required .env configuration."
        )

    initialize_database()

    # Dedicated single delivery thread
    worker = threading.Thread(
        target=delivery_worker,
        daemon=True
    )

    worker.start()

    # Main thread continuously listens for new reports
    listen_for_reports()


if __name__ == "__main__":

    main()


