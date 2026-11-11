import unittest
from unittest.mock import Mock
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.command_models import Center, PortalResource, UsageFact, Portal
from app.desktop_usage import sync_desktop


class DesktopUsageTests(unittest.TestCase):
    def test_initial_history_is_balance_only_and_only_new_decreases_are_dated(self):
        engine = create_engine("sqlite://")
        for model in (Portal, Center, PortalResource, UsageFact):
            model.__table__.create(engine)
        with Session(engine) as db:
            src = Mock()
            row = dict(license_id=1, username="Client", fullname=None, status="ACTIVE", credit_left=70,
                       credit_available_online=70, last_sync=None, updated_at=None, carried_forward_to=None,
                       plan_name="X-ray", allotted=100)
            src.execute.return_value.mappings.side_effect = lambda: iter([row])
            sync_desktop(src, db); db.commit()
            self.assertEqual(db.get(PortalResource,("onprem","desktop_license","desktop:1")).details["used"],30)
            self.assertEqual(db.query(UsageFact).count(),0)
            row["credit_left"] = 65
            sync_desktop(src,db);db.commit()
            self.assertEqual(db.query(UsageFact).one().credits,5)
            sync_desktop(src,db);db.commit()
            self.assertEqual(db.query(UsageFact).count(),1)
            row["credit_left"] = 90
            sync_desktop(src,db);db.commit()
            self.assertEqual(db.query(UsageFact).count(),1)
        engine.dispose()
