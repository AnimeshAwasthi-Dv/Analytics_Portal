
"""Run Marengo analytics and Validation Portal license listeners together."""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env", override=False)

from app import source_sync
from app.validation_sync import listen_license

logger = logging.getLogger("central-sync-live")


def run_source_sync(stop_event: threading.Event) -> None:
    """Listen only to the Marengo analytics source."""
    try:
        source_sync.listen_sources(
            source_filter="Marengo",
            dry_run=False,
            stop_event=stop_event,
        )
    except Exception as exc:
        logger.exception("Marengo sync could not start: %s", exc)


def run_license_sync(stop_event: threading.Event) -> None:
    """Listen to Validation Portal license changes using its separate URL."""
    try:
        listen_license(stop_event)
    except Exception as exc:
        logger.exception("Validation license sync could not start: %s", exc)


def main() -> None:
    stop_event = threading.Event()

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            source_future = pool.submit(run_source_sync, stop_event)
            license_future = pool.submit(run_license_sync, stop_event)

            try:
                source_future.result()
                license_future.result()
            except KeyboardInterrupt:
                stop_event.set()
                raise

    except KeyboardInterrupt:
        logger.info("Marengo and Validation synchronization stopped.")
    except Exception as exc:
        stop_event.set()
        logger.exception("Synchronization runner error: %s", exc)


if __name__ == "__main__":
    main()
