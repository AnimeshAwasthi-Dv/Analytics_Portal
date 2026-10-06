import React, { useEffect, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Sidebar } from "./Components/Sidebar";
import { TopNavbar } from "./Components/TopNavbar";
import { DashboardPage } from "./pages/DashboardPage";
import { DatabaseInstancesPage } from "./pages/DatabaseInstancesPage";
import { InstanceDetailsPage } from "./pages/InstanceDetailsPage";
import { SyncMonitoringPage } from "./pages/SyncMonitoringPage";
import { IncomingDataPage } from "./pages/IncomingDataPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ReportDetailPage } from "./pages/ReportDetailPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { ApiManagementPage } from "./pages/ApiManagementPage";
import { SyncLogsPage } from "./pages/SyncLogsPage";
import { DatabaseConfigPage } from "./pages/DatabaseConfigPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LoginPage } from "./pages/LoginPage";
import { api } from "./services/api";

function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [onlineCount, setOnlineCount] = useState(5);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .getCurrentUser()
      .then((usr) => {
        setUser(usr);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });

    // Check DB counts
    api.getInstances().then((insts) => {
      setOnlineCount(insts.filter((i) => i.status === "Online").length);
    });
  }, []);

  const getPageTitle = (pathname: string) => {
    if (pathname.startsWith("/dashboard")) return "Central Sync Dashboard";
    if (pathname.startsWith("/instances/") && pathname !== "/instances")
      return "Database Instance Details";
    if (pathname.startsWith("/instances")) return "Database Instances";
    if (pathname.startsWith("/sync")) return "Sync Monitoring";
    if (pathname.startsWith("/incoming-data")) return "Incoming Data Stream";
    if (pathname.startsWith("/reports/") && pathname !== "/reports")
      return "Clinical Report Details";
    if (pathname.startsWith("/reports")) return "Synchronized Reports";
    if (pathname.startsWith("/analytics")) return "Sync & Ingestion Analytics";
    if (pathname.startsWith("/api-management")) return "API & Key Management";
    if (pathname.startsWith("/logs")) return "Sync Audit Logs";
    if (pathname.startsWith("/database-config")) return "Database Configuration";
    if (pathname.startsWith("/settings")) return "Portal Settings";
    return "Central Sync Portal";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090e1a] flex items-center justify-center text-xs text-slate-400 font-mono">
        Connecting to Central Sync Portal Gateway...
      </div>
    );
  }

  if (!user && location.pathname !== "/login") {
    return (
      <LoginPage
        onLoginSuccess={(loggedUser) => {
          setUser(loggedUser);
          navigate("/dashboard");
        }}
      />
    );
  }

  return (
    <Routes>
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

      {/* Main Admin App Layout */}
      <Route
        path="/*"
        element={
          <div className="flex h-screen bg-[#f8fafc] text-slate-800 overflow-hidden font-sans">
            {/* Dark Navy Sidebar */}
            <Sidebar
              onlineCount={onlineCount}
              onLogout={() => setUser(null)}
            />

            {/* Light Content Area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {/* Top Navbar */}
              <TopNavbar
                pageTitle={getPageTitle(location.pathname)}
                userEmail={user?.email || "admin@local.com"}
                apiStatus="ONLINE"
              />

              {/* Page Content Viewport */}
              <main className="flex-1 overflow-y-auto p-6">
                <div className="max-w-7xl mx-auto">
                  <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/instances" element={<DatabaseInstancesPage />} />
                    <Route path="/instances/:id" element={<InstanceDetailsPage />} />
                    <Route path="/sync" element={<SyncMonitoringPage />} />
                    <Route path="/incoming-data" element={<IncomingDataPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/reports/:id" element={<ReportDetailPage />} />
                    <Route path="/analytics" element={<AnalyticsPage />} />
                    <Route path="/api-management" element={<ApiManagementPage />} />
                    <Route path="/logs" element={<SyncLogsPage />} />
                    <Route path="/database-config" element={<DatabaseConfigPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Routes>
                </div>
              </main>
            </div>
          </div>
        }
      />
    </Routes>
  );
}

export default App;
