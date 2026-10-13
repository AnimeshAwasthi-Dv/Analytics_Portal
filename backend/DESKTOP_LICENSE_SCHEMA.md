# Desktop license schema

The Desktop EXE license pages use `ai.license_plans` and `ai.license_detail`. The Alembic revision `h7a2c9e41b60` creates these tables if needed and copies existing records from the former `public.license_plans` and `public.desktop_licenses` tables. It keeps the legacy tables for rollback/reference.

## Service mapping

The schema provides `test_type_id` but no service lookup table. The API maps X-ray to `XRAY_TEST_TYPE_ID` (default `1`) and CT to `CT_TEST_TYPE_ID` (default `2`). Set these in `backend/.env` to the IDs used by your database before creating plans. Existing legacy plans are migrated with the same defaults. `license_app_scope` stores `XRAY` or `CT` on each key.

## Credit calculations

Each license's initial `credit_left` and `credit_available_online` are set to the selected plan's `credits`. The per-key and overall analytics calculate used credits as `max(plan.credits - license_detail.credit_left, 0)` for each key, then sum those values. No separate event history is required for this balance calculation. Validation, activation, fraud, device, assignment, status and date detail comes from the matching columns on `ai.license_detail`.

## Apply the database migration

From the `backend` directory with the project virtual environment active:

```powershell
alembic upgrade head
```

If using the repository virtual environment from PowerShell, run:

```powershell
.\venv\Scripts\python.exe -m alembic upgrade head
```

Then restart the API and open Desktop EXE → Plans. Add plans before generating licenses. Plan deletion is rejected while a license references it, as required by the foreign key.
