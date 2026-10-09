import unittest
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


class MigrationTests(unittest.TestCase):
    def test_migration_history_is_linear_and_has_expected_postgres_head(self):
        backend_root = Path(__file__).resolve().parents[1]
        config = Config(str(backend_root / "alembic.ini"))
        script = ScriptDirectory.from_config(config)

        self.assertEqual(script.get_heads(), ["f19b3c5d7a20"])
        self.assertEqual(
            script.get_revision("f19b3c5d7a20").down_revision,
            "c82b7e4a19d6",
        )
        self.assertEqual(
            script.get_revision("c82b7e4a19d6").down_revision,
            "e6f4b2a7c913",
        )


if __name__ == "__main__":
    unittest.main()
