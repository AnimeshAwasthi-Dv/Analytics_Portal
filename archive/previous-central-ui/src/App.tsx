import { lazy, Suspense, useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { api, type User } from "./services/api";
import { WorkspaceShell } from "./Components/WorkspaceShell";
import type { CommandView } from "./pages/CommandCenterPage";
import type { OperationsView } from "./pages/OperationsWorkspace";
import {
  legacyPortalModules,
  portalNames,
  portalPath,
} from "./Components/portalNavigation";
const PortalWorkspacePage = lazy(async () => ({
  default: (await import("./pages/PortalWorkspacePage")).PortalWorkspacePage,
}));
const OperationsWorkspace = lazy(async () => ({
  default: (await import("./pages/OperationsWorkspace")).OperationsWorkspace,
}));
const CommandCenterPage = lazy(async () => ({
  default: (await import("./pages/CommandCenterPage")).CommandCenterPage,
}));
const LoginPage = lazy(async () => ({
  default: (await import("./pages/LoginPage")).LoginPage,
}));
const DashboardPage = lazy(async () => ({
  default: (await import("./pages/DashboardPage")).DashboardPage,
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
const DesktopLicensesPage = lazy(async () => ({
  default: (await import("./pages/DesktopLicensesPage")).DesktopLicensesPage,
}));
const LicensePlansPage = lazy(async () => ({
  default: (await import("./pages/LicensePlansPage")).LicensePlansPage,
}));
const LicenseAnalyticsPage = lazy(async () => ({
  default: (await import("./pages/LicenseAnalyticsPage")).LicenseAnalyticsPage,
}));
const LicenseKeyAnalyticsPage = lazy(async () => ({
  default: (await import("./pages/LicenseKeyAnalyticsPage"))
    .LicenseKeyAnalyticsPage,
}));
const MarengoAnalyticsPage = lazy(async () => ({
  default: (await import("./pages/MarengoAnalyticsPage")).MarengoAnalyticsPage,
}));
function OverviewEntry() {
  return <CommandCenterPage view="overview" />;
}
function PortalEntry() {
  const { portalCode = "" } = useParams();
  return <Navigate to={portalPath(portalCode)} replace />;
}
function DashboardAlias() {
  const location = useLocation();
  return (
    <Navigate
      to={location.hash === "#sync-data" ? "/sync" : "/command"}
      replace
    />
  );
}
function Loading() {
  return (
    <div className="workspace-loading">
      <span />
      Loading your workspace...
    </div>
  );
}
function App() {
  const location = useLocation();
  const entityKey = ["portal", "client", "center"]
    .map((key) => new URLSearchParams(location.search).get(key) || "")
    .join(":");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  useEffect(() => {
    api
      .getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  async function logout() {
    try {
      await api.logout();
    } finally {
      setUser(null);
      navigate("/login");
    }
  }
  if (loading)
    return (
      <div className="workspace-boot">
        <img src="/brand-mark.svg" alt="" />
        <strong>DECTROCEL</strong>
        <p>Opening your organization workspace...</p>
        <span />
      </div>
    );
  const can = (permission: string) => !!user?.permissions?.includes(permission);
  const legacyScope = new URLSearchParams(location.search);
  const legacyPortal = legacyScope.get("portal") || "";
  if (
    user &&
    portalNames[legacyPortal] &&
    legacyPortalModules[location.pathname]
  ) {
    legacyScope.delete("portal");
    return (
      <Navigate
        to={`${portalPath(legacyPortal, legacyPortalModules[location.pathname])}${legacyScope.size ? `?${legacyScope}` : ""}`}
        replace
      />
    );
  }
  const page = (view: CommandView, permission?: string) =>
    permission && !can(permission) ? (
      <Navigate to="/command" replace />
    ) : (
      <CommandCenterPage
        key={view === "controls" ? `${view}:${entityKey}` : view}
        view={view}
      />
    );
  return (
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to="/command" replace />
          ) : (
            <Suspense fallback={<Loading />}>
              <LoginPage
                onLoginSuccess={(u) => {
                  setUser(u);
                  navigate("/command");
                }}
              />
            </Suspense>
          )
        }
      />
      <Route
        element={
          user ? (
            <WorkspaceShell user={user} onLogout={() => void logout()} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to="/command" replace />} />
        <Route
          path="command"
          element={
            <Suspense fallback={<Loading />}>
              <OverviewEntry />
            </Suspense>
          }
        />
        {[
          ["reports", "reports"],
          ["assistant", "assistant"],
          ["portals", "portals"],
          ["centers", "centers"],
          ["sources", "sources"],
          ["operations", "controls", "portals:control"],
          ["team", "team", "team:manage"],
          ["audit", "audit", "audit:read"],
        ].map(([path, view, permission]) => (
          <Route
            key={path}
            path={path}
            element={
              <Suspense fallback={<Loading />}>
                {page(view as CommandView, permission)}
              </Suspense>
            }
          />
        ))}
        <Route path="portals/:portalCode" element={<PortalEntry />} />
        <Route
          path="portal/:portalCode/:tab?"
          element={
            <Suspense fallback={<Loading />}>
              <PortalWorkspacePage />
            </Suspense>
          }
        />
        {[
          "clients",
          "services",
          "users",
          "studies",
          "processing",
          "generated-reports",
        ].map((view) => (
          <Route
            key={view}
            path={view}
            element={
              <Suspense fallback={<Loading />}>
                <OperationsWorkspace
                  key={`${view}:${entityKey}`}
                  view={view as OperationsView}
                />
              </Suspense>
            }
          />
        ))}
        <Route
          path="sync"
          element={
            <Suspense fallback={<Loading />}>
              <div className="workspace-legacy">
                <DashboardPage user={user ?? undefined} />
              </div>
            </Suspense>
          }
        />
        <Route path="dashboard" element={<DashboardAlias />} />
        <Route
          path="analytics"
          element={
            <Suspense fallback={<Loading />}>
              <div className="workspace-legacy">
                <AnalyticsPage />
              </div>
            </Suspense>
          }
        />
        <Route
          path="marengo-analytics"
          element={
            <Suspense fallback={<Loading />}>
              <div className="workspace-legacy">
                <MarengoAnalyticsPage />
              </div>
            </Suspense>
          }
        />
        <Route
          path="traffic-analytics"
          element={
            <Suspense fallback={<Loading />}>
              <div className="workspace-legacy">
                <TrafficAnalyticsPage />
              </div>
            </Suspense>
          }
        />
        <Route
          path="control"
          element={
            can("team:manage") ? (
              <Suspense fallback={<Loading />}>
                <ControlPage />
              </Suspense>
            ) : (
              <Navigate to="/command" replace />
            )
          }
        />
        <Route
          path="desktop/licenses"
          element={
            <Suspense fallback={<Loading />}>
              <div className="workspace-legacy">
                <DesktopLicensesPage canWrite={can("licenses:write")} />
              </div>
            </Suspense>
          }
        />
        <Route
          path="desktop/plans"
          element={
            <Suspense fallback={<Loading />}>
              <div className="workspace-legacy">
                <LicensePlansPage canWrite={can("licenses:write")} />
              </div>
            </Suspense>
          }
        />
        <Route
          path="desktop/analytics"
          element={
            <Suspense fallback={<Loading />}>
              <div className="workspace-legacy">
                <LicenseAnalyticsPage />
              </div>
            </Suspense>
          }
        />
        <Route
          path="desktop/key-analytics"
          element={
            <Suspense fallback={<Loading />}>
              <div className="workspace-legacy">
                <LicenseKeyAnalyticsPage />
              </div>
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/command" replace />} />
      </Route>
    </Routes>
  );
}
export default App;
