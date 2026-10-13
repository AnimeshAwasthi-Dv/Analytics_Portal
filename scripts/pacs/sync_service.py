import json
import logging
import os
import queue
import select
import threading

import psycopg2
import requests
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor


# ============================================================
# CONFIGURATION
# ============================================================

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
PORTAL_URL = os.getenv("PORTAL_URL")
PORTAL_TOKEN = os.getenv("PORTAL_TOKEN")
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "15"))

# PostgreSQL LISTEN/NOTIFY channel used by the trigger below.
CHANNEL = "report_sync_channel"

# The schema has processing_jobs, not a "studies" table.
SOURCE_TABLE = "public.processing_jobs"

report_queue = queue.Queue()
retry_queue = queue.Queue()

queued_studies = set()
queue_lock = threading.Lock()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


# ============================================================
# DATABASE CONNECTION
# ============================================================

def get_connection():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured.")
    return psycopg2.connect(DATABASE_URL)


# ============================================================
# DATABASE NOTIFICATION TRIGGER
# ============================================================

def initialize_database():
    """
    Install a trigger on public.processing_jobs.

    In pacs_portal.sql:
      - processing_jobs.id is the processing-job primary identifier.
      - processing_jobs.status is text (default 'queued').
      - available_bridge_studies."processingJobId" points to
        processing_jobs.id.
    Status comparison is case-insensitive to support both 'SUCCESS'
    and 'success'.
    """
    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE OR REPLACE FUNCTION public.notify_successful_report()
                    RETURNS TRIGGER
                    LANGUAGE plpgsql
                    AS $$
                    BEGIN
                        IF UPPER(BTRIM(NEW.status)) = 'SUCCESS'
                           AND (
                               TG_OP = 'INSERT'
                               OR UPPER(BTRIM(OLD.status)) IS DISTINCT FROM 'SUCCESS'
                           )
                        THEN
                            PERFORM pg_notify(
                                'report_sync_channel',
                                NEW.id::text
                            );
                        END IF;

                        RETURN NEW;
                    END;
                    $$;
                    """
                )

                cur.execute(
                    """
                    DROP TRIGGER IF EXISTS trg_report_sync
                    ON public.processing_jobs;
                    """
                )

                cur.execute(
                    """
                    CREATE TRIGGER trg_report_sync
                    AFTER INSERT OR UPDATE OF status
                    ON public.processing_jobs
                    FOR EACH ROW
                    EXECUTE FUNCTION public.notify_successful_report();
                    """
                )

        logging.info(
            "Notification trigger installed on %s.", SOURCE_TABLE
        )
    finally:
        conn.close()


# ============================================================
# FETCH A SUCCESSFUL JOB USING THE PACS PORTAL SCHEMA
# ============================================================

def fetch_study_payload(study_id):
    """
    Fetch the processing job and its matching bridge-study metadata.

    There is no public.studies table in pacs_portal.sql. The source
    record is public.processing_jobs, and bridge metadata is joined
    using available_bridge_studies."processingJobId" = processing_jobs.id.

    The outbound payload deliberately retains the original API fields.
    """
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    pj.id AS processing_job_id,
                    pj."clientId" AS client_id,
                    pj.status AS job_status,
                    pj."createdAt" AS processing_created_at,
                    pj."completedAt" AS processing_completed_at,
                    pj."imageCount" AS image_count,
                    pj."serviceType" AS service_type,
                    pj."uploadName" AS upload_name,
                    abs."studyDescription" AS investigation_name,
                    abs.modalities[1] AS bridge_modality
                FROM public.processing_jobs AS pj
                LEFT JOIN LATERAL (
                    SELECT
                        b."studyDescription",
                        b.modalities,
                        b."updatedAt"
                    FROM public.available_bridge_studies AS b
                    WHERE b."processingJobId" = pj.id
                    ORDER BY b."updatedAt" DESC NULLS LAST,
                             b."createdAt" DESC NULLS LAST
                    LIMIT 1
                ) AS abs ON TRUE
                WHERE pj.id = %s
                  AND UPPER(BTRIM(pj.status)) = 'SUCCESS'
                LIMIT 1;
                """,
                (str(study_id),),
            )
            row = cur.fetchone()

            if not row:
                raise ValueError(
                    "Successful processing job not found or status is not "
                    f"SUCCESS: {study_id}"
                )

            modality = (
                row["bridge_modality"] or row["service_type"] or ""
            ).strip().upper()

            investigation = " ".join(
                str(value or "")
                for value in (
                    row["investigation_name"],
                    row["upload_name"],
                    row["service_type"],
                )
            ).upper()

            # Preserve the original X-ray credit rule.
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
                "DYE STUDY",
            )

            is_xray = (
                modality in xray_modalities
                or any(keyword in investigation for keyword in xray_keywords)
            )

            if is_xray:
                credits_used = int(row["image_count"] or 0)
                if credits_used <= 0:
                    raise ValueError(
                        "X-ray image count is missing or zero for "
                        f"processing job {study_id}."
                    )
            else:
                credits_used = 1

            description = (
                row["investigation_name"]
                or row["upload_name"]
                or row["service_type"]
            )

            # Keep the existing portal payload contract unchanged.
            return {
                "modality": modality or row["service_type"],
                "study_description": description,
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
                "credits_used": credits_used,
            }
    finally:
        conn.close()


# ============================================================
# PORTAL DELIVERY
# ============================================================

def send_to_portal(payload):
    """Make one portal request; retry decisions are handled by the caller."""
    headers = {
        "Authorization": f"Bearer {PORTAL_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        logging.info("Sending payload to portal: %s", json.dumps(payload))
        response = requests.post(
            PORTAL_URL,
            json=payload,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        logging.info("Portal delivery successful. HTTP %s", response.status_code)
        return True
    except requests.RequestException as exc:
        logging.error("Portal delivery failed: %s", exc)
        return False


# ============================================================
# IN-MEMORY RETRY QUEUE
# ============================================================

def enqueue_failed_payload(payload):
    # This queue stores payloads only, matching the original behavior.
    retry_queue.put(payload)
    logging.warning(
        "Payload added to retry queue. Queue size: %s",
        retry_queue.qsize(),
    )


def retry_failed_payloads():
    # Process only the items that were queued at the start of this cycle.
    retry_count = retry_queue.qsize()
    if retry_count == 0:
        return

    logging.info("Retrying %s failed payload(s).", retry_count)

    for _ in range(retry_count):
        try:
            payload = retry_queue.get_nowait()
        except queue.Empty:
            break

        try:
            if send_to_portal(payload):
                logging.info("Previously failed payload delivered successfully.")
            else:
                logging.warning("Retry failed; retaining payload in retry queue.")
                retry_queue.put(payload)
        except Exception:
            logging.exception("Unexpected error while retrying payload.")
            retry_queue.put(payload)
        finally:
            retry_queue.task_done()

    logging.info("Retry cycle complete. Remaining: %s", retry_queue.qsize())


# ============================================================
# QUEUE NEW SUCCESSFUL PROCESSING JOBS
# ============================================================

def enqueue_report(study_id):
    study_id = str(study_id)
    with queue_lock:
        if study_id in queued_studies:
            logging.info("Job %s is already queued; skipping duplicate.", study_id)
            return
        queued_studies.add(study_id)

    report_queue.put(study_id)
    logging.info(
        "Successful processing job %s queued. Queue size: %s",
        study_id,
        report_queue.qsize(),
    )


def process_new_study(study_id):
    logging.info("Processing successful job: %s", study_id)

    try:
        payload = fetch_study_payload(study_id)
        logging.info(
            "Payload fetched for processing job %s: %s",
            study_id,
            json.dumps(payload),
        )

        if send_to_portal(payload):
            logging.info("Processing job %s delivered successfully.", study_id)
            retry_failed_payloads()
        else:
            enqueue_failed_payload(payload)
    except Exception:
        # A database/payload error is logged. It is not retried because the
        # existing retry queue contains only payloads that were built.
        logging.exception("Could not prepare/process job %s.", study_id)


# ============================================================
# SINGLE DELIVERY WORKER
# ============================================================

def delivery_worker():
    logging.info("Non-blocking delivery worker started.")

    while True:
        study_id = report_queue.get()
        try:
            process_new_study(study_id)
        except Exception:
            logging.exception("Unexpected worker error for job %s.", study_id)
        finally:
            with queue_lock:
                queued_studies.discard(study_id)
            report_queue.task_done()


# ============================================================
# POSTGRESQL LISTENER
# ============================================================

def listen_for_reports():
    """
    Listen for notifications. Reconnect automatically if the listener
    connection drops; trigger notifications are not persisted by PostgreSQL.
    """
    while True:
        conn = None
        try:
            conn = get_connection()
            conn.autocommit = True

            with conn.cursor() as cur:
                cur.execute("LISTEN report_sync_channel;")

            logging.info("Listening for successful processing-job notifications.")

            while True:
                readable, _, _ = select.select([conn], [], [], 5)
                if not readable:
                    continue

                conn.poll()
                while conn.notifies:
                    notification = conn.notifies.pop(0)
                    logging.info(
                        "Received successful job notification: %s",
                        notification.payload,
                    )
                    enqueue_report(notification.payload)

        except (psycopg2.Error, OSError, ValueError):
            logging.exception("PostgreSQL listener disconnected; reconnecting.")
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


# ============================================================
# MAIN
# ============================================================

def main():
    if not DATABASE_URL or not PORTAL_URL or not PORTAL_TOKEN:
        raise RuntimeError(
            "Missing required .env setting(s): DATABASE_URL, PORTAL_URL, "
            "PORTAL_TOKEN."
        )

    initialize_database()

    worker = threading.Thread(
        target=delivery_worker,
        daemon=True,
        name="PortalDeliveryWorker",
    )
    worker.start()

    logging.info("PACS portal sync service started.")
    listen_for_reports()


if __name__ == "__main__":
    main()
