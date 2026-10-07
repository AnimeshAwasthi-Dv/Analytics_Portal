import React, { lazy, Suspense, useEffect, useState } from "react";
import {
  BarChart3,
  FileText,
  Home,
  Layers,
  LogOut,
} from "lucide-react";
import {
  Routes,
  Route,
  Navigate,
  NavLink,
  useNavigate,
  useLocation,
} from "react-router-dom";

import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { api } from "./services/api.ts";
import type { User } from "./services/api";

const AnalyticsPage = lazy(async () => ({
  default: (await import("./pages/AnalyticsPage")).AnalyticsPage,
}));

function PortalSidebar({ onLogout }: { onLogout: () => void }) {
  const location = useLocation();

  return (
    <aside className="portal-sidebar">
      <div className="portal-brand">
        <span className="portal-brand-icon"><Layers /></span>
        <span className="portal-brand-copy">
          <strong>Central Sync</strong>
          <small>Portal Synchronization</small>
        </span>
      </div>

      <nav className="portal-navigation" aria-label="Main navigation">
        <NavLink
          to="/dashboard"
          end
          className={({ isActive }) => `portal-nav-link${isActive ? " active" : ""}`}
        >
          <Home />
          <span>Dashboard</span>
        </NavLink>
        <NavLink
          to="/analytics"
          className={({ isActive }) => `portal-nav-link${isActive ? " active" : ""}`}
        >
          <BarChart3 />
          <span>Analytics</span>
        </NavLink>
        <NavLink
          to="/dashboard#sync-data"
          className={() => `portal-nav-link${location.hash === "#sync-data" ? " active" : ""}`}
        >
          <FileText />
          <span>Sync Data</span>
        </NavLink>
      </nav>

      <div className="portal-sidebar-footer">
        <button type="button" className="portal-nav-link portal-logout" onClick={onLogout}>
          <LogOut />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}

function PortalShell({
  children,
  onLogout,
}: {
  children: React.ReactNode;
  onLogout: () => void;
}) {
  return (
    <div className="portal-layout">
      <PortalSidebar onLogout={onLogout} />
      <div className="portal-main">{children}</div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090e1a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />

          <p className="text-xs text-slate-400 font-mono">
            Connecting to Central Sync Portal...
          </p>
        </div>
      </div>
    );
  }

  return (
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
          user ? (
            <PortalShell onLogout={handleLogout}>
              <DashboardPage user={user} onLogout={handleLogout} />
            </PortalShell>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/analytics"
        element={
          user ? (
            <PortalShell onLogout={handleLogout}>
              <Suspense fallback={<p className="p-6 text-sm text-slate-500">Loading analytics...</p>}>
                <AnalyticsPage />
              </Suspense>
            </PortalShell>
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
  );
}

export default App;