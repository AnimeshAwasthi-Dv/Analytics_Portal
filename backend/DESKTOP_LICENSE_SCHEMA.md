# Desktop license schema

The desktop license database uses `ai.license_plans` and `ai.license_detail`, matching the supplied PostgreSQL schema. Alembic revision `h7a2c9e41b60` creates these tables and migrates records from the legacy public tables. The following revision, `c3f7a2d91e54`, removes the legacy public tables after migration. The `ai` tables and their records remain in place.

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
