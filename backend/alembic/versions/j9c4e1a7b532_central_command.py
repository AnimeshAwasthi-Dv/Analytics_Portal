"""Central client registry, service analytics, team roles and audited commands."""
from alembic import op
from app.command_models import TeamRole, Portal, Center, ServiceEvent, ControlCommand, AuditEntry, UsageFact, UserActivity

revision = "j9c4e1a7b532"
down_revision = "i8b3d0f6c421"
branch_labels = None
depends_on = None


def upgrade():
    for model in (TeamRole, Portal, Center, ServiceEvent, ControlCommand, AuditEntry, UsageFact, UserActivity):
        model.__table__.create(op.get_bind(), checkfirst=True)
    portals = Portal.__table__
    op.bulk_insert(portals, [
        dict(code="marengo", name="Marengo", client_code="marengo", kind="dedicated", profile="prisma"),
        dict(code="goyal", name="Goyal MRI", client_code="goyal", kind="dedicated", profile="prisma"),
        dict(code="pacs", name="Common PACS", client_code="shared-pacs", kind="shared", profile="prisma"),
        dict(code="onprem", name="On-prem applications", client_code="onprem", kind="onprem", profile="license"),
    ])


def downgrade():
    for model in (UserActivity, UsageFact, AuditEntry, ControlCommand, ServiceEvent, Center, Portal, TeamRole):
        model.__table__.drop(op.get_bind())
