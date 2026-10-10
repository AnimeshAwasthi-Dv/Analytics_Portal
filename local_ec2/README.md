# Local EC2 sync simulator

This folder provides a small PostgreSQL database and seed data for exercising
the Marengo sync listener. The schema includes the study description field used
by the current sync payload.

## Prepare the database

Set `DATABASE_URL` in `.env` to the simulator database, then apply or reapply the
schema. The schema uses additive `IF NOT EXISTS` changes so an older simulator
database is upgraded without dropping its data.

From PowerShell:

```powershell
$env:DATABASE_URL = (Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f .\schema.sql
```

## Run a sync test

1. Start the sync service configured for this simulator database and the local
   portal. On startup, the service installs its PostgreSQL notification trigger
   and starts listening for successful studies.
2. In another terminal, run `python .\seed.py` from this folder using an
   environment that has `psycopg2` and `python-dotenv` installed.
3. Confirm the portal receives four studies with descriptions and expected
   credits: CT (1), MRI (1), XR (2), and MG (4).

The seed transitions each study from `PROCESSING` to `SUCCESS` only after its
processing job and study description have been written, so notifications test
the current status-transition flow and only become visible after the transaction
commits. Each run creates four new test studies; it does not delete old data.
