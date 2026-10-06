
function Sidebar({ page, setPage, onLogout }) {
  const menu = [
    "Dashboard",
    "QC Records",
    "Data Fetch",
    "DB Configuration",
  ];

  return (
    <aside className="sidebar">
      <h2>Central Sync</h2>

      {menu.map((item) => (
        <button
          key={item}
          className={page === item ? "active" : ""}
          onClick={() => setPage(item)}
        >
          {item}
        </button>
      ))}

      <button onClick={onLogout}>Logout</button>
    </aside>
  );
}

export default Sidebar;