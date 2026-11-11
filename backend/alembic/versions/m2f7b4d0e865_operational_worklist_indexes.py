"""Central snapshot indexes for operational worklists; no source schema changes."""
from alembic import op

revision = "m2f7b4d0e865"
down_revision = "l1e6a3c9d754"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE INDEX IF NOT EXISTS ix_marengo_studies_worklist ON marengo_studies (created_at, instance_code, id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_marengo_reviews_worklist ON marengo_report_reviews (created_at, instance_code, id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_command_resources_directory ON command_resources (resource_type, name, portal_code, source_id)")


def downgrade():
    op.drop_index("ix_command_resources_directory", table_name="command_resources")
    op.drop_index("ix_marengo_reviews_worklist", table_name="marengo_report_reviews")
    op.drop_index("ix_marengo_studies_worklist", table_name="marengo_studies")
