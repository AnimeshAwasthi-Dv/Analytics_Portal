
import { useEffect, useState } from "react";

import Login from "./Components/Login";
import Sidebar from "./Components/Sidebar";
import Dashboard from "./Components/Dashboard";
import QCRecords from "./Components/QCRecords";
import PlaceholderPage from "./Components/PlaceholderPage";

import { apiRequest } from "./services/api";
import "./App.css";

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("Dashboard");
  const [totalRecords, setTotalRecords] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    apiRequest("/auth/me")
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  async function handleLogin(email, password) {
    try {
      await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      const currentUser = await apiRequest("/auth/me");
      setUser(currentUser);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleLogout() {
    try {
      await apiRequest("/auth/logout", {
        method: "POST",
      });
    } finally {
      setUser(null);
      setPage("Dashboard");
    }
  }

  useEffect(() => {
    if (user) {
      apiRequest("/qc")
        .then((data) => setTotalRecords(data.length))
        .catch(() => {});
    }
  }, [user, page]);

  if (!user) {
    return (
      <>
        <Login onLogin={handleLogin} />
        {message && <p className="message">{message}</p>}
      </>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar
        page={page}
        setPage={setPage}
        onLogout={handleLogout}
      />

      <main className="main">
        <header className="topbar">
          <strong>{page}</strong>
          <span>{user.email}</span>
        </header>

        <section className="content">
          {page === "Dashboard" && (
            <Dashboard
              user={user}
              totalRecords={totalRecords}
              setPage={setPage}
            />
          )}

          {page === "QC Records" && <QCRecords />}

          {page === "Data Fetch" && (
            <PlaceholderPage title="Data Fetch" />
          )}

          {page === "DB Configuration" && (
            <PlaceholderPage title="Database Configuration" />
          )}
        </section>
      </main>
    </div>
  );
}

export default App;