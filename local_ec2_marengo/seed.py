
import os
import random
from datetime import datetime, timedelta

import psycopg2
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
INSTANCE_CODE = os.getenv("SIMULATOR_INSTANCE_CODE", "ec2-marengo-1")

STUDY_TYPES = [
    ("CT", "CT Chest Study"),
    ("MRI", "MRI Brain Study"),
    ("XR", "Chest X-Ray"),
    ("XR", "Barium Swallow Special X-Ray"),
    ("MG", "Screening Mammography"),
    ("PT", "PET-CT Whole Body"),
    ("US", "Abdominal Ultrasound"),
    ("SR", "Structured Report"),
]


def create_study(cur, modality, description, image_count, created_at, completed_at):
    cur.execute(
        """
        INSERT INTO studies (modality, status, instance_code)
        VALUES (%s, 'SUCCESS', %s)
        RETURNING id
        """,
        (modality, INSTANCE_CODE),
    )
    study_id = cur.fetchone()[0]

    cur.execute(
        """
        INSERT INTO processing_jobs
            ("internalJobId", "createdAt", "completedAt", "imageCount", "serviceType")
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
        """,
        (study_id, created_at, completed_at, image_count, description),
    )
    job_id = cur.fetchone()[0]

    cur.execute(
        """
        INSERT INTO available_bridge_studies ("processingJobId", "studyDescription")
        VALUES (%s, %s)
        """,
        (job_id, description),
    )


def main():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is missing from the .env file.")

    random.seed()

    with psycopg2.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            for _ in range(50):
                modality, description = random.choice(STUDY_TYPES)

                # X-ray, special X-ray, and mammography use image counts.
                image_count = (
                    random.randint(1, 5)
                    if modality == "XR" or modality == "MG"
                    else random.randint(100, 800)
                )

                created_at = datetime.now() - timedelta(
                    days=random.randint(0, 30),
                    hours=random.randint(0, 23),
                    minutes=random.randint(0, 59),
                )
                completed_at = created_at + timedelta(
                    minutes=random.randint(2, 25)
                )

                create_study(
                    cur,
                    modality,
                    description,
                    image_count,
                    created_at,
                    completed_at,
                )

    print(f"Inserted 50 successful studies for {INSTANCE_CODE}.")


if __name__ == "__main__":
    main()
