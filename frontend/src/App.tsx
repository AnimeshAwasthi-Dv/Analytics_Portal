import React, { lazy, Suspense, useEffect, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  NavLink,
  useNavigate,
  useLocation,
} from "react-router-dom";

import { api } from "./services/api.ts";
import type { User } from "./services/api";
import type { DashboardLoadResult } from "./types";

let dashboardPageModule: Promise<typeof import("./pages/DashboardPage")> | null =
  null;

function loadDashboardPage() {
  dashboardPageModule ??= import("./pages/DashboardPage");
  return dashboardPageModule;
}

if (window.location.pathname === "/dashboard") {
  void loadDashboardPage().catch((error: unknown) => {
    console.error("Dashboard page loading error:", error);
  });
}

const DashboardPage = lazy(async () => ({
  default: (await loadDashboardPage()).DashboardPage,
}));
const LoginPage = lazy(async () => ({
  default: (await import("./pages/LoginPage")).LoginPage,
}));
const AnalyticsPage = lazy(async () => ({
  default: (await import("./pages/AnalyticsPage")).AnalyticsPage,
}));
const TrafficAnalyticsPage = lazy(async () => ({
  default: (await import("./pages/TrafficAnalyticsPage")).TrafficAnalyticsPage,
}));
const ControlPage = lazy(async () => ({
  default: (await import("./pages/ControlPage")).ControlPage,
}));
const DesktopLicensesPage = lazy(async () => ({ default: (await import("./pages/DesktopLicensesPage")).DesktopLicensesPage }));
const LicensePlansPage = lazy(async () => ({ default: (await import("./pages/LicensePlansPage")).LicensePlansPage }));
const LicenseAnalyticsPage = lazy(async () => ({ default: (await import("./pages/LicenseAnalyticsPage")).LicenseAnalyticsPage }));
const LicenseKeyAnalyticsPage = lazy(async () => ({ default: (await import("./pages/LicenseKeyAnalyticsPage")).LicenseKeyAnalyticsPage }));

function PortalSidebar({
  onLogout,
  canManageControl,
}: {
  onLogout: () => void;
  canManageControl: boolean;
}) {
  const location = useLocation();
  const [desktopOpen, setDesktopOpen] = useState(location.pathname.startsWith("/desktop/"));

  return (
    <aside className="portal-sidebar">
      <div className="portal-brand">
        <span className="portal-brand-copy">
          <strong>DecXpert</strong>
          <small>Control Panel</small>
        </span>
      </div>

      <nav className="portal-navigation" aria-label="Main navigation">
        <NavLink
          to="/dashboard"
          end
          className={() =>
            `portal-nav-link${
              location.pathname === "/dashboard" && location.hash !== "#sync-data"
                ? " active"
                : ""
            }`
          }
        >
          <span>Dashboard</span>
        </NavLink>
        <section className="portal-nav-group">
          <button
            type="button"
            className={`portal-nav-link portal-nav-group-toggle${location.pathname.startsWith("/desktop/") ? " active" : ""}`}
            aria-expanded={desktopOpen}
            aria-controls="desktop-exe-subnav"
            onClick={() => setDesktopOpen((open) => !open)}
          >
            <span>Desktop EXE</span>
            <i className={`portal-nav-chevron${desktopOpen ? " expanded" : ""}`} aria-hidden="true" />
          </button>
          {desktopOpen && (
            <div className="portal-subnavigation" id="desktop-exe-subnav">
              <NavLink to="/desktop/licenses" className={({ isActive }) => `portal-nav-link portal-subnav-link${isActive ? " active" : ""}`}>
                <span>Licenses</span>
              </NavLink>
              <NavLink to="/desktop/plans" className={({ isActive }) => `portal-nav-link portal-subnav-link${isActive ? " active" : ""}`}>
                <span>Plans</span>
              </NavLink>
              <NavLink to="/desktop/analytics" className={({ isActive }) => `portal-nav-link portal-subnav-link${isActive ? " active" : ""}`}>
                <span>License Insights</span>
              </NavLink>
              <NavLink to="/desktop/key-analytics" className={({ isActive }) => `portal-nav-link portal-subnav-link${isActive ? " active" : ""}`}>
                <span>Key Analytics</span>
              </NavLink>
            </div>
          )}
        </section>
        <NavLink
          to="/analytics"
          className={({ isActive }) => `portal-nav-link${isActive ? " active" : ""}`}
        >
          <span>Study Analytics</span>
        </NavLink>
        <NavLink
          to="/traffic-analytics"
          className={({ isActive }) => `portal-nav-link${isActive ? " active" : ""}`}
        >
          <span>Traffic</span>
        </NavLink>
        {canManageControl && (
          <NavLink
            to="/control"
            className={({ isActive }) => `portal-nav-link${isActive ? " active" : ""}`}
          >
            <span>Control</span>
          </NavLink>
        )}
        <NavLink
          to="/dashboard#sync-data"
          className={() => `portal-nav-link${location.hash === "#sync-data" ? " active" : ""}`}
        >
          <span>Sync Data</span>
        </NavLink>
      </nav>

      <div className="portal-sidebar-footer">
        <button type="button" className="portal-nav-link portal-logout" onClick={onLogout}>
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}

function PortalShell({
  children,
  onLogout,
  canManageControl,
}: {
  children: React.ReactNode;
  onLogout: () => void;
  canManageControl: boolean;
}) {
  return (
    <div className="portal-layout">
      <PortalSidebar onLogout={onLogout} canManageControl={canManageControl} />
      <main className="portal-main">{children}</main>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardRequest, setDashboardRequest] =
    useState<Promise<DashboardLoadResult> | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const isPublicEntry =
    location.pathname === "/login" || location.pathname === "/";

  useEffect(() => {
    if (window.location.pathname === "/dashboard") {
      const request = api.getDashboard().then(
        (data): DashboardLoadResult => ({ ok: true, data }),
        (error: unknown): DashboardLoadResult => ({ ok: false, error })
      );
      api
        .getCurrentUser()
        .then((currentUser) => {
          setDashboardRequest(request);
          setUser(currentUser);
        })
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
      return;
    }

    api
      .getCurrentUser()
      .then((currentUser) => {
        setUser(currentUser);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setUser(null);
      navigate("/login");
    }
  };

  if (
    loading &&
    !isPublicEntry &&
    location.pathname !== "/dashboard"
  ) {
    return (
      <div className="min-h-screen bg-[#090e1a] flex items-center justify-center px-4">
        <p className="text-sm text-slate-300">
          Connecting to DecXpert Control Panel...
        </p>
      </div>
    );
  }

  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading page...</p>}>
      <Routes>
        {/* LOGIN */}
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <LoginPage
                onLoginSuccess={(loggedUser) => {
                  setDashboardRequest(null);
                  setUser(loggedUser);
                  navigate("/dashboard");
                }}
              />
            )
          }
        />

        {/* DASHBOARD */}
        <Route
          path="/dashboard"
          element={
            user || (loading && location.pathname === "/dashboard") ? (
              <PortalShell
                onLogout={handleLogout}
                canManageControl={user?.canManageControl ?? false}
              >
                <DashboardPage
                  user={user ?? undefined}
                  onLogout={handleLogout}
                  initialDashboardRequest={dashboardRequest ?? undefined}
                />
              </PortalShell>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/desktop/licenses"
          element={user ? <PortalShell onLogout={handleLogout} canManageControl={user.canManageControl}><DesktopLicensesPage /></PortalShell> : <Navigate to="/login" replace />}
        />
        <Route
          path="/desktop/plans"
          element={user ? <PortalShell onLogout={handleLogout} canManageControl={user.canManageControl}><LicensePlansPage /></PortalShell> : <Navigate to="/login" replace />}
        />
        <Route
          path="/desktop/analytics"
          element={user ? <PortalShell onLogout={handleLogout} canManageControl={user.canManageControl}><LicenseAnalyticsPage /></PortalShell> : <Navigate to="/login" replace />}
        />
        <Route
          path="/desktop/key-analytics"
          element={user ? <PortalShell onLogout={handleLogout} canManageControl={user.canManageControl}><LicenseKeyAnalyticsPage /></PortalShell> : <Navigate to="/login" replace />}
        />
        <Route
          path="/analytics"
          element={
            user ? (
              <PortalShell onLogout={handleLogout} canManageControl={user.canManageControl}>
                <AnalyticsPage />
              </PortalShell>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/traffic-analytics"
          element={
            user ? (
              <PortalShell onLogout={handleLogout} canManageControl={user.canManageControl}>
                <TrafficAnalyticsPage />
              </PortalShell>
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/control"
          element={
            user?.canManageControl ? (
              <PortalShell onLogout={handleLogout} canManageControl={user.canManageControl}>
                <ControlPage />
              </PortalShell>
            ) : user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        {/* DEFAULT */}
        <Route
          path="/"
          element={<Navigate to="/login" replace />}
        />

        <Route
          path="*"
          element={
            <Navigate
              to={user ? "/dashboard" : "/login"}
              replace
            />
          }
        />
      </Routes>
    </Suspense>
  );
}

export default App;
