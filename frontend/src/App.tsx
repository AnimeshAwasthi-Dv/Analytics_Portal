import React, { useEffect, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { api } from "./services/api.ts";

function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const location = useLocation();
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
            <DashboardPage
              user={user}
              onLogout={handleLogout}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* DEFAULT */}
      <Route
        path="/"
        element={<Navigate to="/dashboard" replace />}
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