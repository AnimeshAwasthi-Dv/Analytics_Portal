# Direct source database sync

The portal reads successful work directly from the three configured PostgreSQL databases:

| Source | Profile | Source table |
| --- | --- | --- |
| Marengo | `marengo` | `public.studies`, `public.jobs`, `public.report_reviews`, and `public.usage_logs` |
| PACS | `pacs` | `public.processing_jobs` and bridge-study metadata |
| API Control | `api_control` | `public.jobs` |

The worker writes to the portal database's `sync_records` table. It uses `(instance_code, source_record_id)` to make repeated imports idempotent.

Marengo analytics are also synchronized into the dedicated `marengo_studies`, `marengo_jobs`, `marengo_report_reviews`, and `marengo_usage_logs` tables. Before reading source rows, the worker validates the expected column types, nullability, defaults, and enum labels against the live Marengo database. Study IDs link jobs through nullable `jobs.studyId`; rows with a missing or unmatched study remain available in job totals. The report review status is shown as the main workflow status on Marengo Analytics. Patient names from `report_reviews.patientName` are copied to `marengo_report_reviews.patient_name` and shown in the Dashboard's Record column for Marengo studies. Patient IDs, report JSON, accessions, and usage messages are not copied. Job error text is reduced to a boolean error indicator.

## Configure connections

Set `DATABASE_URL` to the portal database. Paste the Marengo source connection string on the `MARENGO_DATABASE_URL` line in `backend/.env`. Keep the Validation Portal license database on its separate `SOURCE_LICENSE_DATABASE_URL` line:

```dotenv
MARENGO_DATABASE_URL=postgresql+psycopg://readonly:URL_ENCODED_PASSWORD@MARENGO_DB_HOST:5432/SOURCE_DB?sslmode=require
PACS_DATABASE_URL=
API_CONTROL_DATABASE_URL=
SOURCE_LICENSE_DATABASE_URL=
SOURCE_SYNC_BATCH_SIZE=500
```

The Marengo connection must point to the Marengo source database, not the Validation Portal license database. The source sync reads only `public.studies`, `public.jobs`, `public.report_reviews`, and `public.usage_logs` for this profile.

Alternatively, set `PORTAL_SOURCE_DATABASES` to a JSON array when you need custom names or instance codes. URL-encode reserved characters in passwords. The worker host must be allowed to connect to each source DB through its security group/firewall. The listener needs only connect/read privileges; a database administrator can install triggers once if the runtime account is read-only.

## Install source notifications

The worker uses PostgreSQL `LISTEN`/`NOTIFY`; it does not poll every 60 seconds. Install source triggers with the command below. Processing-job notifications carry the source job ID; for PACS, that ID is text. The PACS trigger installer also notifies the same listener when a linked `available_bridge_studies` row is inserted or its count, study UID, modalities, or description changes. This lets an X-ray job rejected for a missing count be retried when bridge metadata arrives.

For PACS X-ray credit calculation, the listener joins `available_bridge_studies."processingJobId"` to `processing_jobs.id` and reads `available_bridge_studies."instanceCount"`. This is the source schema's unique foreign-key relationship. A missing, invalid, or non-positive count rejects the X-ray record without persisting a guessed credit value; non-X-ray records use one credit.

From the `backend` directory, install triggers for every configured source:

```bash
python -m app.source_sync --install-triggers
```

Or install one at a time:

```bash
python -m app.source_sync --source Marengo --install-triggers
python -m app.source_sync --source PACS --install-triggers
python -m app.source_sync --source "API Control" --install-triggers
```

The account running trigger installation needs permission to create a trigger and function in the source DB's `public` schema. The trigger writes no study data; it sends the row ID as a PostgreSQL notification. The worker then reads that row using the source-specific SQL query. The installer checks that the profile's source table has both `id` and `status`; if a URL points to a different portal's schema, it reports the mismatch and continues checking the remaining configured sources.

## Run and verify

Apply portal migrations first:

```bash
alembic upgrade head
```

Check candidate records without importing:

```bash
python -m app.source_sync --dry-run
python -m app.source_sync --source Marengo --dry-run
```

For a one-time full backfill of Marengo analytics, run from `backend`. On Windows Git Bash, use forward slashes and the repository virtual-environment interpreter:

```bash
cd /d/CDS/backend
../.venv/Scripts/python.exe -m alembic -c alembic.ini upgrade head
../.venv/Scripts/python.exe -m app.clone_marengo_db --dry-run --batch-size 1000
../.venv/Scripts/python.exe -m app.clone_marengo_db --batch-size 1000
```

The clone reads only `MARENGO_DATABASE_URL` and writes to `DATABASE_URL`. It is safe to rerun and upserts by source ID plus instance code. It uses the same field mapping as ongoing sync, including report review status and patient names for the Dashboard. It does not copy patient identifiers, accessions, report JSON, usage messages, or raw job error text.

Start both Marengo analytics and Validation Portal license listeners from the single live-sync entry point:

```bash
python -m app.license_live_sync
```

`license_live_sync.py` selects the configured Marengo source and starts the Validation listener separately. It does not start PACS or API Control. Use the distinct URLs for Marengo and Validation; do not put the Validation connection URL in `MARENGO_DATABASE_URL`. On startup and after reconnecting, each listener performs its own catch-up scan.

`LISTEN`/`NOTIFY` is a signal, not a durable queue. Startup/reconnect reconciliation recovers missed events, and the source ID constraint prevents duplicate imports. Keep one listener worker running. The legacy `--watch` command remains an alias for `--listen`.

Verify imports in the portal database:

```sql
SELECT instance_code, COUNT(*) AS imported_studies,
       SUM(credits_used) AS imported_credits,
       MAX(synced_at) AS last_import
FROM sync_records
WHERE source_record_id IS NOT NULL
GROUP BY instance_code
ORDER BY instance_code;

SELECT 'studies' AS source_table, instance_code, COUNT(*) FROM marengo_studies GROUP BY instance_code
UNION ALL SELECT 'jobs', instance_code, COUNT(*) FROM marengo_jobs GROUP BY instance_code
UNION ALL SELECT 'report_reviews', instance_code, COUNT(*) FROM marengo_report_reviews GROUP BY instance_code
UNION ALL SELECT 'usage_logs', instance_code, COUNT(*) FROM marengo_usage_logs GROUP BY instance_code;
```
