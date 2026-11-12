
import { useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Network,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";
import { getPortalNavigation } from "../pacs/portalAccess";
import { currentWorkspace, initiateTaskManagerSSO } from "./transport";

const TASK_MANAGER_URL = "https://task.admindectrocel.online/";

const iconFor = (tab: string) =>
  tab.includes("Analytics") || tab === "Analytics" ? BarChart3 :
  tab.includes("Report") ? FileText :
  tab.includes("Notification") ? Bell :
  tab === "Patients" || tab.includes("Admin") || tab === "Radiologists" || tab === "Internal Team" ? Users :
  tab === "Centers" || tab === "Clients" || tab === "Portals" ? Building2 :
  tab.includes("Support") || tab === "Queries" || tab.includes("WhatsApp") ? MessageSquare :
  tab.includes("Audit") || tab.includes("License") ? ShieldCheck :
  tab.includes("Health") || tab.includes("Technical") ? Activity :
  tab === "Connections" ? Network :
  tab === "Analysis assistant" ? Sparkles :
  tab === "Processing" || tab === "Follow-ups" ? ClipboardList :
  tab === "Access controls" ? Settings2 :
  LayoutDashboard;

export function WorkspaceNavigation({
  tabs,
  active,
  onNavigate,
  count
}: {
  tabs: string[];
  active: string;
  onNavigate: (tab: string) => void;
  count?: number;
}) {
  const [search, setSearch] = useState("");
  const [isSsoLaunching, setIsSsoLaunching] = useState(false);

  const handleTaskManagerClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isSsoLaunching) return;
    setIsSsoLaunching(true);
    try {
      const redirectUrl = await initiateTaskManagerSSO();
      window.location.href = redirectUrl;
    } catch (err) {
      console.error("SSO launch error:", err);
      window.location.href = TASK_MANAGER_URL;
    } finally {
      setIsSsoLaunching(false);
    }
  };

  const clinical = !["all", "onprem"].includes(currentWorkspace());

  const pinned = tabs.filter(t =>
    ["Studies", "Reports", "Generated reports", "Available studies"].includes(t)
  );

  const groups = clinical
    ? [
        { label: "Workstation", items: pinned },
        ...getPortalNavigation("SUPER_ADMIN").map(g => ({
          ...g,
          items: g.items.filter(t => !pinned.includes(t))
        })),
        {
          label: "Central tools",
          items: tabs.filter(
            t =>
              !getPortalNavigation("SUPER_ADMIN").some(g => g.items.includes(t)) &&
              !pinned.includes(t)
          )
        }
      ]
    : [
        {
          label: currentWorkspace() === "all" ? "Organization" : "On-prem operations",
          items: tabs
        }
      ];

  const showTaskManager =
    !search.trim() ||
    "task manager".includes(search.trim().toLowerCase());

  const hasMatchingTab = tabs.some(t =>
    `${t} ${t === "Studies" ? "Worklist" : ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <nav aria-label="Main navigation" className="central-nav">

      <label className="central-nav-search">
        <Search size={13} />
        <input
          aria-label="Find a tab"
          placeholder="Find a tab..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </label>

      {groups.map(group => {
        const items = group.items.filter(t =>
          tabs.includes(t) &&
          `${t} ${t === "Studies" ? "Worklist" : ""}`
            .toLowerCase()
            .includes(search.toLowerCase())
        );

        return items.length ? (
          <div className="central-nav-group" key={group.label}>
            <h2>{group.label}</h2>

            {items.map(tab => {
              const label = tab === "Studies" ? "Worklist" : tab;
              const Icon = tab === "Studies" ? ClipboardList : iconFor(tab);

              return (
                <button
                  key={tab}
                  title={label}
                  aria-label={label}
                  aria-current={active === tab ? "page" : undefined}
                  className={`pw-nav${active === tab ? " active" : ""}`}
                  onClick={() => onNavigate(tab)}
                >
                  <Icon size={17} />
                  <span className="pw-nav-label">{label}</span>
                  {tab === "Studies" && count != null && (
                    <b className="pw-nav-count">{count}</b>
                  )}
                </button>
              );
            })}
          </div>
        ) : null;
      })}

      {/* Task Manager external portal link */}
      {showTaskManager && (
        <div className="central-nav-group">
          <h2>Tools</h2>

          <a
            href="/api/central/sso/task-manager/authorize?redirect=true"
            onClick={handleTaskManagerClick}
            title={isSsoLaunching ? "Connecting to Task Manager..." : "Task Manager"}
            aria-label="Open Task Manager"
            className="pw-nav"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              textDecoration: "none",
              cursor: "pointer",
              opacity: isSsoLaunching ? 0.7 : 1
            }}
          >
            <ClipboardList size={17} />
            <span className="pw-nav-label">
              {isSsoLaunching ? "Connecting..." : "Task Manager"}
            </span>
          </a>
        </div>
      )}

      {!hasMatchingTab && !showTaskManager && (
        <p className="central-nav-empty">No matching tabs</p>
      )}

    </nav>
  );
}
