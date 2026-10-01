
function Dashboard({ user, totalRecords, setPage }) {
  return (
    <>
      <h1>Dashboard</h1>
      <p>Welcome to Central Sync Portal.</p>

      <div className="cards">
        <div className="card">
          <p>Total QC Records</p>
          <h2>{totalRecords}</h2>
        </div>

        <div className="card">
          <p>System Status</p>
          <h2 style={{ color: "green" }}>Online</h2>
        </div>

        <div className="card">
          <p>Logged-in User</p>
          <h3>{user.email}</h3>
        </div>
      </div>

      <div className="panel">
        <h3>Quick Actions</h3>

        <button onClick={() => setPage("QC Records")}>
          View QC Records
        </button>

        <button onClick={() => setPage("Data Fetch")}>
          Data Fetch
        </button>

        <button onClick={() => setPage("DB Configuration")}>
          Database Configuration
        </button>
      </div>
    </>
  );
}

export default Dashboard;