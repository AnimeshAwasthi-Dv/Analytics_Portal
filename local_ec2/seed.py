import os
from datetime import datetime, timezone
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing from .env")


def create_study(cur, modality, image_count, service_type, description):
    cur.execute(
        '''
        INSERT INTO studies (modality, status)
        VALUES (%s, 'PROCESSING')
        RETURNING id
        ''',
        (modality,),
    )
    study_id = cur.fetchone()[0]

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    cur.execute(
        '''
        INSERT INTO processing_jobs
        ("internalJobId", "createdAt", "completedAt", "imageCount", "serviceType")
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
        ''',
        (
            study_id,
            now,
            now,
            image_count,
            service_type,
        ),
    )
    processing_job_id = cur.fetchone()[0]

    cur.execute(
        '''
        INSERT INTO available_bridge_studies
        ("processingJobId", "studyDescription")
        VALUES (%s, %s)
        ''',
        (processing_job_id, description),
    )

    cur.execute(
        '''
        UPDATE studies
        SET status = 'SUCCESS'
        WHERE id = %s
        ''',
        (study_id,),
    )

    return study_id


def main():
    with psycopg2.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            ct_id = create_study(
                cur,
                modality="CT",
                image_count=516,
                service_type="CT",
                description="CT CHEST",
            )

            mri_id = create_study(
                cur,
                modality="MRI",
                image_count=80,
                service_type="MRI",
                description="MRI BRAIN",
            )

            xr_id = create_study(
                cur,
                modality="XR",
                image_count=2,
                service_type="X-RAY",
                description="CHEST X-RAY",
            )

            mammo_id = create_study(
                cur,
                modality="MG",
                image_count=4,
                service_type="MAMMOGRAPHY",
                description="MAMMOGRAPHY",
            )

    print("Seed completed. Successful status transitions notify the sync listener.")
    print(f"CT study:  {ct_id}  | description=CT CHEST       | expected credits=1")
    print(f"MRI study: {mri_id} | description=MRI BRAIN      | expected credits=1")
    print(f"XR study:  {xr_id}  | description=CHEST X-RAY    | expected credits=2")
    print(f"MG study:  {mammo_id} | description=MAMMOGRAPHY   | expected credits=4")


if __name__ == "__main__":
    main()
