
from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from dotenv import load_dotenv

# Load backend/.env independently of the current working directory.
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=ENV_FILE, override=False)

try:
    from .clone_license_db import (
        LICENSE_COLUMNS,
        LICENSE_TABLE,
        PLAN_COLUMNS,
        LICENSE_SOURCE_REQUIRED,
        PLAN_SOURCE_REQUIRED,
        PLAN_TABLE,
        SCHEMA,
        _db_url,
        _find_destination_license,
        _upsert_license_base,
        _upsert_plan,
        _validate_table,
        normalize_license_row,
        reconcile,
        validate_schemas,
    )
except ImportError:
    from clone_license_db import (  # type: ignore
        LICENSE_COLUMNS,
        LICENSE_TABLE,
        PLAN_COLUMNS,
        LICENSE_SOURCE_REQUIRED,
        PLAN_SOURCE_REQUIRED,
        PLAN_TABLE,
        SCHEMA,
        _db_url,
        _find_destination_license,
        _upsert_license_base,
        _upsert_plan,
        _validate_table,
        normalize_license_row,
        reconcile,
        validate_schemas,
    )


CHANNEL = "license_table_changes"
FUNCTION_NAME = "notify_license_table_change"

LOGGER = logging.getLogger("license_live_sync")


def _psycopg_url(url: str) -> str:
    """Convert SQLAlchemy PostgreSQL URLs to Psycopg-compatible URLs."""
    url = url.strip()

    prefixes = (
        "postgresql+psycopg2://",
        "postgresql+psycopg://",
    )

    for prefix in prefixes:
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix):]

    return url


def _connect(url: str, *, autocommit: bool = False):
    """Open a PostgreSQL connection using Psycopg 3."""
    return psycopg.connect(
        _psycopg_url(url),
        row_factory=dict_row,
        autocommit=autocommit,
    )


def install_source_triggers(source) -> None:
    """Install idempotent notification triggers on the source tables."""
    _validate_table(source, PLAN_TABLE, PLAN_SOURCE_REQUIRED)
    _validate_table(source, LICENSE_TABLE, LICENSE_SOURCE_REQUIRED)

    function_ddl = sql.SQL(
        """
        CREATE OR REPLACE FUNCTION {}.{}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            PERFORM pg_notify(
                'license_table_changes',
                jsonb_build_object(
                    'table', TG_TABLE_NAME,
                    'op', TG_OP,
                    'row',
                    CASE
                        WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD)
                        ELSE to_jsonb(NEW)
                    END
                )::text
            );

            IF TG_OP = 'DELETE' THEN
                RETURN OLD;
            END IF;

            RETURN NEW;
        END;
        $$
        """
    ).format(
        sql.Identifier(SCHEMA),
        sql.Identifier(FUNCTION_NAME),
    )

    try:
        with source.transaction():
            source.execute(function_ddl)

            for table in (PLAN_TABLE, LICENSE_TABLE):
                trigger_name = f"trg_{table}_notify_control_panel"

                source.execute(
                    sql.SQL(
                        "DROP TRIGGER IF EXISTS {} ON {}.{}"
                    ).format(
                        sql.Identifier(trigger_name),
                        sql.Identifier(SCHEMA),
                        sql.Identifier(table),
                    )
                )

                source.execute(
                    sql.SQL(
                        "CREATE TRIGGER {} "
                        "AFTER INSERT OR UPDATE OR DELETE "
                        "ON {}.{} "
                        "FOR EACH ROW "
                        "EXECUTE FUNCTION {}.{}()"
                    ).format(
                        sql.Identifier(trigger_name),
                        sql.Identifier(SCHEMA),
                        sql.Identifier(table),
                        sql.Identifier(SCHEMA),
                        sql.Identifier(FUNCTION_NAME),
                    )
                )

        LOGGER.info(
            "Installed source triggers on %s.%s and %s.%s",
            SCHEMA,
            PLAN_TABLE,
            SCHEMA,
            LICENSE_TABLE,
        )

    except Exception as exc:
        raise RuntimeError(
            "Could not install Validation Portal triggers. The source role "
            "needs permission to create or replace the trigger function in "
            f"schema {SCHEMA!r}, and permission to create triggers on "
            f"{SCHEMA}.{PLAN_TABLE} and {SCHEMA}.{LICENSE_TABLE}. "
            "Table ownership or equivalent privileges may be required."
        ) from exc


def _read_source_row(
    source,
    table: str,
    columns: tuple[str, ...],
    id_column: str,
    value,
):
    """Fetch the current source row, not a potentially stale event snapshot."""
    row = source.execute(
        sql.SQL(
            "SELECT * FROM {}.{} WHERE {} = %s"
        ).format(
            sql.Identifier(SCHEMA),
            sql.Identifier(table),
            sql.Identifier(id_column),
        ),
        (value,),
    ).fetchone()

    if row is not None:
        row["_source_columns"] = tuple(
            column for column in columns if column in row
        )

        if table == LICENSE_TABLE:
            normalize_license_row(row)

    return row


def _ensure_plan(source, destination, plan_id) -> None:
    row = _read_source_row(
        source,
        PLAN_TABLE,
        PLAN_COLUMNS,
        "plan_id",
        plan_id,
    )

    if row is None:
        raise RuntimeError(
            f"Source license references missing plan_id={plan_id}"
        )

    with destination.transaction():
        _upsert_plan(destination, row)


def _delete_plan(destination, plan_id) -> None:
    try:
        with destination.transaction():
            destination.execute(
                sql.SQL(
                    "DELETE FROM {}.{} WHERE plan_id = %s"
                ).format(
                    sql.Identifier(SCHEMA),
                    sql.Identifier(PLAN_TABLE),
                ),
                (plan_id,),
            )

        LOGGER.info("Deleted destination plan_id=%s", plan_id)

    except psycopg.errors.ForeignKeyViolation:
        LOGGER.warning(
            "Keeping deleted source plan_id=%s in destination because "
            "licenses still reference it",
            plan_id,
        )


def _delete_license(destination, event_row: dict[str, Any]) -> None:
    destination_id, matched_by = _find_destination_license(
        destination,
        event_row,
    )

    if destination_id is None or matched_by == "pk_conflict":
        LOGGER.warning(
            "No safe destination match for deleted source license_id=%s",
            event_row.get("license_id"),
        )
        return

    with destination.transaction():
        # Clear references before deleting; do not cascade-delete unrelated rows.
        destination.execute(
            sql.SQL(
                "UPDATE {}.{} "
                "SET carried_forward_from = NULL "
                "WHERE carried_forward_from = %s"
            ).format(
                sql.Identifier(SCHEMA),
                sql.Identifier(LICENSE_TABLE),
            ),
            (destination_id,),
        )

        destination.execute(
            sql.SQL(
                "UPDATE {}.{} "
                "SET carried_forward_to = NULL "
                "WHERE carried_forward_to = %s"
            ).format(
                sql.Identifier(SCHEMA),
                sql.Identifier(LICENSE_TABLE),
            ),
            (destination_id,),
        )

        destination.execute(
            sql.SQL(
                "DELETE FROM {}.{} WHERE license_id = %s"
            ).format(
                sql.Identifier(SCHEMA),
                sql.Identifier(LICENSE_TABLE),
            ),
            (destination_id,),
        )

    LOGGER.info(
        "Deleted destination license_id=%s (source id=%s)",
        destination_id,
        event_row.get("license_id"),
    )


def _sync_license_rows(
    source,
    destination,
    changed_row: dict[str, Any],
) -> None:
    """Upsert a changed license, its dependencies, and its references."""
    changed_id = changed_row["license_id"]
    pending: dict[int, dict[str, Any]] = {
        changed_id: dict(changed_row)
    }

    source_columns = set(
        changed_row.get("_source_columns", LICENSE_COLUMNS)
    )

    reference_columns = [
        column
        for column in ("carried_forward_from", "carried_forward_to")
        if column in source_columns
    ]

    dependents = []

    if reference_columns:
        where_clause = sql.SQL(" OR ").join(
            sql.SQL("{} = %s").format(sql.Identifier(column))
            for column in reference_columns
        )

        dependents = source.execute(
            sql.SQL(
                "SELECT * FROM {}.{} WHERE {}"
            ).format(
                sql.Identifier(SCHEMA),
                sql.Identifier(LICENSE_TABLE),
                where_clause,
            ),
            tuple(changed_id for _ in reference_columns),
        ).fetchall()

    for row in dependents:
        row["_source_columns"] = tuple(
            column for column in LICENSE_COLUMNS if column in row
        )
        normalize_license_row(row)

    pending.update({
        row["license_id"]: dict(row)
        for row in dependents
    })

    # Plans must exist before their license rows are inserted or updated.
    plan_ids = {
        row["plan_id"]
        for row in pending.values()
        if row.get("plan_id") is not None
    }

    for plan_id in sorted(plan_ids):
        _ensure_plan(source, destination, plan_id)

    id_map: dict[int, int] = {}

    for row in pending.values():
        with destination.transaction():
            destination_id, outcome = _upsert_license_base(
                destination,
                row,
            )

        if destination_id is not None:
            id_map[row["license_id"]] = destination_id
        elif outcome == "conflict":
            LOGGER.error(
                "Skipping conflicting source license_id=%s",
                row["license_id"],
            )

    # Fetch referenced source rows not already in the pending batch.
    references = {
        ref_id
        for row in pending.values()
        for ref_id in (
            row.get("carried_forward_from"),
            row.get("carried_forward_to"),
        )
        if ref_id is not None and ref_id not in id_map
    }

    reference_rows: dict[int, dict[str, Any]] = {}

    for ref_id in references:
        ref_row = _read_source_row(
            source,
            LICENSE_TABLE,
            LICENSE_COLUMNS,
            "license_id",
            ref_id,
        )

        if ref_row is None:
            LOGGER.warning(
                "Source self-reference points to missing license_id=%s",
                ref_id,
            )
            continue

        reference_rows[ref_id] = dict(ref_row)

    reference_plan_ids = {
        row["plan_id"]
        for row in reference_rows.values()
        if row.get("plan_id") is not None
    }

    for plan_id in sorted(reference_plan_ids):
        _ensure_plan(source, destination, plan_id)

    for ref_id, row in reference_rows.items():
        with destination.transaction():
            destination_id, outcome = _upsert_license_base(
                destination,
                row,
            )

        if destination_id is not None:
            id_map[ref_id] = destination_id
        elif outcome == "conflict":
            LOGGER.error(
                "Could not map referenced source license_id=%s",
                ref_id,
            )

    # Restore self-references only after base rows exist.
    with destination.transaction():
        for row in pending.values():
            destination_id = id_map.get(row["license_id"])

            if destination_id is None:
                continue

            row_columns = set(
                row.get("_source_columns", LICENSE_COLUMNS)
            )

            link_columns = [
                column
                for column in (
                    "carried_forward_from",
                    "carried_forward_to",
                )
                if column in row_columns
            ]

            if not link_columns:
                continue

            from_id = id_map.get(row.get("carried_forward_from"))
            to_id = id_map.get(row.get("carried_forward_to"))

            assignments = sql.SQL(", ").join(
                sql.SQL("{} = %s").format(sql.Identifier(column))
                for column in link_columns
            )

            params = tuple(
                from_id
                if column == "carried_forward_from"
                else to_id
                for column in link_columns
            ) + (destination_id,)

            destination.execute(
                sql.SQL(
                    "UPDATE {}.{} SET {} WHERE license_id = %s"
                ).format(
                    sql.Identifier(SCHEMA),
                    sql.Identifier(LICENSE_TABLE),
                    assignments,
                ),
                params,
            )

    LOGGER.info(
        "Synchronized source license_id=%s and related reference rows",
        changed_id,
    )


def process_notification(
    source,
    destination,
    payload: dict[str, Any],
) -> None:
    """Apply one PostgreSQL notification to the destination database."""
    table = payload.get("table")
    operation = payload.get("op")
    event_row = payload.get("row") or {}

    if (
        table not in (PLAN_TABLE, LICENSE_TABLE)
        or operation not in ("INSERT", "UPDATE", "DELETE")
    ):
        LOGGER.warning(
            "Ignoring unexpected notification payload: %r",
            payload,
        )
        return

    if table == PLAN_TABLE:
        plan_id = event_row.get("plan_id")

        if plan_id is None:
            LOGGER.warning("Plan notification has no plan_id: %r", payload)
            return

        source_row = _read_source_row(
            source,
            PLAN_TABLE,
            PLAN_COLUMNS,
            "plan_id",
            plan_id,
        )

        if source_row is None:
            _delete_plan(destination, plan_id)
        else:
            with destination.transaction():
                _upsert_plan(destination, source_row)

            LOGGER.info(
                "Synchronized plan_id=%s after %s",
                plan_id,
                operation,
            )

        return

    license_id = event_row.get("license_id")

    if license_id is None:
        LOGGER.warning(
            "License notification has no license_id: %r",
            payload,
        )
        return

    source_row = _read_source_row(
        source,
        LICENSE_TABLE,
        LICENSE_COLUMNS,
        "license_id",
        license_id,
    )

    if source_row is None:
        _delete_license(destination, event_row)
    else:
        _sync_license_rows(source, destination, source_row)


def listen_license(stop_event: threading.Event) -> None:
    """Listen for source changes and retry transient failures."""
    # Re-load the explicit project .env in case the process environment changes.
    load_dotenv(dotenv_path=ENV_FILE, override=False)

    source_url = _db_url("SOURCE_LICENSE_DATABASE_URL")
    destination_url = _db_url("DATABASE_URL")

    backoff = 1

    while not stop_event.is_set():
        try:
            LOGGER.info(
                "Connecting to Validation Portal and Control Panel databases"
            )

            with (
                _connect(source_url, autocommit=True) as source,
                _connect(destination_url, autocommit=True) as destination,
            ):
                validate_schemas(source, destination)

                LOGGER.info("Installing source notification triggers")
                install_source_triggers(source)

                with _connect(source_url, autocommit=True) as listener:
                    listener.execute(
                        sql.SQL("LISTEN {}").format(
                            sql.Identifier(CHANNEL)
                        )
                    )

                    LOGGER.info(
                        "Reconciling current plans and licenses before "
                        "processing notifications"
                    )
                    reconcile(source, destination)

                    backoff = 1

                    LOGGER.info(
                        "Live license sync listening on PostgreSQL channel %s",
                        CHANNEL,
                    )

                    while not stop_event.is_set():
                        for notification in listener.notifies(
                            timeout=1,
                            stop_after=1,
                        ):
                            if stop_event.is_set():
                                break

                            try:
                                payload = json.loads(notification.payload)
                                process_notification(
                                    source,
                                    destination,
                                    payload,
                                )

                            except Exception:
                                LOGGER.exception(
                                    "Could not apply notification; retrying"
                                )

                                payload = json.loads(notification.payload)

                                for attempt in range(5):
                                    if stop_event.wait(
                                        min(2 ** attempt, 16)
                                    ):
                                        return

                                    try:
                                        process_notification(
                                            source,
                                            destination,
                                            payload,
                                        )
                                        LOGGER.info(
                                            "Notification retry succeeded"
                                        )
                                        break

                                    except Exception:
                                        LOGGER.exception(
                                            "Notification retry %s/5 failed",
                                            attempt + 1,
                                        )
                                else:
                                    raise RuntimeError(
                                        "Notification retries exhausted; "
                                        "reconnecting to the databases"
                                    )

        except KeyboardInterrupt:
            stop_event.set()
            LOGGER.info("Live license sync stopped")
            return

        except Exception:
            if stop_event.is_set():
                return

            LOGGER.exception(
                "Live sync connection or startup failed; reconnecting "
                "in %s second(s)",
                backoff,
            )

            stop_event.wait(backoff)
            backoff = min(backoff * 2, 60)


def install_configured_source_triggers() -> None:
    """Install triggers using SOURCE_LICENSE_DATABASE_URL."""
    load_dotenv(dotenv_path=ENV_FILE, override=False)

    source_url = _db_url("SOURCE_LICENSE_DATABASE_URL")

    with _connect(source_url) as source:
        install_source_triggers(source)


def main() -> int:
    """Start the standalone license synchronization service."""
    load_dotenv(dotenv_path=ENV_FILE, override=False)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    stop_event = threading.Event()

    try:
        listen_license(stop_event)
        return 0
    except KeyboardInterrupt:
        stop_event.set()
        LOGGER.info("Live license sync stopped")
        return 0
    except Exception:
        LOGGER.exception("Live license sync could not start")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
