
import os
from locust import HttpUser, task, between


# Configure these through PowerShell environment variables.
EMAIL = os.getenv("LOCUST_EMAIL", "")
PASSWORD = os.getenv("LOCUST_PASSWORD", "")
API_KEY = os.getenv("LOCUST_API_KEY", "")


class BackendUser(HttpUser):
    wait_time = between(1, 2)

    def on_start(self):
        """Log in before testing protected endpoints."""
        self.authenticated = False

        if not EMAIL or not PASSWORD:
            print(
                "WARNING: Set LOCUST_EMAIL and LOCUST_PASSWORD "
                "to test authenticated endpoints."
            )
            return

        self.login()

    def request_api(self, method, path, **kwargs):
        """Record HTTP errors as Locust failures."""
        with self.client.request(
            method,
            path,
            catch_response=True,
            **kwargs,
        ) as response:
            if response.status_code >= 400:
                response.failure(
                    f"{method} {path}: HTTP {response.status_code}"
                )
            else:
                response.success()

            return response

    def login(self):
        response = self.request_api(
            "POST",
            "/auth/login",
            json={
                "email": EMAIL,
                "password": PASSWORD,
            },
            name="POST /auth/login",
        )

        self.authenticated = response.status_code == 200

    # --------------------------------------------------
    # AUTHENTICATION
    # --------------------------------------------------

    @task(1)
    def test_login(self):
        if EMAIL and PASSWORD:
            self.login()

    @task(1)
    def test_current_user(self):
        if self.authenticated:
            self.request_api("GET", "/auth/me")

    @task(1)
    def test_logout(self):
        if self.authenticated:
            self.request_api("POST", "/auth/logout")
            self.authenticated = False

            # Restore the session for subsequent protected requests.
            self.login()

    # --------------------------------------------------
    # DASHBOARD
    # --------------------------------------------------

    @task(3)
    def test_dashboard(self):
        if self.authenticated:
            self.request_api("GET", "/api/v1/dashboard")

    # --------------------------------------------------
    # ANALYTICS
    # --------------------------------------------------

    @task(1)
    def test_analytics(self):
        if self.authenticated:
            self.request_api("GET", "/api/v1/analytics")

    @task(1)
    def test_analytics_instances(self):
        if self.authenticated:
            self.request_api("GET", "/api/v1/analytics/instances")

    # --------------------------------------------------
    # TRAFFIC ANALYTICS
    # --------------------------------------------------

    @task(1)
    def test_traffic_summary(self):
        if self.authenticated:
            self.request_api(
                "GET",
                "/api/v1/analytics/traffic/summary",
                params={"period": "30d"},
            )

    @task(1)
    def test_traffic_overview(self):
        if self.authenticated:
            self.request_api(
                "GET",
                "/api/v1/analytics/traffic/overview",
                params={"period": "30d"},
            )

    @task(1)
    def test_traffic_daily(self):
        if self.authenticated:
            self.request_api(
                "GET",
                "/api/v1/analytics/traffic/daily",
                params={"period": "30d"},
            )

    @task(1)
    def test_traffic_instances(self):
        if self.authenticated:
            self.request_api(
                "GET",
                "/api/v1/analytics/traffic/instances",
                params={"period": "30d"},
            )

    @task(1)
    def test_traffic_routes(self):
        if self.authenticated:
            self.request_api(
                "GET",
                "/api/v1/analytics/traffic/routes",
                params={"period": "30d"},
            )

    @task(1)
    def test_traffic_details(self):
        if self.authenticated:
            self.request_api(
                "GET",
                "/api/v1/analytics/traffic/details",
                params={"period": "30d"},
            )

    # --------------------------------------------------
    # CENTRAL SYNC API
    # --------------------------------------------------

    @task(1)
    def test_sync(self):
        if not API_KEY:
            return

        self.request_api(
            "POST",
            "/api/v1/sync",
            headers={"Authorization": f"Bearer {API_KEY}"},
            json={
                "modality": "CT",
                "study_description": "Locust performance test",
                "processing_created_at": "2026-10-11T10:00:00Z",
                "processing_completed_at": "2026-10-11T10:01:00Z",
                "credits_used": 1,
            },
        )

    @task(1)
    def test_heartbeat(self):
        if not API_KEY:
            return

        self.request_api(
            "POST",
            "/api/v1/heartbeat",
            headers={"Authorization": f"Bearer {API_KEY}"},
        )
