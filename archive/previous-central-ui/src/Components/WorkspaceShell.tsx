import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { api, type User } from "../services/api";
import { WorkspaceIcon as Icon, type WorkspaceIconName } from "./WorkspaceIcon";
import {
  findPortalModule,
  portalFromPath,
  portalNames,
  portalNavigation,
  portalPath,
  portalTools,
} from "./portalNavigation";
import "../workspace.css";
import "../pacs-command.css";
import { scopedHref } from "./workspaceNavigation";

type Destination = {
  path: string;
  label: string;
  icon: WorkspaceIconName;
  description?: string;
  permission?: string;
};
const organizationNavigation: { label: string; items: Destination[] }[] = [
  {
    label: "Command",
    items: [
      { path: "/command", label: "Dashboard", icon: "overview" },
      { path: "/portals", label: "Portals", icon: "portals" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { path: "/reports", label: "Overall analytics", icon: "chart" },
      { path: "/assistant", label: "Analysis assistant", icon: "assistant" },
    ],
  },
  {
    label: "Organization",
    items: [
      { path: "/clients", label: "Clients", icon: "centers" },
      {
        path: "/team",
        label: "Internal team",
        icon: "team",
        permission: "team:manage",
      },
      {
        path: "/audit",
        label: "Audit Logs",
        icon: "audit",
        permission: "audit:read",
      },
    ],
  },
  {
    label: "Administration",
    items: [
      { path: "/sources", label: "Connections", icon: "sync" },
      {
        path: "/operations",
        label: "Access controls",
        icon: "controls",
        permission: "portals:control",
      },
      { path: "/sync", label: "Sync activity", icon: "sync" },
      {
        path: "/traffic-analytics",
        label: "Traffic analytics",
        icon: "activity",
      },
      {
        path: "/control",
        label: "API access",
        icon: "settings",
        permission: "team:manage",
      },
    ],
  },
  {
    label: "Legacy licensing",
    items: [
      { path: "/desktop/analytics", label: "License overview", icon: "chart" },
      { path: "/desktop/licenses", label: "License keys", icon: "key" },
      { path: "/desktop/plans", label: "Plans & credits", icon: "plans" },
      {
        path: "/desktop/key-analytics",
        label: "Key activity",
        icon: "activity",
      },
    ],
  },
];
export function WorkspaceShell({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const location = useLocation(),
    navigate = useNavigate();
  const portal = portalFromPath(location.pathname);
  const portalName = portalNames[portal] || portal;
  const [registry, setRegistry] = useState<
    {
      code: string;
      name: string;
      configured: boolean;
      lastSyncedAt: string | null;
    }[]
  >([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("dectrocel-pacs-sidebar-collapsed") === "true",
  );
  const [closed, setClosed] = useState<string[]>([
    "Administration",
    "Legacy licensing",
  ]);
  const [query, setQuery] = useState("");
  const palette = useRef<HTMLDialogElement>(null),
    search = useRef<HTMLInputElement>(null),
    tools = useRef<HTMLDetailsElement>(null);
  const can = (permission?: string) =>
    !permission || user.permissions?.includes(permission);
  const groups = (
    portal
      ? portalNavigation(portal).map((g) => ({
          ...g,
          items: g.items.map((m) => ({
            ...m,
            path: portalPath(portal, m.slug),
          })),
        }))
      : organizationNavigation
  )
    .map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) }))
    .filter((g) => g.items.length);
  const destinations = groups.flatMap((g) => g.items);
  const toolItems = portal
    ? portalTools(portal).filter((m) => can(m.permission))
    : [];
  const allDestinations = [
    ...destinations,
    ...toolItems.map((m) => ({ ...m, path: portalPath(portal, m.slug) })),
  ];
  const current = allDestinations.find((i) => i.path === location.pathname);
  const selectedModule = portal
    ? findPortalModule(portal, location.pathname.split("/")[3] || "dashboard")
    : null;
  const currentTitle =
    current?.label ||
    selectedModule?.label ||
    (
      {
        "/centers": "Centers",
        "/services": "Services",
        "/users": "Users",
        "/studies": "Studies",
        "/processing": "Processing",
        "/generated-reports": "Reports",
        "/analytics": "Received study analytics",
        "/marengo-analytics": "Marengo review statistics",
      } as Record<string, string>
    )[location.pathname] ||
    "Workspace";
  const currentGroup =
    groups.find((g) => g.items.some((i) => i.path === current?.path))?.label ||
    (portal ? "Central tools" : "Organization");
  const matches = allDestinations.filter((i) =>
    `${i.label} ${i.description || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selectedSource = registry.find((p) => p.code === portal);
  const openSearch = () => {
    setQuery("");
    palette.current?.showModal();
    requestAnimationFrame(() => search.current?.focus());
  };
  const jump = (path: string) => {
    navigate(path);
    palette.current?.close();
    setMobileOpen(false);
    if (tools.current) tools.current.open = false;
  };
  const href = (path: string) =>
    scopedHref(path, location.search, location.pathname);
  const changePortal = (code: string) =>
    jump(code ? portalPath(code) : "/command");
  useEffect(() => {
    let active = true;
    api
      .commandGet<{ items: typeof registry }>("portals")
      .then((d) => {
        if (active) setRegistry(d.items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("dectrocel-pacs-sidebar-collapsed", String(collapsed));
  }, [collapsed]);
  useEffect(() => {
    document.title = `${currentTitle} | ${portalName || "Dectrocel"}`;
  }, [currentTitle, portalName]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      }
      if (e.key === "Escape") {
        setMobileOpen(false);
        if (tools.current) tools.current.open = false;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow,
      origin = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const aside = document.querySelector<HTMLElement>(".workspace-sidebar");
    const items = () =>
      Array.from(
        aside?.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled]),input,select",
        ) || [],
      ).filter((e) => e.getClientRects().length > 0);
    items()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || document.querySelector("dialog[open]")) return;
      const list = items(),
        first = list[0],
        last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", trap);
      origin?.focus();
    };
  }, [mobileOpen]);
  const initials = (user.name || user.email)
    .split(/[ @]+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <div
      className={`workspace-layout pacs-central${collapsed ? " is-collapsed" : ""}${portal ? " is-portal-workspace" : " is-organization-workspace"}`}
    >
      <a className="workspace-skip" href="#workspace-content">
        Skip to content
      </a>
      <header className="workspace-topbar">
        <Link to="/command" className="pacs-header-brand">
          <img src="/brand-mark.svg" alt="" />
          <span>
            <strong>DECTROCEL</strong>
            <small>Central command</small>
          </span>
        </Link>
        <button
          className="workspace-mobile-menu"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
        >
          <Icon name="menu" />
        </button>
        <button
          className="pacs-desktop-collapse"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
        >
          <Icon name="menu" size={18} />
        </button>
        <div className="pacs-workspace-title">
          <strong>{portal ? portalName : "All portals"}</strong>
          <span>{portal ? "Portal workspace" : "Organization overview"}</span>
        </div>
        <div className="workspace-topbar-right">
          <label className="workspace-portal-switch">
            <Icon name="portals" size={15} />
            <select
              aria-label="Active workspace"
              value={portal}
              onChange={(e) => changePortal(e.target.value)}
            >
              <option value="">All portals</option>
              {Object.entries(portalNames).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {portal && (
            <details className="pacs-tools" ref={tools}>
              <summary>
                Central tools <Icon name="chevron" size={12} />
              </summary>
              <div>
                {toolItems.map((m) => (
                  <Link
                    key={m.slug}
                    to={href(portalPath(portal, m.slug))}
                    onClick={() => {
                      if (tools.current) tools.current.open = false;
                    }}
                  >
                    <Icon name={m.icon} size={15} />
                    {m.label}
                  </Link>
                ))}
              </div>
            </details>
          )}
          <button
            className="pacs-search-button"
            onClick={openSearch}
            aria-label="Find a page"
          >
            <Icon name="search" size={17} />
            <kbd>Ctrl K</kbd>
          </button>
          <div className="pacs-header-account">
            <span className="workspace-avatar">{initials}</span>
            <span>
              {user.name || "Team member"}
              <small>{(user.role || "viewer").replaceAll("_", " ")}</small>
            </span>
          </div>
        </div>
      </header>
      {mobileOpen && (
        <button
          className="workspace-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`workspace-sidebar${mobileOpen ? " is-open" : ""}`}
        aria-label={
          portal ? `${portalName} navigation` : "Organization navigation"
        }
      >
        {portal ? (
          <>
            <Link
              to="/command"
              className="pacs-back-link"
              onClick={() => setMobileOpen(false)}
            >
              <Icon name="arrow" size={14} /> All portals
            </Link>
            <div className="pacs-sidebar-context">
              <span>{portalName}</span>
              <small>
                {selectedSource
                  ? selectedSource.configured
                    ? "Central data snapshot"
                    : "Source not connected"
                  : "Portal workspace"}
              </small>
            </div>
          </>
        ) : (
          <div className="pacs-sidebar-context">
            <span>Dectrocel</span>
            <small>Organization-wide operations</small>
          </div>
        )}
        <nav className="workspace-navigation" aria-label="Main navigation">
          {groups.map((g) => {
            const active = g.items.some((i) => i.path === location.pathname),
              expanded = !closed.includes(g.label) || active;
            return (
              <section className="workspace-nav-group" key={g.label}>
                <button
                  className="workspace-group-heading"
                  aria-expanded={!!expanded}
                  onClick={() =>
                    setClosed((v) =>
                      v.includes(g.label)
                        ? v.filter((s) => s !== g.label)
                        : [...v, g.label],
                    )
                  }
                >
                  <span>{g.label}</span>
                  <Icon
                    name="chevron"
                    size={12}
                    className={expanded ? "expanded" : ""}
                  />
                </button>
                {expanded &&
                  g.items.map((i) => (
                    <NavLink
                      key={i.path}
                      to={href(i.path)}
                      end
                      title={i.label}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        `workspace-nav-item${isActive ? " active" : ""}`
                      }
                    >
                      <Icon name={i.icon} size={17} />
                      <span>{i.label}</span>
                    </NavLink>
                  ))}
              </section>
            );
          })}
        </nav>
        <div className="workspace-account">
          <span className="workspace-avatar">{initials}</span>
          <div>
            <strong>{user.name || "Team member"}</strong>
            <small>{portal ? portalName : "Dectrocel internal team"}</small>
          </div>
          <button onClick={onLogout} aria-label="Sign out" title="Sign out">
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace-body">
        <main id="workspace-content" className="workspace-main" tabIndex={-1}>
          <div className="pacs-page-breadcrumb">
            <span>{portalName || "Dectrocel"}</span>
            <Icon name="chevron" size={12} />
            <span>{currentGroup}</span>
            <Icon name="chevron" size={12} />
            <strong>{currentTitle}</strong>
          </div>
          <Outlet context={{ user, portalCode: portal }} />
        </main>
      </div>
      <dialog
        ref={palette}
        className="workspace-palette"
        onClick={(e) => {
          if (e.target === palette.current) palette.current?.close();
        }}
      >
        <div className="workspace-palette-search">
          <Icon name="search" />
          <input
            ref={search}
            aria-label="Find a page"
            placeholder={
              portal
                ? `Find a ${portalName} tab...`
                : "Find an organization page..."
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                e.preventDefault();
                jump(href(matches[0].path));
              }
            }}
          />
          <button
            aria-label="Close page search"
            onClick={() => palette.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="workspace-palette-results">
          {matches.map((i) => (
            <button key={i.path} onClick={() => jump(href(i.path))}>
              <Icon name={i.icon} />
              <span>
                <strong>{i.label}</strong>
                <small>{portalName || "Organization workspace"}</small>
              </span>
              <Icon name="chevron" size={14} />
            </button>
          ))}
          {!matches.length && <p>No matching pages.</p>}
        </div>
        <footer>
          {portal ? `${portalName} workspace` : "All portals"}
          <kbd>Esc to close</kbd>
        </footer>
      </dialog>
    </div>
  );
}
