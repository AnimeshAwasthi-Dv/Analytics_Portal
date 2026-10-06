import os
import json
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

# PostgreSQL LISTEN/NOTIFY channel
CHANNEL = "report_sync_channel"


# ==================================================
# QUEUES
# ==================================================

# Queue containing NEW successful studies.
#
# This queue contains study IDs because we need the
# study ID to fetch the payload from PostgreSQL.
#
# Example:
# [101, 102, 103]
#
report_queue = queue.Queue()

#queue for failure retries

# Queue containing ONLY failed payloads.
#
# IMPORTANT:
# No study ID is stored here.
#
# Example:
#
# [
#     {
#         "modality": "CT",
#         "processing_created_at": "...",
#         "processing_completed_at": "...",
#         "credits_used": 1
#     }
# ]
#
retry_queue = queue.Queue()


# Prevent duplicate processing of the same NEW study
# while it is waiting in the new-study queue.
queued_studies = set()

queue_lock = threading.Lock()


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

def initialize_database():

    conn = get_connection()

    try:

        with conn:

            with conn.cursor() as cur:

                # ------------------------------------------
                # Create / replace PostgreSQL notification
                # function
                # ------------------------------------------

                cur.execute("""
                    CREATE OR REPLACE FUNCTION
                    notify_successful_report()

                    RETURNS TRIGGER AS $$

                    BEGIN

                        -- New study inserted directly as SUCCESS
                        IF TG_OP = 'INSERT' THEN

                            IF NEW.status = 'SUCCESS' THEN

                                PERFORM pg_notify(
                                    'report_sync_channel',
                                    NEW.id::TEXT
                                );

                            END IF;


                        -- Existing study changes to SUCCESS
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


                # ------------------------------------------
                # Remove old trigger if it exists
                # ------------------------------------------

                cur.execute("""
                    DROP TRIGGER IF EXISTS
                    trg_report_sync
                    ON studies;
                """)


                # ------------------------------------------
                # Create trigger
                # ------------------------------------------

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


    logging.info(
        "PostgreSQL notification trigger initialized."
    )


# ==================================================
# FETCH REPORT PAYLOAD
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

                    pj."createdAt"
                        AS processing_created_at,

                    pj."completedAt"
                        AS processing_completed_at,

                    pj."imageCount"
                        AS image_count,

                    pj."serviceType"
                        AS service_type,

                    abs."studyDescription"
                        AS investigation_name

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


            # ==================================================
            # DETERMINE MODALITY
            # ==================================================

            modality = (
                row["modality"] or ""
            ).strip().upper()


            investigation = " ".join([
                str(row["investigation_name"] or ""),
                str(row["service_type"] or "")
            ]).upper()


            # ==================================================
            # X-RAY DETECTION
            # ==================================================

            xray_modalities = {
                "XR",
                "CR",
                "CRI",
                "DX",
                "MG"
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


            # ==================================================
            # CALCULATE CREDITS
            # ==================================================

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


            # ==================================================
            # BUILD PAYLOAD
            # ==================================================

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

def send_to_portal(payload):
    """
    Attempt to send one payload to the portal.

    IMPORTANT:
    This function performs ONLY ONE attempt.

    It does NOT retry internally.

    If it fails, the caller decides what to do
    with the payload.
    """

    headers = {

        "Authorization":
            f"Bearer {PORTAL_TOKEN}",

        "Content-Type":
            "application/json"

    }


    try:

        logging.info(
            "Sending payload to portal: %s",
            json.dumps(payload)
        )


        response = requests.post(

            PORTAL_URL,

            json=payload,

            headers=headers,

            timeout=REQUEST_TIMEOUT
        )


        response.raise_for_status()


        logging.info(
            "Portal delivery successful. HTTP %s",
            response.status_code
        )


        return True


    except requests.RequestException as exc:

        logging.error(
            "Portal delivery failed: %s",
            exc
        )


        return False


# ==================================================
# RETRY QUEUE
# ==================================================

def enqueue_failed_payload(payload):

    """
    Add ONLY the payload to the retry queue.

    Study ID is intentionally NOT stored.
    """

    retry_queue.put(payload)


    logging.warning(
        "Payload added to retry queue. "
        "Retry queue size: %s",
        retry_queue.qsize()
    )


# ==================================================
# RETRY FAILED PAYLOADS
# ==================================================

def retry_failed_payloads():

    """
    Retry the payloads that previously failed.

    Important behavior:

    If a payload succeeds:
        Remove it from retry queue.

    If a payload fails:
        Put it back into retry queue.

    We process only the number of items that were
    already present when this function started.

    Therefore, a failed retry does not create an
    infinite loop inside this function.
    """

    retry_count = retry_queue.qsize()


    if retry_count == 0:

        logging.info(
            "No failed payloads waiting for retry."
        )

        return


    logging.info(
        "Starting retry of %s failed payload(s).",
        retry_count
    )


    for _ in range(retry_count):

        try:

            payload = retry_queue.get_nowait()

        except queue.Empty:

            break


        try:

            logging.info(
                "Retrying previously failed payload."
            )


            success = send_to_portal(
                payload
            )


            if success:

                logging.info(
                    "Previously failed payload "
                    "delivered successfully."
                )


            else:

                logging.warning(
                    "Retry failed. "
                    "Keeping payload in retry queue."
                )


                retry_queue.put(
                    payload
                )


        except Exception:

            logging.exception(
                "Unexpected error while retrying payload."
            )


            # Put it back into the queue
            retry_queue.put(
                payload
            )


        finally:

            retry_queue.task_done()


    logging.info(
        "Finished retry cycle. "
        "Remaining retry queue size: %s",
        retry_queue.qsize()
    )


# ==================================================
# ENQUEUE NEW SUCCESSFUL STUDY
# ==================================================

def enqueue_report(study_id):

    """
    Add a newly successful study to the NEW STUDY queue.

    The study ID is used here only because we still
    need it to fetch the payload from PostgreSQL.

    It is NOT stored in the failed retry queue.
    """

    with queue_lock:

        if study_id in queued_studies:

            logging.info(
                "Study %s already waiting for processing. "
                "Skipping duplicate notification.",
                study_id
            )

            return


        queued_studies.add(
            study_id
        )


    report_queue.put(
        study_id
    )


    logging.info(
        "New successful study %s added to processing queue. "
        "Queue size: %s",
        study_id,
        report_queue.qsize()
    )


# ==================================================
# PROCESS NEW STUDY
# ==================================================

def process_new_study(study_id):

    """
    Process one NEW successful study.

    Flow:

        Study SUCCESS
              ↓
        Fetch payload
              ↓
        Send to portal
          /           \
       SUCCESS       FAIL
         ↓             ↓
       DONE       Retry Queue
    """

    logging.info(
        "Processing new successful study: %s",
        study_id
    )


    try:

        # ------------------------------------------
        # Fetch payload from database
        # ------------------------------------------

        payload = fetch_study_payload(
            study_id
        )


        logging.info(
            "Payload fetched for study %s: %s",
            study_id,
            json.dumps(payload)
        )


        # ------------------------------------------
        # Immediate portal attempt
        # ------------------------------------------

        success = send_to_portal(
            payload
        )


        # ------------------------------------------
        # SUCCESS
        # ------------------------------------------

        if success:

            logging.info(
                "New study %s delivered successfully.",
                study_id
            )


            # Since a NEW study was successfully delivered,
            # now attempt previously failed payloads.

            retry_failed_payloads()


        # ------------------------------------------
        # FAILURE
        # ------------------------------------------

        else:

            logging.warning(
                "New study %s failed portal delivery. "
                "Saving payload in retry queue.",
                study_id
            )


            enqueue_failed_payload(
                payload
            )


    except Exception:

        logging.exception(
            "Failed to prepare/process new study %s.",
            study_id
        )


# ==================================================
# SINGLE DELIVERY WORKER
# ==================================================

def delivery_worker():

    """
    Main delivery worker.

    IMPORTANT:

    A failed NEW study does NOT block later studies.

    Example:

        A → FAIL → retry queue

        B → SUCCESS → portal

        retry A

    """

    logging.info(
        "Non-blocking delivery worker started."
    )


    while True:

        # Wait for a NEW successful study

        study_id = report_queue.get()


        try:

            process_new_study(
                study_id
            )


        except Exception:

            logging.exception(
                "Unexpected worker error for study %s.",
                study_id
            )


        finally:

            with queue_lock:

                queued_studies.discard(
                    study_id
                )


            report_queue.task_done()


# ==================================================
# POSTGRESQL LISTENER
# ==================================================

def listen_for_reports():

    """
    Continuously listen for PostgreSQL NOTIFY events.

    When a study becomes SUCCESS:

        PostgreSQL
             ↓
        NOTIFY
             ↓
        Listener
             ↓
        New study queue
    """

    conn = get_connection()

    conn.autocommit = True


    with conn.cursor() as cur:

        cur.execute(
            f"LISTEN {CHANNEL};"
        )


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

                    notification = (
                        conn.notifies.pop(0)
                    )


                    study_id = (
                        notification.payload
                    )


                    logging.info(
                        "New successful study notification received: %s",
                        study_id
                    )


                    enqueue_report(
                        study_id
                    )


    finally:

        conn.close()


# ==================================================
# MAIN
# ==================================================

def main():

    # ----------------------------------------------
    # Validate configuration
    # ----------------------------------------------

    if (
        not DATABASE_URL
        or not PORTAL_URL
        or not PORTAL_TOKEN
    ):

        raise RuntimeError(
            "Missing required .env configuration."
        )


    # ----------------------------------------------
    # Initialize PostgreSQL trigger
    # ----------------------------------------------

    initialize_database()


    # ----------------------------------------------
    # Start delivery worker
    # ----------------------------------------------

    worker = threading.Thread(

        target=delivery_worker,

        daemon=True,

        name="PortalDeliveryWorker"
    )


    worker.start()


    logging.info(
        "Portal delivery service started."
    )


    # ----------------------------------------------
    # Main thread listens for PostgreSQL events
    # ----------------------------------------------

    listen_for_reports()


# ==================================================
# APPLICATION ENTRY POINT
# ==================================================

if __name__ == "__main__":

    main()