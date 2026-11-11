import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, type User } from "../services/api";
import { WorkspaceIcon as Icon } from "../Components/WorkspaceIcon";
import {
  findPortalModule,
  portalNames,
  portalPath,
  type PortalModule,
} from "../Components/portalNavigation";
import { CommandCenterPage, type CommandView } from "./CommandCenterPage";
import {
  OperationsWorkspace,
  type OperationsView,
} from "./OperationsWorkspace";
import "./command-center.css";

type Registry = {
  items: { code: string; configured: boolean; lastSyncedAt: string | null }[];
};
type Activity = {
  items: {
    id: string;
    actor: string;
    action: string;
    centerId: string | null;
    occurredAt: string;
  }[];
  total: number;
  pageSize: number;
};
const day = (offset = 0) =>
  new Date(Date.now() + 19800000 + offset * 86400000)
    .toISOString()
    .slice(0, 10);
const stamp = (value: string) =>
  new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
function usePortalData<T>(
  endpoint: string,
  parameters: Record<string, string> = {},
) {
  const key = JSON.stringify([endpoint, parameters]);
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true,
      pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await api.commandGet<T>(endpoint, parameters);
        if (active) setResult({ key, data });
      } catch (e) {
        if (active)
          setResult({
            key,
            error:
              e instanceof Error ? e.message : "Unable to load portal data.",
          });
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
    // Request parameters are serialized in key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  return {
    ...(result?.key === key ? result : {}),
    refresh: () => setRevision((v) => v + 1),
  };
}

function sourcePortalUrl(code: string) {
  const configured: Record<string, string | undefined> = {
    marengo: import.meta.env.VITE_MARENGO_PORTAL_URL,
    goyal: import.meta.env.VITE_GOYAL_PORTAL_URL,
    pacs: import.meta.env.VITE_PACS_PORTAL_URL,
    onprem: import.meta.env.VITE_ONPREM_PORTAL_URL,
  };
  try {
    const url = new URL(configured[code] || "");
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function SourceModule({
  portal,
  module,
}: {
  portal: string;
  module: PortalModule;
}) {
  const registry = usePortalData<Registry>("portals");
  const source = registry.data?.items.find((p) => p.code === portal);
  const original = sourcePortalUrl(portal);
  return (
    <div className="cc-page pacs-source-module">
      <header className="cc-page-heading">
        <div>
          <h1>{module.label}</h1>
          <p>{module.description}</p>
        </div>
        <span className="pacs-capability-badge">Module data not connected</span>
      </header>
      <div className="pacs-module-toolbar">
        <span>
          <Icon name={module.icon} size={16} />
          {portalNames[portal]} / {module.label}
        </span>
        {original && (
          <a
            className="cc-button"
            href={original}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open source portal <Icon name="arrow" size={14} />
          </a>
        )}
      </div>
      {registry.error && (
        <div className="cc-alert danger" role="alert">
          {registry.error}
          <button onClick={registry.refresh}>Retry</button>
        </div>
      )}
      <section className="pacs-source-panel">
        <div className="cc-table-scroll">
          <table className="pacs-data-table">
            <thead>
              <tr>
                {(module.columns || ["Name", "Status", "Updated"]).map(
                  (column) => (
                    <th key={column}>{column}</th>
                  ),
                )}
              </tr>
            </thead>
          </table>
        </div>
        <div className="pacs-module-empty">
          <span>
            <Icon name={module.icon} size={28} />
          </span>
          <h2>
            {module.label} in {portalNames[portal]}
          </h2>
          <p>
            {source
              ? source.configured
                ? "The portal database is connected. This module's records and actions have not been integrated into central command yet."
                : "Connect this portal's database to start its central integration."
              : "Checking the portal connection…"}
          </p>
          <p>
            This is the same module from your portal menu. Its records will
            appear here when its integration is connected.
          </p>
          <div>
            <Link className="cc-button" to={portalPath(portal)}>
              Back to dashboard
            </Link>
            {original && (
              <a
                className="cc-button primary"
                href={original}
                target="_blank"
                rel="noopener noreferrer"
              >
                Continue in source portal
              </a>
            )}
          </div>
          {!original && (
            <small>
              The source portal's web address is not configured for direct
              access.
            </small>
          )}
        </div>
      </section>
    </div>
  );
}

function SourceAudit({ portal }: { portal: string }) {
  const [search, setSearch] = useSearchParams();
  const start = search.get("start") || day(-29),
    end = search.get("end") || day(),
    q = search.get("q") || "",
    page = Math.max(1, Number(search.get("page")) || 1);
  const result = usePortalData<Activity>("source-activity", {
    portal,
    start,
    end,
    q,
    page: String(page),
  });
  const update = (patch: Record<string, string>) =>
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      next.delete("page");
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  return (
    <div className="cc-page">
      <header className="cc-page-heading">
        <div>
          <h1>Audit Logs</h1>
          <p>
            Verified user activity from {portalNames[portal]}. Central
            access-change history is available under organization Audit Logs.
          </p>
        </div>
        <button onClick={result.refresh}>
          <Icon name="refresh" size={15} /> Refresh
        </button>
      </header>
      {result.error && (
        <div className="cc-alert danger" role="alert">
          {result.error}
          <button onClick={result.refresh}>Retry</button>
        </div>
      )}
      <section className="pacs-source-panel">
        <div className="pacs-audit-filters">
          <label>
            Search
            <input
              aria-label="Search source audit"
              placeholder="Action or user…"
              value={q}
              onChange={(e) => update({ q: e.target.value })}
            />
          </label>
          <label>
            From
            <input
              type="date"
              aria-label="From date"
              value={start}
              onChange={(e) => update({ start: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              aria-label="To date"
              value={end}
              onChange={(e) => update({ end: e.target.value })}
            />
          </label>
        </div>
        <div className="cc-table-scroll">
          <table className="pacs-data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Action</th>
                <th>Center ID</th>
                <th>Time (IST)</th>
              </tr>
            </thead>
            <tbody>
              {result.data?.items.map((row) => (
                <tr key={row.id}>
                  <td>{row.actor}</td>
                  <td className="pacs-audit-action">{row.action}</td>
                  <td>{row.centerId || "Unattributed"}</td>
                  <td>{stamp(row.occurredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!result.data?.items.length && !result.error && (
          <p className="pacs-empty-state">
            {result.data
              ? "No source audit records for this period."
              : "Loading source audit records…"}
          </p>
        )}
        <footer className="cc-pagination">
          <span>
            {result.data?.total.toLocaleString("en-IN") || "0"} records
          </span>
          <div>
            <button
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) })}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              disabled={!result.data || page * 25 >= result.data.total}
              onClick={() => update({ page: String(page + 1) })}
            >
              Next
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function PortalWorkspacePage() {
  const { portalCode = "", tab } = useParams();
  const { user } = useOutletContext<{ user: User }>();
  if (!portalNames[portalCode])
    return (
      <div className="cc-page">
        <h1>Portal not found</h1>
        <p>Choose a portal from the organization dashboard.</p>
        <Link className="cc-button" to="/command">
          All portals
        </Link>
      </div>
    );
  if (!tab) return <Navigate to={portalPath(portalCode)} replace />;
  const module = findPortalModule(portalCode, tab);
  if (!module)
    return (
      <div className="cc-page">
        <h1>Tab not found</h1>
        <p>This tab is not part of {portalNames[portalCode]}.</p>
        <Link className="cc-button" to={portalPath(portalCode)}>
          Portal dashboard
        </Link>
      </div>
    );
  if (module.permission && !user.permissions?.includes(module.permission))
    return (
      <div className="cc-page">
        <h1>{module.label}</h1>
        <p>Your internal team role does not allow this action.</p>
        <Link className="cc-button" to={portalPath(portalCode)}>
          Portal dashboard
        </Link>
      </div>
    );
  if (!module.view)
    return (
      <SourceModule
        key={`${portalCode}:${tab}`}
        portal={portalCode}
        module={module}
      />
    );
  if (module.view === "activity")
    return <SourceAudit key={portalCode} portal={portalCode} />;
  if (
    [
      "overview",
      "centers",
      "reports",
      "sources",
      "controls",
      "assistant",
    ].includes(module.view)
  )
    return (
      <CommandCenterPage
        key={`${portalCode}:${tab}`}
        view={module.view as CommandView}
        heading={module.label}
      />
    );
  return (
    <OperationsWorkspace
      key={`${portalCode}:${tab}`}
      view={module.view as OperationsView}
      heading={module.label}
      userRole={module.role}
    />
  );
}
