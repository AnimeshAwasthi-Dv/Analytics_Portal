"""Clone/backfill the Validation Portal license tables into Control Panel.

Run from ``backend`` with SOURCE_LICENSE_DATABASE_URL and DATABASE_URL set:

    python -m app.clone_license_db --batch-size 1000

The script only inserts/updates the two ``ai`` tables. It never drops tables,
schemas, or rows. Existing destination rows absent from the source are retained.
"""
from __future__ import annotations

import argparse
import logging
import os
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from dotenv import load_dotenv


SCHEMA = "ai"
PLAN_TABLE = "license_plans"
LICENSE_TABLE = "license_detail"
PLAN_COLUMNS = (
    "plan_id", "test_type_id", "plan_name", "credits", "validity_days", "plan_cost",
)
LICENSE_COLUMNS = (
    "license_id", "license_key", "plan_id", "status", "app_version_type",
    "license_app_scope", "credit_left", "credit_available_online", "ct_credits",
    "start_date", "end_date", "system_hash", "mac_address", "last_sync",
    "activation_count", "activation_attempt_count", "successful_validation_count",
    "last_validation_at", "fraud_detected", "fraud_attempt_count", "last_fraud_attempt",
    "last_fraud_reason", "rate_limit_triggered", "fullname", "username", "mobile",
    "address", "vendor_name", "geo_location", "carried_forward_from",
    "carried_forward_to", "carry_forward_date", "blocked_at", "blocked_reason",
    "error_logs", "created_at", "updated_at",
)
LICENSE_UPDATE_COLUMNS = tuple(column for column in LICENSE_COLUMNS if column != "license_id")
NATURAL_KEY = ("license_key", "app_version_type")
PLAN_SOURCE_REQUIRED = ("plan_id", "plan_name", "credits")
LICENSE_SOURCE_REQUIRED = ("license_id", "license_key", "plan_id", "status", "app_version_type")
LOGGER = logging.getLogger("license_clone")
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
STATUS_MAP = {
    "A": "A", "AVAILABLE": "A", "ACTIVE": "A",
    "U": "U", "IN USE": "U", "IN_USE": "U", "USED": "U",
    "CF": "CF", "CARRIED FORWARD": "CF", "CARRIED_FORWARD": "CF",
    "B": "B", "BLOCKED": "B", "INACTIVE": "B", "DISABLED": "B", "EXPIRED": "B",
}
VALID_APP_VERSION_TYPES = {"DCP", "DXP", "CXR"}


def _db_url(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    if any(placeholder in value.casefold() for placeholder in ("your_username", "your_password")):
        raise RuntimeError(
            f"{name} still contains placeholder credentials. Replace YOUR_USERNAME and "
            "YOUR_PASSWORD with the real PostgreSQL credentials in backend/.env."
        )
    return value.replace("postgresql+psycopg://", "postgresql://", 1).replace(
        "postgresql+psycopg2://", "postgresql://", 1
    )


def _connect(url: str, *, autocommit: bool = False):
    return psycopg.connect(url, row_factory=dict_row, autocommit=autocommit)


def _table_columns(connection, table: str) -> set[str]:
    row = connection.execute(
        "SELECT 1 FROM information_schema.schemata WHERE schema_name = %s", (SCHEMA,)
    ).fetchone()
    if not row:
        raise RuntimeError(f"Required schema {SCHEMA!r} is missing")
    row = connection.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = %s AND table_name = %s AND table_type = 'BASE TABLE'",
        (SCHEMA, table),
    ).fetchone()
    if not row:
        raise RuntimeError(f"Required table {SCHEMA}.{table} is missing")
    return {
        row["column_name"]
        for row in connection.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = %s AND table_name = %s",
            (SCHEMA, table),
        ).fetchall()
    }
def _validate_table(connection, table: str, required_columns: Iterable[str]) -> set[str]:
    actual = _table_columns(connection, table)
    missing = sorted(set(required_columns) - actual)
    if missing:
        raise RuntimeError(f"{SCHEMA}.{table} is missing columns: {', '.join(missing)}")
    return actual


def validate_schemas(source, destination) -> None:
    try:
        source_plans = _validate_table(source, PLAN_TABLE, PLAN_SOURCE_REQUIRED)
        source_licenses = _validate_table(source, LICENSE_TABLE, LICENSE_SOURCE_REQUIRED)
    except Exception as exc:
        raise RuntimeError(f"Invalid source license schema: {exc}") from exc
    try:
        _validate_table(destination, PLAN_TABLE, PLAN_COLUMNS)
        _validate_table(destination, LICENSE_TABLE, LICENSE_COLUMNS)
    except Exception as exc:
        raise RuntimeError(f"Invalid destination license schema: {exc}") from exc
    for table, actual, expected in (
        (PLAN_TABLE, source_plans, PLAN_COLUMNS),
        (LICENSE_TABLE, source_licenses, LICENSE_COLUMNS),
    ):
        omitted = sorted(set(expected) - actual)
        if omitted:
            LOGGER.warning(
                "Source %s.%s lacks optional columns %s; missing fields will use destination defaults "
                "on insert and remain unchanged on update",
                SCHEMA, table, ", ".join(omitted),
            )


def _source_batches(connection, table: str, columns: tuple[str, ...], id_column: str,
                    batch_size: int):
    last_id = None
    actual = _table_columns(connection, table)
    selected_columns = tuple(column for column in columns if column in actual)
    if id_column not in selected_columns:
        raise RuntimeError(f"Source {SCHEMA}.{table} is missing key column {id_column}")
    projection = sql.SQL(", ").join(map(sql.Identifier, selected_columns))
    while True:
        if last_id is None:
            query = sql.SQL("SELECT {} FROM {}.{} ORDER BY {} LIMIT %s").format(
                projection, sql.Identifier(SCHEMA), sql.Identifier(table), sql.Identifier(id_column)
            )
            rows = connection.execute(query, (batch_size,)).fetchall()
        else:
            query = sql.SQL("SELECT {} FROM {}.{} WHERE {} > %s ORDER BY {} LIMIT %s").format(
                projection, sql.Identifier(SCHEMA), sql.Identifier(table),
                sql.Identifier(id_column), sql.Identifier(id_column),
            )
            rows = connection.execute(query, (last_id, batch_size)).fetchall()
        if not rows:
            return
        for row in rows:
            row["_source_columns"] = selected_columns
            if table == LICENSE_TABLE:
                normalize_license_row(row)
        yield rows
        last_id = rows[-1][id_column]


def normalize_license_row(row: dict[str, Any]) -> dict[str, Any]:
    """Map common Validation Portal labels to the destination's constrained codes."""
    status = str(row.get("status") or "").strip().upper()
    mapped_status = STATUS_MAP.get(status)
    if mapped_status is None:
        LOGGER.warning("Unknown license status %r for license_id=%s; mapping to blocked status B",
                       status, row.get("license_id"))
        mapped_status = "B"
    if status != mapped_status:
        LOGGER.info("Mapping license status %r -> %s for license_id=%s",
                    status, mapped_status, row.get("license_id"))
    row["status"] = mapped_status

    app_version_type = str(row.get("app_version_type") or "").strip().upper()
    if app_version_type not in VALID_APP_VERSION_TYPES:
        LOGGER.info("Mapping app_version_type %r -> CXR for license_id=%s",
                    app_version_type, row.get("license_id"))
        app_version_type = "CXR"
    row["app_version_type"] = app_version_type
    return row


def _upsert_plan(destination, row: dict[str, Any]) -> str:
    existing = destination.execute(
        sql.SQL("SELECT plan_id FROM {}.{} WHERE plan_id = %s").format(
            sql.Identifier(SCHEMA), sql.Identifier(PLAN_TABLE)
        ), (row["plan_id"],),
    ).fetchone()
    source_columns = tuple(row.get("_source_columns", PLAN_COLUMNS))
    insert_columns = tuple(column for column in PLAN_COLUMNS if column in source_columns)
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c))
        for c in insert_columns if c != "plan_id"
    )
    statement = sql.SQL("INSERT INTO {}.{} ({}) VALUES ({}) ON CONFLICT (plan_id) DO UPDATE SET {}")
    if len(insert_columns) == 1:
        # A PK-only row still safely preserves the existing plan without an empty SET clause.
        statement = sql.SQL("INSERT INTO {}.{} ({}) VALUES ({}) ON CONFLICT (plan_id) DO NOTHING")
        query = statement.format(
            sql.Identifier(SCHEMA), sql.Identifier(PLAN_TABLE),
            sql.SQL(", ").join(map(sql.Identifier, insert_columns)),
            sql.SQL(", ").join(sql.Placeholder() for _ in insert_columns),
        )
    else:
        query = statement.format(
            sql.Identifier(SCHEMA), sql.Identifier(PLAN_TABLE),
            sql.SQL(", ").join(map(sql.Identifier, insert_columns)),
            sql.SQL(", ").join(sql.Placeholder() for _ in insert_columns), assignments,
        )
    destination.execute(query, tuple(row[column] for column in insert_columns))
    return "updated" if existing else "inserted"


def _find_destination_license(destination, row: dict[str, Any]):
    natural = destination.execute(
        sql.SQL("SELECT license_id FROM {}.{} WHERE license_key = %s AND app_version_type = %s").format(
            sql.Identifier(SCHEMA), sql.Identifier(LICENSE_TABLE)
        ), (row["license_key"], row["app_version_type"]),
    ).fetchone()
    if natural:
        return natural["license_id"], "natural"
    by_id = destination.execute(
        sql.SQL("SELECT license_id, license_key, app_version_type FROM {}.{} WHERE license_id = %s").format(
            sql.Identifier(SCHEMA), sql.Identifier(LICENSE_TABLE)
        ), (row["license_id"],),
    ).fetchone()
    if by_id:
        if (by_id["license_key"], by_id["app_version_type"]) != (
            row["license_key"], row["app_version_type"]
        ):
            return by_id["license_id"], "pk_conflict"
        return by_id["license_id"], "pk"
    return None, "missing"


def _upsert_license_base(destination, row: dict[str, Any]) -> tuple[int | None, str]:
    destination_id, matched_by = _find_destination_license(destination, row)
    if matched_by == "pk_conflict":
        LOGGER.error(
            "PK conflict: source license_id=%s natural_key=%r matches a different destination row; preserving destination row",
            row["license_id"], (row["license_key"], row["app_version_type"]),
        )
        return None, "conflict"

    source_columns = tuple(row.get("_source_columns", LICENSE_COLUMNS))
    # Self references are linked in a second pass after all rows exist.
    insert_columns = tuple(
        column for column in LICENSE_COLUMNS
        if column in source_columns and column not in ("carried_forward_from", "carried_forward_to")
    )
    if destination_id is None:
        destination.execute(
            sql.SQL("INSERT INTO {}.{} ({}) VALUES ({})").format(
                sql.Identifier(SCHEMA), sql.Identifier(LICENSE_TABLE),
                sql.SQL(", ").join(map(sql.Identifier, insert_columns)),
                sql.SQL(", ").join(sql.Placeholder() for _ in insert_columns),
            ), tuple(row[column] for column in insert_columns),
        )
        return row["license_id"], "inserted"

    if destination_id != row["license_id"]:
        LOGGER.warning(
            "Natural-key match: source license_id=%s maps to destination license_id=%s for %r",
            row["license_id"], destination_id, (row["license_key"], row["app_version_type"]),
        )
    else:
        LOGGER.debug("License ID map: source license_id=%s -> destination license_id=%s",
                     row["license_id"], destination_id)
    update_columns = tuple(
        column for column in LICENSE_UPDATE_COLUMNS
        if column in source_columns and column not in ("carried_forward_from", "carried_forward_to")
    )
    if update_columns:
        updates = sql.SQL(", ").join(
            sql.SQL("{} = %s").format(sql.Identifier(column)) for column in update_columns
        )
        destination.execute(
            sql.SQL("UPDATE {}.{} SET {} WHERE license_id = %s").format(
                sql.Identifier(SCHEMA), sql.Identifier(LICENSE_TABLE), updates
            ), tuple(row[column] for column in update_columns) + (destination_id,),
        )
    return destination_id, "updated"


def _link_license_references(destination, source_rows: list[dict[str, Any]], id_map: dict[int, int]) -> int:
    linked = 0
    for row in source_rows:
        destination_id = id_map.get(row["license_id"])
        if destination_id is None:
            continue
        source_columns = set(row.get("_source_columns", LICENSE_COLUMNS))
        link_columns = [column for column in ("carried_forward_from", "carried_forward_to")
                        if column in source_columns]
        if not link_columns:
            continue
        from_id = id_map.get(row.get("carried_forward_from"))
        to_id = id_map.get(row.get("carried_forward_to"))
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = %s").format(sql.Identifier(column)) for column in link_columns
        )
        params = tuple(
            from_id if column == "carried_forward_from" else to_id for column in link_columns
        ) + (destination_id,)
        destination.execute(
            sql.SQL("UPDATE {}.{} SET {} WHERE license_id = %s").format(
                sql.Identifier(SCHEMA), sql.Identifier(LICENSE_TABLE), assignments
            ), params,
        )
        linked += 1
    return linked


def reconcile(source, destination, batch_size: int = 1000) -> dict[str, Any]:
    """Copy plans, then license base rows, then their self-references."""
    validate_schemas(source, destination)
    counts = {"plans": Counter(), "licenses": Counter(), "references_linked": 0}

    for rows in _source_batches(source, PLAN_TABLE, PLAN_COLUMNS, "plan_id", batch_size):
        with destination.transaction():
            for row in rows:
                counts["plans"][_upsert_plan(destination, row)] += 1
        LOGGER.info("Synced plan batch through plan_id=%s", rows[-1]["plan_id"])

    id_map: dict[int, int] = {}
    for rows in _source_batches(source, LICENSE_TABLE, LICENSE_COLUMNS, "license_id", batch_size):
        with destination.transaction():
            for row in rows:
                destination_id, outcome = _upsert_license_base(destination, row)
                counts["licenses"][outcome] += 1
                if outcome == "conflict":
                    counts["licenses"]["skipped"] += 1
                if destination_id is not None:
                    id_map[row["license_id"]] = destination_id
        LOGGER.info("Synced license batch through license_id=%s", rows[-1]["license_id"])

    # Link after all rows are present, which supports forward and cyclic references safely.
    for rows in _source_batches(source, LICENSE_TABLE, LICENSE_COLUMNS, "license_id", batch_size):
        with destination.transaction():
            counts["references_linked"] += _link_license_references(
                destination, rows, id_map
            )

    return {
        "plans": {key: counts["plans"][key] for key in ("inserted", "updated", "skipped", "conflict")},
        "licenses": {key: counts["licenses"][key] for key in ("inserted", "updated", "skipped", "conflict")},
        "references_linked": counts["references_linked"],
        "id_mapping": id_map,
    }


def main(argv: list[str] | None = None) -> int:
    load_dotenv(dotenv_path=ENV_FILE, override=False)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args(argv)
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        source_url = _db_url("SOURCE_LICENSE_DATABASE_URL")
        destination_url = _db_url("DATABASE_URL")
        with _connect(source_url, autocommit=True) as source, _connect(destination_url, autocommit=True) as destination:
            source_database = source.execute("SELECT current_database()").fetchone()["current_database"]
            destination_database = destination.execute("SELECT current_database()").fetchone()["current_database"]
            LOGGER.info("Cloning from database %r into destination database %r", source_database, destination_database)
            result = reconcile(source, destination, args.batch_size)
            plan_count = destination.execute(
                sql.SQL("SELECT count(*) AS total FROM {}.{}").format(
                    sql.Identifier(SCHEMA), sql.Identifier(PLAN_TABLE),
                )
            ).fetchone()["total"]
            license_count = destination.execute(
                sql.SQL("SELECT count(*) AS total FROM {}.{}").format(
                    sql.Identifier(SCHEMA), sql.Identifier(LICENSE_TABLE),
                )
            ).fetchone()["total"]
        LOGGER.info("Clone complete: %s", {key: value for key, value in result.items() if key != "id_mapping"})
        LOGGER.info(
            "Destination now contains %s plans and %s licenses in ai.license_plans and ai.license_detail",
            plan_count,
            license_count,
        )
        return 0
    except Exception:
        LOGGER.exception("License clone failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
