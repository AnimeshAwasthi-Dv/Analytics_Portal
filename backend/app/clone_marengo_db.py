"""Backfill all Marengo analytics rows into the Central Sync database.

Run from ``backend`` after configuring ``MARENGO_DATABASE_URL`` and
``DATABASE_URL`` in ``backend/.env``::

    python -m app.clone_marengo_db --batch-size 1000

The clone reuses the live analytics sync mapping and is safe to rerun. It
copies review status and patient display names along with analytics fields;
patient identifiers and report JSON remain in the Marengo source database.
"""
from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

from app.database import DATABASE_URL
from app.source_sync import Source
from app.marengo_analytics_sync import import_marengo_source


LOGGER = logging.getLogger("marengo_clone")
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def main(argv: list[str] | None = None) -> int:
    load_dotenv(dotenv_path=ENV_FILE, encoding="utf-8-sig", override=False)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--dry-run", action="store_true", help="scan and validate without writing central rows")
    parser.add_argument("--instance-code", default="marengo-01")
    args = parser.parse_args(argv)
    if args.batch_size < 1:
        parser.error("--batch-size must be at least 1")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        # Build the source from the Marengo-only environment setting. This
        # deliberately avoids load_sources()' broader PACS/API configuration.
        source_url = os.getenv("MARENGO_DATABASE_URL")
        if not source_url:
            raise RuntimeError("MARENGO_DATABASE_URL is required; set it in backend/.env")
        source = Source("Marengo", "marengo", args.instance_code, source_url)

        source_engine = create_engine(source_url, pool_pre_ping=True)
        central_engine = create_engine(DATABASE_URL, pool_pre_ping=True)
        try:
            with source_engine.connect() as connection:
                source_database = connection.execute(text("SELECT current_database()")).scalar_one()
                source_counts = {
                    table: connection.execute(text(f'SELECT count(*) FROM public."{table}"')).scalar_one()
                    for table in ("studies", "jobs", "report_reviews", "usage_logs", "processing_jobs")
                }
            with central_engine.connect() as connection:
                central_database = connection.execute(text("SELECT current_database()")).scalar_one()
            LOGGER.info("Backfilling Marengo database %r into Central Sync database %r", source_database, central_database)
            LOGGER.info("Live Marengo source row counts: %s", source_counts)
            if not any(source_counts.values()):
                raise RuntimeError(
                    "All four Marengo source tables are empty on this connection. "
                    "Check that MARENGO_DATABASE_URL points to the database containing the source data."
                )
        finally:
            source_engine.dispose()
            central_engine.dispose()

        result = import_marengo_source(source, args.batch_size, dry_run=args.dry_run)
        LOGGER.info("Marengo %s complete: %s", "dry run" if args.dry_run else "clone", result)
        return 0
    except Exception:
        LOGGER.exception("Marengo clone failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
