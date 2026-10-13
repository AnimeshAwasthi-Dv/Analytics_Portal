# Direct source database sync

The portal reads successful work directly from the three configured PostgreSQL databases:

| Source | Profile | Source table |
| --- | --- | --- |
| Marengo | `marengo` | `public.studies`, latest processing job, and bridge description |
| PACS | `pacs` | `public.processing_jobs` and bridge-study metadata |
| API Control | `api_control` | `public.jobs` |

The worker writes to the portal database's `sync_records` table. It uses `(instance_code, source_record_id)` to make repeated imports idempotent.

## Configure connections

Set `DATABASE_URL` to the portal database. Paste each source connection string into `backend/.env`; leave unused sources blank:

```dotenv
MARENGO_DATABASE_URL=postgresql+psycopg://readonly:URL_ENCODED_PASSWORD@MARENGO_DB_HOST:5432/SOURCE_DB?sslmode=require
PACS_DATABASE_URL=
API_CONTROL_DATABASE_URL=
SOURCE_SYNC_BATCH_SIZE=500
```

Alternatively, set `PORTAL_SOURCE_DATABASES` to a JSON array when you need custom names or instance codes. URL-encode reserved characters in passwords. The worker host must be allowed to connect to each source DB through its security group/firewall. The listener needs only connect/read privileges; a database administrator can install triggers once if the runtime account is read-only.

## Install source notifications

The worker uses PostgreSQL `LISTEN`/`NOTIFY`; it does not poll every 60 seconds. Install a trigger in each source database. It notifies the worker when a source row is inserted as `SUCCESS` or transitions to `SUCCESS`.

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

Start the persistent listener after the triggers have been installed:

```bash
python -m app.source_sync --listen
```

The worker listens to all configured sources concurrently. On startup and after reconnecting, it performs one catch-up scan to import successful rows created while it was offline. If the listener disconnects, it retries; other source listeners continue.

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
```
