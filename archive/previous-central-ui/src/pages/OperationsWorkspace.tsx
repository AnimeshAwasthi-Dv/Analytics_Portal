import { useEffect, useState } from "react";
import { useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { api, type User } from "../services/api";
import { WorkspaceLink as Link } from "../Components/WorkspaceScope";
import { WorkspaceDrawer } from "../Components/WorkspaceDrawer";
import { WorkspaceIcon as Icon } from "../Components/WorkspaceIcon";
import "./command-center.css";
import "./operations-workspace.css";

type Portal = {
  code: string;
  name: string;
  clientCode: string;
  kind: string;
  configured: boolean;
  lastSyncedAt: string | null;
  centers: { id: string; name: string; clientCode: string; status: string }[];
};
type Row = {
  id: string;
  portal: string;
  name?: string;
  centerId?: string;
  centerName?: string;
  client?: string;
  kind?: string;
  enabled?: boolean;
  details?: Record<string, unknown>;
  status?: string;
  service?: string;
  modality?: string;
  createdAt?: string;
  updatedAt?: string;
  durationMs?: number | null;
  credits?: number | null;
  outputFormat?: string | null;
};
type Result = {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  coverage?: string;
};
export type OperationsView =
  | "clients"
  | "services"
  | "users"
  | "studies"
  | "processing"
  | "generated-reports"
  | "licenses"
  | "workstations";
const metadata = {
  licenses: [
    "License management",
    "License access, service entitlements, credits and expiry from the on-prem licensing server.",
  ],
  workstations: [
    "Workstations",
    "Registered on-prem workstations and their observed access state.",
  ],
  clients: [
    "Clients",
    "Your client network across dedicated portals, Common PACS and on-prem accounts.",
  ],
  services: [
    "Services",
    "Service availability and center subscriptions across your portal network.",
  ],
  users: [
    "Users",
    "Portal users and their source roles. Manage your Dectrocel team separately in Internal team.",
  ],
  studies: [
    "Studies",
    "Monitor study processing status using the central clinical snapshot.",
  ],
  processing: [
    "Processing",
    "Follow service jobs from queue to completion across connected portals.",
  ],
  "generated-reports": [
    "Reports",
    "Monitor report review and delivery status from connected clinical snapshots.",
  ],
};
const states: Record<string, string[]> = {
  studies: ["ALL", "QUEUED", "PROCESSING", "SUCCESS", "FAILED"],
  processing: ["ALL", "QUEUED", "PROCESSING", "SUCCESS", "FAILED"],
  "generated-reports": [
    "ALL",
    "PENDING",
    "IN_REVIEW",
    "SAVED",
    "APPROVED",
    "PUSHED",
    "FAILED",
  ],
};
const labels: Record<string, string> = {
  ALL: "All",
  QUEUED: "Queued",
  PROCESSING: "Processing",
  SUCCESS: "Completed",
  FAILED: "Failed",
  PENDING: "Pending",
  IN_REVIEW: "In review",
  SAVED: "Saved",
  APPROVED: "Approved",
  PUSHED: "Pushed",
  all: "All",
  enabled: "Active",
  disabled: "Inactive",
};
const day = (offset = 0) =>
  new Date(Date.now() + 19800000 + offset * 86400000)
    .toISOString()
    .slice(0, 10);
const stamp = (s?: string | null) =>
  s
    ? new Date(s).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const detailLabel = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (s) => s.toUpperCase());
const detailValue = (key: string, value: unknown): string => {
  if (
    ["validUntil", "expiresAt", "lastSeen"].includes(key) &&
    typeof value === "string"
  )
    return stamp(value);
  if (Array.isArray(value))
    return value
      .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
      .join(", ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};
function useSnapshot<T>(
  endpoint: string | null,
  params: Record<string, string>,
  revision: number,
) {
  const key = JSON.stringify([endpoint, params, revision]);
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>();
  useEffect(() => {
    if (!endpoint) return;
    let active = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await api.commandGet<T>(endpoint, params);
        if (active) setResult({ key, data });
      } catch (e) {
        if (active)
          setResult({
            key,
            error:
              e instanceof Error ? e.message : "Unable to load this worklist.",
          });
      } finally {
        pending = false;
      }
    };
    const debounce = window.setTimeout(() => void load(), params.q ? 250 : 0);
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const interval = window.setInterval(visible, 30000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearTimeout(debounce);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
    // Serialized parameters make the request identity stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return result?.key === key ? result : { key };
}

export function OperationsWorkspace({
  view,
  heading,
  userRole,
}: {
  view: OperationsView;
  heading?: string;
  userRole?: "RADIOLOGIST" | "GROUP_ADMIN";
}) {
  const { portalCode } = useParams();
  const [search, setSearch] = useSearchParams();
  const { user } = useOutletContext<{ user: User }>();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null);
  const clinical = ["studies", "processing", "generated-reports"].includes(
    view,
  );
  const portal = portalCode || search.get("portal") || "";
  const client = search.get("client") || "";
  const center = search.get("center") || "";
  const q = search.get("q") || "";
  const page = Math.max(1, Number(search.get("page")) || 1);
  const state = search.get("state") || (clinical ? "ALL" : "all");
  const kind =
    view === "licenses"
      ? "license"
      : view === "workstations"
        ? "workstation"
        : view === "users"
          ? "user"
          : search.get("kind") === "subscription" ||
              (!search.has("kind") && (client || center))
            ? "subscription"
            : "service";
  const registry = useSnapshot<{ items: Portal[] }>("portals", {}, revision);
  const parameters: Record<string, string> = { page: String(page), state };
  for (const [key, value] of Object.entries({ portal, client, center, q }))
    if (value) parameters[key] = value;
  if (clinical) {
    parameters.start = search.get("start") || day(-29);
    parameters.end = search.get("end") || day();
    if (search.get("service")) parameters.service = search.get("service")!;
    if (search.get("modality")) parameters.modality = search.get("modality")!;
  } else parameters.kind = kind;
  if (userRole) parameters.role = userRole;
  const result = useSnapshot<Result>(
    view === "clients"
      ? null
      : clinical
        ? `worklist/${view === "generated-reports" ? "reports" : view}`
        : "inventory",
    parameters,
    revision,
  );
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
  const portals = registry.data?.items || [];
  const portalName = (code: string) =>
    portals.find((p) => p.code === code)?.name || code;
  const clients = new Map<
    string,
    {
      key: string;
      code: string;
      name: string;
      centerId?: string;
      portals: Set<string>;
      centers: number;
      active: number;
    }
  >();
  for (const p of portals.filter((p) => !portal || p.code === portal)) {
    const entries = p.centers.length
      ? p.centers
      : [{ clientCode: p.clientCode, status: "", id: "", name: p.name }];
    for (const c of entries) {
      if ((client && c.clientCode !== client) || (center && c.id !== center))
        continue;
      const account = p.kind === "onprem";
      const key = account ? `${p.code}:${c.id}` : c.clientCode;
      const canonical = portals.find(
        (p) => p.clientCode === c.clientCode && p.kind === "dedicated",
      );
      const item = clients.get(key) || {
        key,
        code: c.clientCode,
        name:
          account || c.clientCode.startsWith("pacs:")
            ? c.name
            : canonical?.name ||
              (c.clientCode === p.clientCode ? p.name : c.clientCode),
        centerId: account ? c.id : undefined,
        portals: new Set<string>(),
        centers: 0,
        active: 0,
      };
      item.portals.add(p.code);
      if (c.id) {
        item.centers++;
        if (c.status === "ACTIVE") item.active++;
      }
      clients.set(key, item);
    }
  }
  const clientRows = [...clients.values()]
    .filter((c) =>
      `${c.name} ${c.code}`.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const total =
    view === "clients" ? clientRows.length : result.data?.total || 0;
  const error = registry.error || result.error;
  const loaded = view === "clients" ? !!registry.data : !!result.data;
  const rows = result.data?.items || [];
  const canControl = user.permissions?.includes("portals:control");
  const action = selected?.kind ? `${selected.kind}_access` : "";
  return (
    <div className="cc-page ops-page">
      <header className="cc-page-heading">
        <div>
          <div className="cc-eyebrow">
            {clinical ? "CLINICAL OPERATIONS" : "CLIENT NETWORK"}
          </div>
          <h1>{heading || metadata[view][0]}</h1>
          <p>{metadata[view][1]}</p>
        </div>
        <div className="cc-page-actions">
          <button
            onClick={() => setRevision((v) => v + 1)}
            aria-label="Refresh current page"
          >
            <Icon name="refresh" size={16} /> Refresh
          </button>
        </div>
      </header>
      {error && (
        <div className="cc-alert danger" role="alert">
          {error}
          <button onClick={() => setRevision((v) => v + 1)}>Retry</button>
        </div>
      )}
      <div className="ops-context">
        <Icon name="portals" size={17} />
        <strong>{portal ? portalName(portal) : "All portals"}</strong>
        <span>
          {client
            ? `Client: ${client}`
            : portal
              ? "Portal workspace"
              : "Organization workspace"}
        </span>
        <small>Central snapshots · refresh every 30 seconds</small>
      </div>
      {clinical && (
        <nav className="ops-workflow" aria-label="Clinical operations">
          <Link to="/studies" className={view === "studies" ? "active" : ""}>
            Studies
          </Link>
          <Icon name="chevron" size={13} />
          <Link
            to="/processing"
            className={view === "processing" ? "active" : ""}
          >
            Processing
          </Link>
          <Icon name="chevron" size={13} />
          <Link
            to="/generated-reports"
            className={view === "generated-reports" ? "active" : ""}
          >
            Reports
          </Link>
          <Link to="/reports" className="ops-analysis-link">
            <Icon name="chart" size={15} /> Analytics
          </Link>
        </nav>
      )}
      {view === "services" && (
        <div className="ops-tabs" aria-label="Service view">
          {[
            ["service", "Service catalog"],
            ["subscription", "Center subscriptions"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={kind === key ? "active" : ""}
              aria-pressed={kind === key}
              onClick={() => update({ kind: key, state: "all" })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <section className="ops-worklist">
        {view !== "clients" && (
          <div className="ops-tabs" aria-label="Worklist status">
            {(clinical ? states[view] : ["all", "enabled", "disabled"]).map(
              (key) => (
                <button
                  key={key}
                  aria-pressed={state === key}
                  className={state === key ? "active" : ""}
                  onClick={() => update({ state: key })}
                >
                  {labels[key]}
                  <span>
                    {result.data ? result.data.counts[key] || 0 : "—"}
                  </span>
                </button>
              ),
            )}
          </div>
        )}
        <div className="ops-filters">
          <label className="cc-search-field">
            <Icon name="search" size={16} />
            <input
              aria-label={`Search ${metadata[view][0].toLowerCase()}`}
              placeholder={
                clinical ? "Search record ID..." : "Search by name or ID..."
              }
              value={q}
              onChange={(e) => update({ q: e.target.value })}
            />
          </label>
          <select
            aria-label="Center"
            value={center}
            onChange={(e) =>
              update({
                center: e.target.value,
                ...(e.target.value
                  ? {
                      portal:
                        e.target.selectedOptions[0].dataset.portal || portal,
                    }
                  : {}),
              })
            }
          >
            <option value="">All centers</option>
            {portals
              .filter((p) => !portal || p.code === portal)
              .flatMap((p) =>
                p.centers
                  .filter((c) => !client || c.clientCode === client)
                  .map((c) => (
                    <option
                      key={`${p.code}:${c.id}`}
                      value={c.id}
                      data-portal={p.code}
                    >
                      {p.name} / {c.name}
                    </option>
                  )),
              )}
          </select>
          {clinical && (
            <>
              <label>
                From
                <input
                  aria-label="From date"
                  type="date"
                  value={parameters.start}
                  onChange={(e) => update({ start: e.target.value })}
                />
              </label>
              <label>
                To
                <input
                  aria-label="To date"
                  type="date"
                  value={parameters.end}
                  onChange={(e) => update({ end: e.target.value })}
                />
              </label>
              <button onClick={() => update({ start: day(-6), end: day() })}>
                Last 7 days
              </button>
            </>
          )}
          {(client ||
            center ||
            search.get("service") ||
            search.get("modality")) && (
            <button
              onClick={() =>
                update({
                  client: "",
                  center: "",
                  service: "",
                  modality: "",
                  state: clinical ? "ALL" : "all",
                  q: "",
                })
              }
            >
              Clear filters
            </button>
          )}
        </div>
        {clinical && search.get("modality") && (
          <p className="ops-note">
            Service group: {search.get("modality")}. This filter also applies to
            Analytics.
          </p>
        )}
        {view === "services" && client && kind === "service" && (
          <p className="ops-note">
            Services are a portal-wide catalog. Use{" "}
            <button onClick={() => update({ kind: "subscription" })}>
              Center subscriptions
            </button>{" "}
            for services assigned to this client.
          </p>
        )}
        {result.data?.coverage && (
          <p className="ops-note">
            <Icon name="sync" size={15} />
            {result.data.coverage}
          </p>
        )}
        {registry.data &&
          portal &&
          !portals.find((p) => p.code === portal)?.configured &&
          loaded && (
            <p className="ops-note">
              This portal database is not connected. Configure its source
              connection in Healthcheck.
            </p>
          )}
        <div className="cc-table-scroll ops-table-frame">
          <table>
            <thead>
              <tr>
                {(view === "clients"
                  ? ["Client", "Portals", "Centers / accounts", "Active", ""]
                  : clinical
                    ? [
                        "Record ID",
                        "Portal / center",
                        "Service / modality",
                        "Status",
                        "Received (IST)",
                        view === "processing" ? "Duration" : "Updated (IST)",
                        "",
                      ]
                    : [
                        view === "users"
                          ? "User"
                          : view === "licenses"
                            ? "License"
                            : view === "workstations"
                              ? "Workstation"
                              : "Service",
                        "Portal",
                        userRole === "GROUP_ADMIN" ? "Client group" : "Center",
                        view === "users" ? "Role" : "Details",
                        "Status",
                        "",
                      ]
                ).map((title, index) => (
                  <th key={index}>{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view === "clients"
                ? clientRows.slice((page - 1) * 25, page * 25).map((c) => (
                    <tr key={c.key}>
                      <td>
                        <strong>{c.name}</strong>
                        <small className="ops-cell-sub">
                          {c.centerId ? "On-prem client account" : c.code}
                        </small>
                      </td>
                      <td>{[...c.portals].map(portalName).join(", ")}</td>
                      <td>{c.centers}</td>
                      <td>{c.active}</td>
                      <td>
                        <Link
                          className="cc-row-action"
                          to={`/centers?client=${encodeURIComponent(c.code)}${portal ? `&portal=${portal}` : c.centerId ? "&portal=onprem" : ""}${c.centerId ? `&center=${encodeURIComponent(c.centerId)}` : ""}`}
                        >
                          View centers <Icon name="arrow" size={14} />
                        </Link>
                        <Link
                          className="cc-row-action"
                          to={`/reports?client=${encodeURIComponent(c.code)}${portal ? `&portal=${portal}` : c.centerId ? "&portal=onprem" : ""}${c.centerId ? `&center=${encodeURIComponent(c.centerId)}` : ""}`}
                        >
                          Analytics
                        </Link>
                      </td>
                    </tr>
                  ))
                : rows.map((row) => (
                    <tr key={`${row.portal}:${row.id}`}>
                      <td>
                        <button
                          className="ops-record-button"
                          onClick={() => setSelected(row)}
                        >
                          {row.name || row.id}
                        </button>
                        {clinical && (
                          <small className="ops-cell-sub">
                            {view === "processing"
                              ? "Service job"
                              : view === "studies"
                                ? "Study"
                                : "Report review"}
                          </small>
                        )}
                      </td>
                      {clinical ? (
                        <>
                          <td>
                            {portalName(row.portal)}
                            <small className="ops-cell-sub">
                              {row.centerName || "Unattributed center"}
                            </small>
                          </td>
                          <td>
                            {row.service || "—"}
                            <small className="ops-cell-sub">
                              {row.modality}
                            </small>
                          </td>
                          <td>
                            <span
                              className={`ops-status ${row.status?.toLowerCase()}`}
                            >
                              {labels[row.status || ""] || row.status}
                            </span>
                          </td>
                          <td>{stamp(row.createdAt)}</td>
                          <td>
                            {view === "processing"
                              ? row.durationMs == null
                                ? "Not measured"
                                : `${(row.durationMs / 1000).toFixed(1)} s`
                              : stamp(row.updatedAt)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{portalName(row.portal)}</td>
                          <td>
                            {(row.details?.clientKind === "GROUP" &&
                              String(
                                row.details.clientName || "Client group",
                              )) ||
                              row.centerName ||
                              (row.centerId
                                ? "Unattributed center"
                                : "Portal-wide")}
                          </td>
                          <td>
                            {view === "users"
                              ? String(row.details?.role || "—").replaceAll(
                                  "_",
                                  " ",
                                )
                              : kind === "subscription"
                                ? `${row.details?.usedCredits ?? 0} / ${row.details?.credits ?? "—"} credits`
                                : String(
                                    row.details?.code ||
                                      row.details?.edition ||
                                      "—",
                                  )}
                          </td>
                          <td>
                            <span
                              className={`ops-status ${row.enabled ? "success" : "inactive"}`}
                            >
                              {row.enabled ? "Active" : "Inactive"}
                            </span>
                          </td>
                        </>
                      )}
                      <td>
                        <button
                          onClick={() => setSelected(row)}
                          aria-label={`View ${row.name || row.id}`}
                        >
                          View <Icon name="chevron" size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!(view === "clients"
            ? clientRows.slice((page - 1) * 25, page * 25).length
            : rows.length) &&
            !error && (
              <div className="ops-empty">
                <Icon name={clinical ? "activity" : "centers"} size={28} />
                <strong>
                  {loaded
                    ? total
                      ? "No records on this page"
                      : "No matching records"
                    : "Loading worklist..."}
                </strong>
                <p>
                  {loaded
                    ? "Try another portal, status or date range. Disconnected sources do not contribute records."
                    : "Reading the central snapshot."}
                </p>
              </div>
            )}
        </div>
        <footer className="cc-pagination">
          <span>
            {total
              ? (page - 1) * 25 >= total
                ? `${total.toLocaleString("en-IN")} records · select an earlier page`
                : `${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} of ${total.toLocaleString("en-IN")}`
              : "0 records"}
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
              disabled={!loaded || page * 25 >= total}
              onClick={() => update({ page: String(page + 1) })}
            >
              Next
            </button>
          </div>
        </footer>
      </section>
      {selected && (
        <WorkspaceDrawer
          title={selected.name || metadata[view][0]}
          subtitle={`${portalName(selected.portal)} · Source record`}
          onClose={() => setSelected(null)}
        >
          <dl className="ops-details">
            {Object.entries({
              "Record ID": selected.id,
              Portal: portalName(selected.portal),
              Center: selected.centerName || "Unattributed / portal-wide",
              Status:
                selected.status || (selected.enabled ? "Active" : "Inactive"),
              Service: selected.service,
              Modality: selected.modality,
              "Created (IST)": selected.createdAt
                ? stamp(selected.createdAt)
                : undefined,
              "Updated (IST)": selected.updatedAt
                ? stamp(selected.updatedAt)
                : undefined,
              Credits: selected.credits,
              "Output format": selected.outputFormat,
              ...selected.details,
            })
              .filter(([, v]) => v != null)
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{detailLabel(key)}</dt>
                  <dd>{detailValue(key, value)}</dd>
                </div>
              ))}
          </dl>
          <div className="ops-detail-actions">
            <Link
              className="cc-button"
              to={`/reports?portal=${selected.portal}${selected.centerId ? `&center=${encodeURIComponent(selected.centerId)}` : ""}${selected.service ? `&service=${encodeURIComponent(selected.service)}` : ""}`}
            >
              View analytics <Icon name="chart" size={15} />
            </Link>
            {canControl &&
              action &&
              selected.details?.role !== "SUPER_ADMIN" && (
                <Link
                  className="cc-button primary"
                  to={`/operations?portal=${selected.portal}&action=${action}&target=${encodeURIComponent(selected.id)}`}
                >
                  Manage access <Icon name="controls" size={15} />
                </Link>
              )}
          </div>
          <p className="ops-note">
            Operational snapshot. Clinical viewing, reporting and job retries
            remain in the source portal.
          </p>
        </WorkspaceDrawer>
      )}
    </div>
  );
}
