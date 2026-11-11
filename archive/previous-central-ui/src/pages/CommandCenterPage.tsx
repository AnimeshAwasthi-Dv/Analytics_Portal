import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type User } from "../services/api";
import {
  WorkspaceIcon as Icon,
  type WorkspaceIconName,
} from "../Components/WorkspaceIcon";
import "./command-center.css";
import { WorkspaceDrawer as Drawer } from "../Components/WorkspaceDrawer";
import { WorkspaceLink as Link } from "../Components/WorkspaceScope";
import { scopedHref } from "../Components/workspaceNavigation";
import { portalPath, portalNames } from "../Components/portalNavigation";

export type CommandView =
  | "overview"
  | "reports"
  | "assistant"
  | "portals"
  | "centers"
  | "sources"
  | "controls"
  | "team"
  | "audit";
type Metric = {
  key: string;
  events: number;
  success: number;
  failed: number;
  pending: number;
  averageDurationMs: number | null;
  name?: string;
  portal?: string;
};
type Center = { id: string; name: string; clientCode: string; status: string };
type Portal = {
  code: string;
  name: string;
  clientCode: string;
  kind: string;
  configured: boolean;
  controlConfigured: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
  centers: Center[];
};
type Registry = { items: Portal[]; role: string; permissions: string[] };
type Analytics = {
  totals: Metric;
  byPortal: Metric[];
  byClient: Metric[];
  byService: Metric[];
  byCenter: Metric[];
  daily: Metric[];
  hourly: Metric[];
  peakHour: string | null;
  unattributedUserEvents: number;
  userActivity: { id: string; name: string; portal: string; events: number }[];
  usage: {
    entries: number;
    credits: number;
    byService: { service: string; credits: number; entries: number }[];
  };
  note: string;
};
type Member = {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
  owner: boolean;
};
type Command = {
  id: number;
  portal: string;
  action: string;
  target: string;
  enabled: boolean;
  reason: string;
  status: string;
  result: string | null;
  createdAt: string;
};
type Resource = {
  id: string;
  kind: string;
  name: string;
  centerId: string | null;
  enabled: boolean;
  details: Record<string, unknown>;
};
type Audit = {
  id: number;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
  details: Record<string, unknown>;
};
type Filters = {
  start: string;
  end: string;
  portal: string;
  client: string;
  center: string;
  service: string;
  modality: string;
};
type Answer = {
  status: "ready" | "clarification";
  message: string;
  filters: Filters | null;
  assumptions: string[];
  warnings: string[];
};
const roles: Record<string, { label: string; description: string }> = {
  super_admin: {
    label: "Super administrator",
    description: "Full organization access, team administration and controls",
  },
  operations: {
    label: "Operations",
    description: "Analytics, portal access controls and audit review",
  },
  analyst: {
    label: "Analyst",
    description: "Explore and analyze operational data",
  },
  support: {
    label: "Support",
    description: "Read analytics and investigate audited changes",
  },
  finance: {
    label: "Finance",
    description: "Read analytics and manage legacy license plans and keys",
  },
  viewer: {
    label: "Viewer",
    description: "Read operational dashboards and reports",
  },
};
const metadata: Record<
  CommandView,
  { title: string; description: string; eyebrow: string }
> = {
  overview: {
    title: "Dashboard",
    description:
      "A clear view of your entire operation, from portal activity to service demand.",
    eyebrow: "YOUR CENTRAL COMMAND",
  },
  reports: {
    title: "Analytics",
    description:
      "One report, any scope. Explore demand, service consumption and performance.",
    eyebrow: "ORGANIZATION INTELLIGENCE",
  },
  assistant: {
    title: "Ask your operations data",
    description:
      "Describe what you need. Get a focused analysis with the right filters applied.",
    eyebrow: "ANALYSIS ASSISTANT",
  },
  portals: {
    title: "Your portal network",
    description:
      "Every environment, its source status and the teams and centers it serves.",
    eyebrow: "CONNECTED OPERATIONS",
  },
  centers: {
    title: "Centers",
    description:
      "Find any center or on-prem account, then jump directly into its activity.",
    eyebrow: "ORGANIZATION DIRECTORY",
  },
  sources: {
    title: "Healthcheck",
    description:
      "Check which environments are connected, current and ready for control.",
    eyebrow: "DATA RELIABILITY",
  },
  controls: {
    title: "Access controls",
    description:
      "Manage access with clear intent. Every requested change is tracked and audited.",
    eyebrow: "OPERATIONAL CONTROL",
  },
  team: {
    title: "Your internal team",
    description: "The right access for every colleague, managed in one place.",
    eyebrow: "TEAM & ACCESS",
  },
  audit: {
    title: "Audit Logs",
    description:
      "Who changed what, when, and why. Review your operational decisions.",
    eyebrow: "GOVERNANCE",
  },
};
const familyOptions = [
  "X-Ray",
  "Special X-Ray",
  "CT",
  "MRI",
  "Mammography",
  "USG",
  "PET-CT",
];
const number = (value: number) => value.toLocaleString("en-IN");
const today = (offset = 0) =>
  new Date(Date.now() + 19800000 + offset * 86400000)
    .toISOString()
    .slice(0, 10);
const stamp = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not synced yet";
const duration = (value: number | null | undefined) =>
  value == null
    ? "—"
    : value < 1000
      ? `${Math.round(value)} ms`
      : value < 60000
        ? `${(value / 1000).toFixed(1)} s`
        : value < 3600000
          ? `${(value / 60000).toFixed(1)} min`
          : `${(value / 3600000).toFixed(1)} h`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Unable to complete the request.";
function sourceState(p: Portal) {
  return p.syncError
    ? { label: "Needs attention", tone: "danger" }
    : !p.configured
      ? { label: "Not connected", tone: "neutral" }
      : !p.lastSyncedAt
        ? { label: "Awaiting first sync", tone: "warning" }
        : Date.now() - Date.parse(p.lastSyncedAt) > 900000
          ? { label: "Sync overdue", tone: "warning" }
          : { label: "Data current", tone: "good" };
}
function useData<T>(
  endpoint: string | null,
  revision: number,
  parameters: Record<string, string | undefined> = {},
) {
  const paramKey = JSON.stringify(parameters);
  const key = `${endpoint}:${revision}:${paramKey}`;
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!endpoint) return;
    let active = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await api.commandGet<T>(endpoint, JSON.parse(paramKey));
        if (active) setResult({ key, data, error: "" });
      } catch (error) {
        if (active) setResult({ key, data: null, error: errorText(error) });
      } finally {
        pending = false;
      }
    };
    void load();
    const interval = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void load();
      },
      endpoint === "controls" || endpoint === "audit" ? 10000 : 60000,
    );
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [endpoint, key, paramKey]);
  return {
    data: result?.key === key ? result.data : null,
    error: result?.key === key ? result.error : "",
    loading: !!endpoint && result?.key !== key,
  };
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`cc-badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
function Empty({
  title,
  description,
  icon = "chart",
}: {
  title: string;
  description?: string;
  icon?: WorkspaceIconName;
}) {
  return (
    <div className="cc-empty">
      <span>
        <Icon name={icon} size={24} />
      </span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}
function Card({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`cc-card ${className}`}>
      <header className="cc-card-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = "blue",
}: {
  label: string;
  value: string;
  detail: string;
  icon: WorkspaceIconName;
  tone?: string;
}) {
  return (
    <article className={`cc-metric ${tone}`}>
      <div>
        <span>{label}</span>
        <i>
          <Icon name={icon} />
        </i>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function FilterBar({
  filters,
  update,
  registry,
  compact = false,
}: {
  filters: Filters;
  update: (patch: Partial<Filters>) => void;
  registry: Registry | null;
  compact?: boolean;
}) {
  const chosen = registry?.items.find((p) => p.code === filters.portal);
  const { portalCode: fixedPortal } = useParams();
  const clients = [
    ...new Set(
      registry?.items.flatMap((p) => [
        p.clientCode,
        ...p.centers.map((c) => c.clientCode),
      ]) ?? [],
    ),
  ].sort();
  return (
    <section className="cc-filters" aria-label="Report filters">
      <div className="cc-filter-heading">
        <span>
          <Icon name="filter" size={15} />{" "}
          {compact ? "Reporting period" : "Report scope"}
        </span>
        <div className="cc-periods">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              className={
                filters.start === today(1 - days) && filters.end === today()
                  ? "selected"
                  : ""
              }
              onClick={() => update({ start: today(1 - days), end: today() })}
            >
              Last {days} days
            </button>
          ))}
        </div>
      </div>
      <div className={`cc-filter-fields${compact ? " compact" : ""}`}>
        {!compact && (
          <>
            <label>
              Portal
              <select
                value={filters.portal}
                disabled={!!fixedPortal}
                onChange={(e) =>
                  update({ portal: e.target.value, center: "", client: "" })
                }
              >
                <option value="">All portals</option>
                {registry?.items.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Service group
              <select
                aria-label="Service group"
                value={filters.modality}
                onChange={(e) =>
                  update({ modality: e.target.value, service: "" })
                }
              >
                <option value="">All services</option>
                {familyOptions.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          From
          <input
            type="date"
            aria-label="Report start date"
            value={filters.start}
            max={filters.end}
            onChange={(e) => {
              if (e.target.value) update({ start: e.target.value });
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            aria-label="Report end date"
            value={filters.end}
            min={filters.start}
            onChange={(e) => {
              if (e.target.value) update({ end: e.target.value });
            }}
          />
        </label>
        <span className="cc-timezone">IST</span>
        {!compact && (
          <button
            className="cc-text-button"
            onClick={() =>
              update({
                start: today(-29),
                end: today(),
                portal: "",
                client: "",
                center: "",
                service: "",
                modality: "",
              })
            }
          >
            Reset filters
          </button>
        )}
      </div>
      {!compact && (
        <details
          className="cc-advanced-filters"
          open={!!(filters.client || filters.center)}
        >
          <summary>
            Client & center filters
            {(filters.client || filters.center) && (
              <Badge tone="blue">Applied</Badge>
            )}
          </summary>
          <div className="cc-filter-fields">
            <label>
              Client
              <select
                value={filters.client}
                onChange={(e) => update({ client: e.target.value })}
              >
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Center / account
              <select
                value={filters.center}
                disabled={!filters.portal}
                onChange={(e) => update({ center: e.target.value })}
              >
                <option value="">
                  {filters.portal
                    ? "All centers / accounts"
                    : "Select a portal first"}
                </option>
                {chosen?.centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
      )}
      {filters.service && (
        <div className="cc-filter-chip">
          Exact service: <strong>{filters.service}</strong>
          <button
            aria-label="Clear exact service"
            onClick={() => update({ service: "" })}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
    </section>
  );
}
function Charts({ data }: { data: Analytics }) {
  return (
    <div className="cc-chart-grid">
      <Card
        title="Service demand over time"
        description="Processing jobs received across the selected dates"
      >
        <div className="cc-chart">
          {data.daily.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart
                data={data.daily}
                margin={{ top: 12, right: 12, left: -12, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="cc-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#177f77" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#177f77" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 4"
                  vertical={false}
                  stroke="#e9edf2"
                />
                <XAxis
                  dataKey="key"
                  tickFormatter={(s) => s.slice(5)}
                  tick={{ fontSize: 11, fill: "#8795a7" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#8795a7" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip />
                <Area
                  isAnimationActive={false}
                  type="linear"
                  dataKey="events"
                  name="Service executions"
                  stroke="#17877e"
                  strokeWidth={2.3}
                  fill="url(#cc-area)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty
              title="No executions in this period"
              description="Try a wider date range or check source health."
            />
          )}
        </div>
      </Card>
      <Card
        title="Peak demand hours"
        description="Your busiest hours, in India Standard Time"
      >
        <div className="cc-chart">
          {data.hourly.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={data.hourly}
                margin={{ top: 12, right: 8, left: -22, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 4"
                  stroke="#e9edf2"
                />
                <XAxis
                  dataKey="key"
                  interval={3}
                  tickFormatter={(s) => `${Math.floor(Number(s))}:00`}
                  tick={{ fontSize: 10, fill: "#8795a7" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#8795a7" }}
                />
                <Tooltip />
                <Bar
                  isAnimationActive={false}
                  dataKey="events"
                  name="Service executions"
                  fill="#7898ba"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty
              title="Hourly demand will appear here"
              description="There is no recorded execution activity in this scope."
            />
          )}
        </div>
      </Card>
    </div>
  );
}
function Ranking({
  title,
  description,
  rows,
  onSelect,
}: {
  title: string;
  description: string;
  rows: Metric[];
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r.events));
  return (
    <Card title={title} description={description}>
      {rows.length ? (
        <div className="cc-ranking-list">
          {rows.slice(0, 8).map((r, index) => (
            <div className="cc-ranking" key={r.key}>
              <span className="cc-rank-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <div>
                  {onSelect ? (
                    <button onClick={() => onSelect(r.key)}>{r.key}</button>
                  ) : (
                    <span>{r.key}</span>
                  )}
                  <strong>{number(r.events)}</strong>
                </div>
                <i>
                  <b style={{ width: `${(r.events / max) * 100}%` }} />
                </i>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title="No ranked activity"
          description="Rankings appear when source activity is available."
        />
      )}
    </Card>
  );
}
function PortalCard({
  portal,
  events,
  showActivity = false,
}: {
  portal: Portal;
  events?: Metric;
  showActivity?: boolean;
}) {
  const status = sourceState(portal);
  return (
    <article className={`cc-portal-card portal-${portal.code}`}>
      <div className="cc-portal-card-top">
        <span className="cc-portal-monogram">
          {portal.code === "onprem" ? (
            <Icon name="key" size={22} />
          ) : (
            portal.name[0]
          )}
        </span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <h3>
        <Link to={portalPath(portal.code)}>{portal.name}</Link>
      </h3>
      <p>
        {portal.kind === "shared"
          ? "Shared PACS · Multiple clients"
          : portal.kind === "onprem"
            ? "On-prem · Licensing & workstations"
            : "Dedicated client environment"}
      </p>
      <div className="cc-portal-numbers">
        <div>
          <strong>
            {portal.lastSyncedAt ? number(portal.centers.length) : "—"}
          </strong>
          <small>
            {portal.kind === "onprem"
              ? "client accounts"
              : "registered centers"}
          </small>
        </div>
        <div>
          <strong>
            {showActivity
              ? events
                ? number(events.events)
                : portal.lastSyncedAt
                  ? "0"
                  : "—"
              : portal.controlConfigured
                ? "Ready"
                : "—"}
          </strong>
          <small>
            {showActivity ? "executions in period" : "source controls"}
          </small>
        </div>
      </div>
      <footer>
        <Link to={portalPath(portal.code)}>
          Open workspace <Icon name="arrow" size={15} />
        </Link>
        <Link
          to={`/reports?portal=${portal.code}`}
          title={`Analyze ${portal.name}`}
          aria-label={`Analyze ${portal.name}`}
        >
          <Icon name="chart" size={17} />
        </Link>
      </footer>
    </article>
  );
}
function PortalDetails({
  portal,
  onClose,
  canControl,
}: {
  portal: Portal;
  onClose: () => void;
  canControl: boolean;
}) {
  const resource = useData<{ items: Resource[] }>(
    `portals/${portal.code}/resources`,
    0,
  );
  const state = sourceState(portal);
  return (
    <Drawer title={portal.name} subtitle="Portal workspace" onClose={onClose}>
      <div className="cc-detail-hero">
        <span className="cc-portal-monogram">{portal.name[0]}</span>
        <div>
          <Badge tone={state.tone}>{state.label}</Badge>
          <p>
            {portal.kind === "shared"
              ? "Multiple clients on shared infrastructure"
              : portal.kind === "onprem"
                ? "Desktop licensing and workstation access"
                : "Dedicated client portal"}
          </p>
        </div>
      </div>
      <dl className="cc-detail-list">
        <div>
          <dt>Last successful sync</dt>
          <dd>{stamp(portal.lastSyncedAt)}</dd>
        </div>
        <div>
          <dt>Analytics connection</dt>
          <dd>{portal.configured ? "Configured" : "Connection required"}</dd>
        </div>
        <div>
          <dt>Source controls</dt>
          <dd>{portal.controlConfigured ? "Available" : "Not configured"}</dd>
        </div>
        <div>
          <dt>Registered centers / accounts</dt>
          <dd>{portal.centers.length}</dd>
        </div>
      </dl>
      {portal.syncError && (
        <div className="cc-alert danger">{portal.syncError}</div>
      )}
      <div className="cc-detail-actions">
        <Link
          className="cc-button primary"
          to={`/reports?portal=${portal.code}`}
        >
          <Icon name="chart" size={16} />
          Analyze this portal
        </Link>
        {canControl && (
          <Link className="cc-button" to={`/operations?portal=${portal.code}`}>
            Manage access
          </Link>
        )}
        {portal.code === "marengo" && (
          <Link className="cc-button" to="/marengo-analytics">
            Study & review details
          </Link>
        )}
      </div>
      {resource.loading ? (
        <div className="cc-loading">Loading portal inventory...</div>
      ) : resource.error ? (
        <div className="cc-alert danger">{resource.error}</div>
      ) : (
        <>
          <h3 className="cc-section-title">Source inventory</h3>
          {[...new Set(resource.data?.items.map((r) => r.kind) ?? [])].map(
            (kind) => (
              <details className="cc-inventory" key={kind}>
                <summary>
                  {kind[0].toUpperCase() + kind.slice(1)}s{" "}
                  <Badge>
                    {resource.data?.items.filter((r) => r.kind === kind).length}
                  </Badge>
                </summary>
                {resource.data?.items
                  .filter((r) => r.kind === kind)
                  .map((r) => (
                    <div key={r.id}>
                      <div>
                        <strong>{r.name}</strong>
                        <small>
                          {portal.centers.find((c) => c.id === r.centerId)
                            ?.name || "Portal-wide"}
                        </small>
                      </div>
                      <Badge tone={r.enabled ? "good" : "neutral"}>
                        {r.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      {(r.details.credits !== undefined ||
                        r.details.expiresAt !== undefined) && (
                        <p>
                          {r.details.credits !== undefined
                            ? `${r.details.credits} credits`
                            : ""}
                          {r.details.expiresAt
                            ? ` · Expires ${stamp(String(r.details.expiresAt))}`
                            : ""}
                        </p>
                      )}
                    </div>
                  ))}
              </details>
            ),
          )}
          {!resource.data?.items.length && (
            <Empty
              title="No inventory synced yet"
              description="Connect the source and complete its first sync."
              icon="portals"
            />
          )}
        </>
      )}
      <details className="cc-inventory">
        <summary>
          Centers & accounts <Badge>{portal.centers.length}</Badge>
        </summary>
        {portal.centers.map((c) => (
          <Link
            className="cc-center-link"
            key={c.id}
            to={`/reports?portal=${portal.code}&center=${encodeURIComponent(c.id)}`}
          >
            <span>{c.name}</span>
            <Icon name="arrow" size={14} />
          </Link>
        ))}
      </details>
    </Drawer>
  );
}

export function CommandCenterPage({
  view = "overview",
  heading,
}: {
  view?: CommandView;
  heading?: string;
}) {
  const { user } = useOutletContext<{ user: User }>();
  const navigate = useNavigate();
  const { portalCode } = useParams();
  const [search, setSearch] = useSearchParams();
  const filters: Filters = {
    start: search.get("start") || today(-29),
    end: search.get("end") || today(),
    portal: portalCode || search.get("portal") || "",
    client: search.get("client") || "",
    center: search.get("center") || "",
    service: search.get("service") || "",
    modality: search.get("modality") || "",
  };
  const update = useCallback(
    (patch: Partial<Filters>) =>
      setSearch(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      ),
    [setSearch],
  );
  const requestKey = useRef(crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  const registry = useData<Registry>("portals", revision);
  const analytics = useData<Analytics>(
    ["overview", "reports", "assistant"].includes(view) ? "analytics" : null,
    revision,
    Object.fromEntries(
      Object.entries(filters).map(([k, v]) => [k, v || undefined]),
    ),
  );
  const [auditPage, setAuditPage] = useState(1);
  const team = useData<{ items: Member[] }>(
    view === "team" ? "team" : null,
    revision,
  );
  const controls = useData<{ items: Command[] }>(
    view === "controls" ? "controls" : null,
    revision,
  );
  const audits = useData<{ items: Audit[] }>(
    view === "audit" ? "audit" : null,
    revision,
    { page: String(auditPage) },
  );
  const [dialog, setDialog] = useState<"member" | "control" | null>(
    view === "controls" && search.get("action") && search.get("target")
      ? "control"
      : null,
  );
  const [selectedAudit, setSelectedAudit] = useState<Audit | null>(null);
  const [notice, setNotice] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [directoryPage, setDirectoryPage] = useState(1);
  const [centerDetails, setCenterDetails] = useState<{
    portal: string;
    id: string;
  } | null>(null);
  const [member, setMember] = useState({
    name: "",
    email: "",
    password: "",
    role: "viewer",
  });
  const [controlPortal, setControlPortal] = useState(
    portalCode || search.get("portal") || "",
  );
  const [action, setAction] = useState(
    [
      "center_access",
      "service_access",
      "user_access",
      "subscription_access",
      "license_access",
      "workstation_access",
    ].includes(search.get("action") || "")
      ? search.get("action")!
      : controlPortal === "onprem"
        ? "license_access"
        : "center_access",
  );
  const [target, setTarget] = useState(search.get("target") || "");
  const [enabled, setEnabled] = useState(true);
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const resources = useData<{ items: Resource[] }>(
    dialog === "control" && controlPortal
      ? `portals/${controlPortal}/resources`
      : null,
    revision,
  );
  const [question, setQuestion] = useState(search.get("question") || "");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const processed = useRef("");
  const data = analytics.data;
  const portals = registry.data?.items ?? [];
  const visiblePortals = portals.filter(
    (p) => !filters.portal || p.code === filters.portal,
  );
  const can = (permission: string) =>
    user.permissions?.includes(permission) ?? false;
  const allCenters = portals.flatMap((p) =>
    p.centers.map((c) => ({
      ...c,
      portal: p.code,
      portalName: p.name,
      kind: p.kind,
    })),
  );
  const centerRows = allCenters.filter(
    (c) =>
      (!filters.portal || c.portal === filters.portal) &&
      (!filters.client || c.clientCode === filters.client) &&
      (!filters.center || c.id === filters.center) &&
      `${c.name} ${c.clientCode} ${c.portalName}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const currentPortal = portals.find((p) => p.code === controlPortal);
  const directoryCenter = allCenters.find(
    (c) => c.id === centerDetails?.id && c.portal === centerDetails.portal,
  );
  const selectedCenter = currentPortal?.centers.find((c) => c.id === target);
  const selectedResource = resources.data?.items.find(
    (r) => r.id === target && r.kind === action.replace("_access", ""),
  );
  const answerAligned =
    answer?.status === "ready" &&
    !!answer.filters &&
    Object.entries(answer.filters).every(
      ([key, value]) => filters[key as keyof Filters] === value,
    );
  const reportUrl = `/reports?${new URLSearchParams(Object.entries(filters).filter(([, v]) => !!v)).toString()}`;
  const unavailable = visiblePortals.filter(
    (p) => sourceState(p).tone !== "good",
  );
  const pageMeta = metadata[view];
  const error =
    registry.error ||
    analytics.error ||
    team.error ||
    controls.error ||
    audits.error;

  async function mutate(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    setMutationError("");
    try {
      await work();
      setNotice(message);
      setRevision((v) => v + 1);
      return true;
    } catch (e) {
      setMutationError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const ask = useCallback(
    async (prompt = question) => {
      if (!prompt.trim()) return;
      setQuestion(prompt);
      setAssistantBusy(true);
      setAssistantError("");
      try {
        const result = await api.commandPost<Answer>("assistant/interpret", {
          prompt,
        });
        if (portalCode && result.status === "ready" && result.filters) {
          const otherPortal =
            result.filters.portal && result.filters.portal !== portalCode;
          const otherClient =
            ["marengo", "goyal"].includes(portalCode) &&
            result.filters.client &&
            result.filters.client !== portalCode;
          if (otherPortal || otherClient) {
            setAnswer({
              ...result,
              status: "clarification",
              filters: null,
              message: `This request targets a different workspace. Choose that portal or use the organization Analysis assistant. You are currently in ${portalNames[portalCode]}.`,
            });
            return;
          }
          result.filters.portal = portalCode;
        }
        setAnswer(result);
        if (result.status === "ready" && result.filters) {
          update(result.filters);
          setRevision((v) => v + 1);
        }
      } catch (e) {
        setAssistantError(errorText(e));
      } finally {
        setAssistantBusy(false);
      }
    },
    [question, update, portalCode],
  );
  const incomingQuestion = search.get("question") || "";
  useEffect(() => {
    if (
      view === "assistant" &&
      incomingQuestion &&
      processed.current !== incomingQuestion
    ) {
      processed.current = incomingQuestion;
      void ask(incomingQuestion);
    }
  }, [incomingQuestion, view, ask]);
  function exportSummary() {
    if (!data) return;
    const rows: unknown[][] = [
      [
        "Section",
        "Name",
        "Executions",
        "Successful",
        "Failed",
        "Pending",
        "Metered entries",
        "Credits",
      ],
    ];
    for (const [section, items] of [
      ["Portal", data.byPortal],
      ["Center", data.byCenter],
      ["Service", data.byService],
      ["Daily", data.daily],
    ] as const) {
      for (const r of items)
        rows.push([
          section,
          r.name || r.key,
          r.events,
          r.success,
          r.failed,
          r.pending,
          "",
          "",
        ]);
    }
    for (const r of data.usage.byService)
      rows.push([
        "Metered service",
        r.service,
        "",
        "",
        "",
        "",
        r.entries,
        r.credits,
      ]);
    const csv = rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? "");
            if (/^[=+@-]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `dectrocel-summary-${filters.start}-${filters.end}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className={`cc-page cc-${view}`}>
      <header className="cc-page-heading">
        <div>
          <div className="cc-eyebrow">{pageMeta.eyebrow}</div>
          <h1>{heading || pageMeta.title}</h1>
          <p>{pageMeta.description}</p>
        </div>
        <div className="cc-page-actions">
          {view === "reports" && (
            <button disabled={!data} onClick={exportSummary}>
              <Icon name="download" size={16} />
              Summary CSV
            </button>
          )}
          {view === "controls" && (
            <button
              className="primary"
              onClick={() => {
                requestKey.current = crypto.randomUUID();
                setDialog("control");
                setReviewing(false);
                setMutationError("");
              }}
            >
              <Icon name="plus" size={16} />
              New change
            </button>
          )}
          {view === "team" && (
            <button
              className="primary"
              onClick={() => {
                setDialog("member");
                setMutationError("");
              }}
            >
              <Icon name="plus" size={16} />
              Add team member
            </button>
          )}
          <button
            className="cc-icon-button"
            onClick={() => setRevision((v) => v + 1)}
            aria-label="Refresh current page"
            title="Refresh current page"
          >
            <Icon name="refresh" size={17} />
          </button>
        </div>
      </header>
      {(error || mutationError) && (
        <div className="cc-alert danger" role="alert">
          <Icon name="alert" />
          {error || mutationError}
          <button
            onClick={() => {
              setMutationError("");
              setRevision((v) => v + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {notice && (
        <div className="cc-alert success" role="status">
          <Icon name="check" />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}

      {view === "overview" && (
        <>
          {portalCode && (
            <div className="pacs-portal-summary">
              <span>
                <Icon name="portals" size={17} />
                <strong>{portalNames[portalCode]}</strong>
              </span>
              <span>
                {visiblePortals[0]?.centers.length ?? 0} centers / accounts
              </span>
              <span>Source snapshot · IST</span>
            </div>
          )}
          <div className="cc-section-heading">
            <div>
              <h2>Operational pulse</h2>
              <p>
                All synced sources · Processing activity and metered consumption
              </p>
            </div>
            <Link to="/reports">
              View full report <Icon name="arrow" size={14} />
            </Link>
          </div>
          <FilterBar
            compact
            filters={filters}
            update={update}
            registry={registry.data}
          />
          {analytics.loading ? (
            <div className="cc-loading">
              Loading your organization metrics...
            </div>
          ) : (
            data && (
              <>
                <div className="cc-metrics">
                  <MetricCard
                    label="Service executions"
                    value={number(data.totals.events)}
                    detail={`${number(data.totals.pending)} currently queued / processing`}
                    icon="activity"
                  />
                  <MetricCard
                    label="Successful completions"
                    value={
                      data.totals.success + data.totals.failed
                        ? `${((data.totals.success / (data.totals.success + data.totals.failed)) * 100).toFixed(1)}%`
                        : "—"
                    }
                    detail={`${number(data.totals.failed)} recorded failures`}
                    icon="check"
                    tone="green"
                  />
                  <MetricCard
                    label="Average turnaround"
                    value={duration(data.totals.averageDurationMs)}
                    detail="Created to completed, for measured jobs"
                    icon="chart"
                    tone="violet"
                  />
                  <MetricCard
                    label="Credits consumed"
                    value={number(data.usage.credits)}
                    detail={`${number(data.usage.entries)} metered usage records`}
                    icon="plans"
                    tone="amber"
                  />
                </div>
              </>
            )
          )}
          {!portalCode && (
            <section className="pacs-portal-directory">
              <header>
                <div>
                  <h2>Portals</h2>
                  <p>
                    Select a portal name to open its complete workspace and
                    tabs.
                  </p>
                </div>
                <span>{visiblePortals.length} portals</span>
              </header>
              <div className="cc-table-scroll">
                <table className="pacs-data-table">
                  <thead>
                    <tr>
                      <th>Portal</th>
                      <th>Type</th>
                      <th>Centers / accounts</th>
                      <th>Service executions</th>
                      <th>Failed</th>
                      <th>Data status</th>
                      <th>Last sync · IST</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePortals.map((p) => {
                      const metric = data?.byPortal.find(
                        (r) => r.key === p.code,
                      );
                      const state = sourceState(p);
                      return (
                        <tr key={p.code}>
                          <td>
                            <Link
                              className="pacs-portal-name"
                              to={portalPath(p.code)}
                            >
                              <Icon
                                name={p.code === "onprem" ? "key" : "portals"}
                                size={18}
                              />
                              <strong>{p.name}</strong>
                            </Link>
                          </td>
                          <td>
                            {p.kind === "shared"
                              ? "Shared PACS"
                              : p.kind === "onprem"
                                ? "On-prem"
                                : "Dedicated"}
                          </td>
                          <td>{p.lastSyncedAt ? p.centers.length : "—"}</td>
                          <td>
                            {analytics.loading
                              ? "Loading…"
                              : !data
                                ? "Unavailable"
                                : metric
                                  ? number(metric.events)
                                  : p.lastSyncedAt
                                    ? "0"
                                    : "—"}
                          </td>
                          <td>
                            {analytics.loading
                              ? "Loading…"
                              : !data
                                ? "Unavailable"
                                : metric
                                  ? number(metric.failed)
                                  : p.lastSyncedAt
                                    ? "0"
                                    : "—"}
                          </td>
                          <td>
                            <Badge tone={state.tone}>{state.label}</Badge>
                          </td>
                          <td>{stamp(p.lastSyncedAt)}</td>
                          <td>
                            <Link className="cc-button" to={portalPath(p.code)}>
                              Open portal <Icon name="arrow" size={14} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {portalCode && (
            <section className="pacs-dashboard-shortcuts">
              <Link
                to={portalPath(
                  portalCode,
                  portalCode === "onprem" ? "clients" : "centers",
                )}
              >
                {portalCode === "onprem" ? "Client directory" : "Centers"}{" "}
                <Icon name="arrow" size={14} />
              </Link>
              <Link to={portalPath(portalCode, "processing")}>
                Processing <Icon name="arrow" size={14} />
              </Link>
              <Link
                to={portalPath(
                  portalCode,
                  portalCode === "onprem" ? "licenses" : "reports",
                )}
              >
                {portalCode === "onprem" ? "License management" : "Reports"}
                <Icon name="arrow" size={14} />
              </Link>
              <Link to={portalPath(portalCode, "analytics")}>
                Analytics <Icon name="arrow" size={14} />
              </Link>
            </section>
          )}
          {data && <Charts data={data} />}
          {unavailable.length > 0 && (
            <Card
              title="Needs your attention"
              description="Source readiness affects how complete your organization totals are"
              action={
                <Link to="/sources">
                  Source health <Icon name="arrow" size={14} />
                </Link>
              }
            >
              <div className="cc-attention-list">
                {unavailable.map((p) => (
                  <Link key={p.code} to={`/portals/${p.code}`}>
                    <span className="cc-attention-icon">
                      <Icon
                        name={p.configured ? "sync" : "portals"}
                        size={17}
                      />
                    </span>
                    <div>
                      <strong>{p.name}</strong>
                      <small>
                        {p.syncError ||
                          (!p.configured
                            ? "Add source database access to include this portal in your analytics."
                            : "Check the sync worker and last successful source update.")}
                      </small>
                    </div>
                    <Badge tone={sourceState(p).tone}>
                      {sourceState(p).label}
                    </Badge>
                    <Icon name="chevron" size={15} />
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {view === "assistant" && (
        <>
          <section className="cc-assistant">
            <span className="cc-assistant-symbol">
              <Icon name="assistant" size={28} />
            </span>
            <h2>What would you like to know?</h2>
            <p>
              Ask about a portal, a service or a center. We’ll align your
              report.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <label className="cc-visually-hidden" htmlFor="analysis-request">
                Analysis request
              </label>
              <input
                id="analysis-request"
                required
                minLength={5}
                maxLength={1000}
                disabled={assistantBusy}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Show Marengo X-ray usage for the last 7 days"
              />
              <button className="primary" disabled={assistantBusy}>
                {assistantBusy ? "Preparing analysis..." : "Show analysis"}
                <Icon name="arrow" size={16} />
              </button>
            </form>
            <div className="cc-suggestions">
              {[
                "X-ray usage of Marengo for the last 7 days",
                "CT usage across all portals this month",
                "Goyal usage for the last 30 days",
              ].map((prompt) => (
                <button
                  disabled={assistantBusy}
                  key={prompt}
                  onClick={() => void ask(prompt)}
                >
                  <Icon name="chart" size={13} />
                  {prompt}
                </button>
              ))}
            </div>
            <small>
              Supported-language interpreter · Read-only analysis · No external
              AI model connected
            </small>
          </section>
          {assistantError && (
            <div className="cc-alert danger" role="alert">
              {assistantError}
            </div>
          )}
          {answer && (
            <section className="cc-assistant-answer" role="status">
              <div>
                <Icon name={answer.status === "ready" ? "check" : "alert"} />
                <h2>{answer.message}</h2>
              </div>
              {answer.status === "clarification" ? (
                <p>Your dashboard filters have not changed.</p>
              ) : (
                <>
                  <p>
                    {answerAligned
                      ? "Your report filters are applied below."
                      : "You have adjusted the filters. Results reflect your current scope."}
                  </p>
                  {answer.assumptions.map((a) => (
                    <p key={a}>{a}</p>
                  ))}
                  <div className="cc-answer-chips">
                    {filters.portal && (
                      <Badge tone="blue">
                        {portals.find((p) => p.code === filters.portal)?.name ||
                          filters.portal}
                      </Badge>
                    )}
                    {filters.client && (
                      <Badge tone="blue">Client: {filters.client}</Badge>
                    )}
                    {filters.modality && (
                      <Badge tone="blue">{filters.modality}</Badge>
                    )}
                    <Badge>
                      {filters.start} → {filters.end} · IST
                    </Badge>
                  </div>
                  <Link className="cc-button" to={reportUrl}>
                    Open full report
                    <Icon name="arrow" size={15} />
                  </Link>
                </>
              )}
              {answer.warnings.map((w) => (
                <p className="cc-assistant-note" key={w}>
                  {w}
                </p>
              ))}
            </section>
          )}
          {answer?.status === "ready" &&
            (analytics.loading ? (
              <div className="cc-loading">
                Preparing your filtered report...
              </div>
            ) : (
              data && (
                <>
                  <div className="cc-metrics cc-assistant-result">
                    <MetricCard
                      label="Service executions"
                      value={number(data.totals.events)}
                      detail="Unique processing jobs"
                      icon="activity"
                    />
                    <MetricCard
                      label="Credits consumed"
                      value={number(data.usage.credits)}
                      detail={`${number(data.usage.entries)} metered usage records`}
                      icon="plans"
                      tone="green"
                    />
                    <MetricCard
                      label="Average turnaround"
                      value={duration(data.totals.averageDurationMs)}
                      detail="Measured job completion time"
                      icon="chart"
                      tone="violet"
                    />
                  </div>
                  <Charts data={data} />
                </>
              )
            ))}
        </>
      )}

      {view === "reports" && (
        <>
          <FilterBar
            filters={filters}
            update={update}
            registry={registry.data}
          />
          {analytics.loading ? (
            <div className="cc-loading">Loading your filtered report...</div>
          ) : (
            data && (
              <>
                <div className="cc-report-scope">
                  <span>
                    <i />{" "}
                    {portals.find((p) => p.code === filters.portal)?.name ||
                      filters.client ||
                      "All synced portals"}
                    {filters.modality
                      ? ` / ${filters.modality}`
                      : " / All services"}
                  </span>
                  <small>
                    {filters.start} — {filters.end} · IST
                  </small>
                </div>
                <div className="cc-metrics">
                  <MetricCard
                    label="Service executions"
                    value={number(data.totals.events)}
                    detail={`${number(data.totals.success)} successful · ${number(data.totals.failed)} failed`}
                    icon="activity"
                  />
                  <MetricCard
                    label="Credits consumed"
                    value={number(data.usage.credits)}
                    detail={`${number(data.usage.entries)} metered usage records`}
                    icon="plans"
                    tone="green"
                  />
                  <MetricCard
                    label="Average turnaround"
                    value={duration(data.totals.averageDurationMs)}
                    detail="Created to completed for measured jobs"
                    icon="chart"
                    tone="violet"
                  />
                  <MetricCard
                    label="Peak demand hour"
                    value={
                      data.peakHour != null
                        ? `${String(Math.floor(Number(data.peakHour))).padStart(2, "0")}:00`
                        : "—"
                    }
                    detail="Busiest hour across selected dates · IST"
                    icon="activity"
                    tone="amber"
                  />
                </div>
                <Charts data={data} />
                <div className="cc-two-grid">
                  <Ranking
                    title="Most used services"
                    description="Select a service to narrow your report"
                    rows={data.byService}
                    onSelect={(service) => update({ service })}
                  />
                  <Ranking
                    title="Client activity"
                    description="Goyal combines only explicitly mapped PACS centers"
                    rows={data.byClient}
                  />
                </div>
                <Card
                  title="Portal performance"
                  description="Compare each environment within the current report"
                >
                  <div className="cc-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Portal</th>
                          <th>Executions</th>
                          <th>Successful</th>
                          <th>Failed</th>
                          <th>In progress</th>
                          <th>Avg. turnaround</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byPortal.map((r) => (
                          <tr key={r.key}>
                            <td>
                              <Link to={`/portals/${r.key}`}>
                                <strong>
                                  {portals.find((p) => p.code === r.key)
                                    ?.name || r.key}
                                </strong>
                              </Link>
                            </td>
                            <td>{number(r.events)}</td>
                            <td>{number(r.success)}</td>
                            <td>{number(r.failed)}</td>
                            <td>{number(r.pending)}</td>
                            <td>{duration(r.averageDurationMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.byPortal.length && (
                      <Empty title="No portal activity in this scope" />
                    )}
                  </div>
                </Card>
                <Card
                  title="Center performance"
                  description="Top 20 centers by processing volume"
                >
                  <div className="cc-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Center</th>
                          <th>Portal</th>
                          <th>Executions</th>
                          <th>Successful</th>
                          <th>Failed</th>
                          <th>Avg. turnaround</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byCenter.map((r) => (
                          <tr key={`${r.portal}:${r.key}`}>
                            <td>
                              <strong>{r.name}</strong>
                            </td>
                            <td>
                              {portals.find((p) => p.code === r.portal)?.name ||
                                r.portal}
                            </td>
                            <td>{number(r.events)}</td>
                            <td>{number(r.success)}</td>
                            <td>{number(r.failed)}</td>
                            <td>{duration(r.averageDurationMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.byCenter.length && (
                      <Empty title="No center activity in this scope" />
                    )}
                  </div>
                </Card>
                <div className="cc-two-grid">
                  <Card
                    title="Most active users"
                    description="Attributed audit activity, separate from job counts"
                  >
                    {data.userActivity.length ? (
                      <div className="cc-user-list">
                        {data.userActivity.map((u) => (
                          <div key={`${u.portal}:${u.id}`}>
                            <span className="cc-user-avatar">{u.name[0]}</span>
                            <div>
                              <strong>{u.name}</strong>
                              <small>{u.portal}</small>
                            </div>
                            <b>
                              {number(u.events)}
                              <small>actions</small>
                            </b>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="No attributed user activity"
                        description={
                          filters.modality || filters.service
                            ? "Audit actions cannot be attributed to a specific service."
                            : "This source scope has no attributed audit events."
                        }
                        icon="team"
                      />
                    )}
                  </Card>
                  <Card
                    title="Metered consumption"
                    description="Source billing records and shared-license debit records"
                  >
                    {data.usage.byService.length ? (
                      <div className="cc-consumption">
                        {data.usage.byService.map((r) => (
                          <div key={r.service}>
                            <strong>
                              {r.service}
                              <small>{number(r.entries)} metered records</small>
                            </strong>
                            <span>
                              {number(r.credits)}
                              <small>credits</small>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="No metered usage in this scope"
                        description="An execution and a billing entry are different records."
                        icon="plans"
                      />
                    )}
                  </Card>
                </div>
                <details className="cc-definitions">
                  <summary>
                    How to read this report
                    <Icon name="chevron" size={14} />
                  </summary>
                  <p>{data.note}</p>
                  <p>
                    Duration includes queuing and excludes missing or invalid
                    completion timestamps. Cross-portal study deduplication
                    requires a shared study identity.
                  </p>
                  <p>
                    Offline AI consumption is available only when the
                    workstation reports it. Shared on-prem credit debits cannot
                    be attributed to an individual AI service from the supplied
                    records.
                  </p>
                </details>
              </>
            )
          )}
        </>
      )}

      {view === "portals" && (
        <>
          <div className="cc-summary-strip">
            <div>
              <strong>{visiblePortals.length}</strong>
              <span>Portal environments</span>
            </div>
            <div>
              <strong>
                {visiblePortals.filter((p) => p.configured).length}
              </strong>
              <span>Analytics connected</span>
            </div>
            <div>
              <strong>
                {visiblePortals.filter((p) => p.controlConfigured).length}
              </strong>
              <span>Control connections</span>
            </div>
            <div>
              <strong>
                {number(
                  allCenters.filter(
                    (c) => !filters.portal || c.portal === filters.portal,
                  ).length,
                )}
              </strong>
              <span>Centers & accounts</span>
            </div>
          </div>
          <div className="cc-portal-grid directory">
            {visiblePortals.map((p) => (
              <PortalCard key={p.code} portal={p} />
            ))}
          </div>
          <div className="cc-explainer">
            <Icon name="centers" />
            <div>
              <strong>One client, across multiple portals.</strong>
              <p>
                Shared PACS centers remain separate clients. Explicitly mapped
                Goyal centers roll up into its combined client report.
              </p>
              <Link to="/centers">
                Explore centers & clients <Icon name="arrow" size={14} />
              </Link>
            </div>
          </div>
          {portalCode &&
            !registry.loading &&
            !portals.some((p) => p.code === portalCode) && (
              <div className="cc-alert danger" role="alert">
                This portal is not registered in your organization.
                <Link to="/portals">Return to portal directory</Link>
              </div>
            )}
          {portalCode && portals.find((p) => p.code === portalCode) && (
            <PortalDetails
              key={portalCode}
              portal={portals.find((p) => p.code === portalCode)!}
              canControl={can("portals:control")}
              onClose={() =>
                navigate(scopedHref("/portals", search.toString()))
              }
            />
          )}
        </>
      )}

      {view === "centers" && (
        <>
          <div className="cc-directory-toolbar">
            <label className="cc-search-field">
              <Icon name="search" size={17} />
              <input
                aria-label="Search centers and clients"
                placeholder="Search a center, client or portal..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDirectoryPage(1);
                }}
              />
            </label>
            <select
              aria-label="Directory portal"
              value={filters.portal}
              onChange={(e) => {
                update({ portal: e.target.value, client: "", center: "" });
                setDirectoryPage(1);
              }}
            >
              <option value="">All portals</option>
              {portals.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
            <span>{number(centerRows.length)} centers & accounts</span>
            {(filters.client || filters.center) && (
              <button onClick={() => update({ client: "", center: "" })}>
                Clear client / center
              </button>
            )}
          </div>
          <Card
            title="Centers"
            description="Dedicated centers and on-prem client accounts"
          >
            <div className="cc-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Portal</th>
                    <th>Client</th>
                    <th>Type</th>
                    <th>Source status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {centerRows
                    .slice((directoryPage - 1) * 20, directoryPage * 20)
                    .map((c) => (
                      <tr key={`${c.portal}:${c.id}`}>
                        <td>
                          <span className="cc-name-with-icon">
                            <i>
                              <Icon
                                name={c.kind === "onprem" ? "key" : "centers"}
                                size={16}
                              />
                            </i>
                            <button
                              className="cc-text-button"
                              onClick={() =>
                                setCenterDetails({ portal: c.portal, id: c.id })
                              }
                            >
                              {c.name}
                            </button>
                          </span>
                        </td>
                        <td>{c.portalName}</td>
                        <td>{c.clientCode}</td>
                        <td>
                          {c.kind === "onprem" ? "On-prem account" : "Center"}
                        </td>
                        <td>
                          <Badge
                            tone={c.status === "ACTIVE" ? "good" : "neutral"}
                          >
                            {c.status === "ACTIVE"
                              ? "Active"
                              : c.status || "Unknown"}
                          </Badge>
                        </td>
                        <td>
                          <Link
                            className="cc-row-action"
                            to={`/reports?portal=${c.portal}&center=${encodeURIComponent(c.id)}`}
                          >
                            Analyze <Icon name="arrow" size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!centerRows.length && (
                <Empty
                  title={
                    registry.loading
                      ? "Loading organization directory..."
                      : "No matching centers"
                  }
                  description="Try a different search or select another portal."
                  icon="centers"
                />
              )}
            </div>
            <footer className="cc-pagination">
              <span>
                {centerRows.length
                  ? `${(directoryPage - 1) * 20 + 1}–${Math.min(directoryPage * 20, centerRows.length)} of ${number(centerRows.length)}`
                  : "0 results"}
              </span>
              <div>
                <button
                  disabled={directoryPage <= 1}
                  onClick={() => setDirectoryPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span>Page {directoryPage}</span>
                <button
                  disabled={directoryPage * 20 >= centerRows.length}
                  onClick={() => setDirectoryPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          </Card>
        </>
      )}

      {view === "sources" && (
        <>
          <div className="cc-summary-strip">
            <div>
              <strong>
                {
                  visiblePortals.filter((p) => sourceState(p).tone === "good")
                    .length
                }
                /{visiblePortals.length}
              </strong>
              <span>Sources with current data</span>
            </div>
            <div>
              <strong>{unavailable.length}</strong>
              <span>Sources to review</span>
            </div>
            <div>
              <strong>60s</strong>
              <span>Configured sync interval</span>
            </div>
          </div>
          <Card
            title="Source readiness"
            description="Connection configuration and data freshness are different signals"
          >
            <div className="cc-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Data status</th>
                    <th>Analytics connection</th>
                    <th>Control connection</th>
                    <th>Last successful sync · IST</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visiblePortals.map((p) => (
                    <tr key={p.code}>
                      <td>
                        <strong>{p.name}</strong>
                        <small>
                          {p.kind === "onprem"
                            ? "Desktop / on-prem"
                            : "Portal database"}
                        </small>
                      </td>
                      <td>
                        <Badge tone={sourceState(p).tone}>
                          {sourceState(p).label}
                        </Badge>
                      </td>
                      <td>{p.configured ? "Configured" : "Required"}</td>
                      <td>
                        {p.controlConfigured ? "Configured" : "Unavailable"}
                      </td>
                      <td>{stamp(p.lastSyncedAt)}</td>
                      <td>
                        <Link
                          to={`/portals/${p.code}`}
                          className="cc-row-action"
                        >
                          Details <Icon name="arrow" size={14} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="cc-explainer">
            <Icon name="sync" />
            <div>
              <strong>Reliable data starts with a healthy source.</strong>
              <p>
                Current means a successful sync within the last 15 minutes. It
                does not measure portal uptime. A configured connection can
                still need its first successful sync.
              </p>
              <p>
                Database credentials are managed in server settings. Open a
                portal workspace to inspect its latest sync error and available
                inventory.
              </p>
            </div>
          </div>
          <div className="cc-detail-actions">
            <Link className="cc-button" to="/sync">
              Review sync activity
              <Icon name="arrow" size={15} />
            </Link>
            <Link className="cc-button" to="/analytics">
              Received study analytics
              <Icon name="chart" size={15} />
            </Link>
          </div>
        </>
      )}

      {view === "controls" && (
        <>
          <div className="cc-control-intro">
            <div className="cc-control-shield">
              <Icon name="controls" size={24} />
            </div>
            <div>
              <h2>One controlled change. A complete record.</h2>
              <p>
                Select an environment and resource, review the desired state,
                and submit with a reason. The source worker records whether the
                change was applied.
              </p>
            </div>
            <button
              className="primary"
              onClick={() => {
                requestKey.current = crypto.randomUUID();
                setDialog("control");
                setReviewing(false);
              }}
            >
              Create a change <Icon name="arrow" size={15} />
            </button>
          </div>
          <Card
            title="Recent control requests"
            description="Pending requests have not yet been confirmed as applied"
          >
            <div className="cc-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Environment / resource</th>
                    <th>Change</th>
                    <th>Requested state</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {controls.data?.items
                    .filter(
                      (c) => !filters.portal || c.portal === filters.portal,
                    )
                    .map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>
                            {portals.find((p) => p.code === c.portal)?.name ||
                              c.portal}
                          </strong>
                          <small>
                            {allCenters.find(
                              (x) => x.id === c.target && x.portal === c.portal,
                            )?.name || c.target}
                          </small>
                        </td>
                        <td>{c.action.replaceAll("_", " ")}</td>
                        <td>{c.enabled ? "Enabled" : "Disabled"}</td>
                        <td className="cc-wrap-cell">{c.reason}</td>
                        <td>
                          <Badge
                            tone={
                              c.status === "applied"
                                ? "good"
                                : c.status === "failed"
                                  ? "danger"
                                  : "warning"
                            }
                          >
                            {c.status}
                          </Badge>
                        </td>
                        <td className="cc-wrap-cell">
                          {c.result || "Awaiting source worker"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!controls.data?.items.filter(
                (c) => !filters.portal || c.portal === filters.portal,
              ).length && (
                <Empty
                  title={
                    controls.loading
                      ? "Loading control history..."
                      : "No control changes yet"
                  }
                  description="Your first request and its result will appear here."
                  icon="controls"
                />
              )}
            </div>
          </Card>
        </>
      )}

      {view === "team" && (
        <>
          <div className="cc-summary-strip">
            <div>
              <strong>{team.data?.items.length ?? "—"}</strong>
              <span>Team members</span>
            </div>
            <div>
              <strong>
                {team.data?.items.filter((m) => m.active).length ?? "—"}
              </strong>
              <span>Active accounts</span>
            </div>
            <div>
              <strong>6</strong>
              <span>Available access roles</span>
            </div>
          </div>
          <Card
            title="Team members"
            description="Role and access changes take effect on the next authenticated request"
          >
            <div className="cc-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Team member</th>
                    <th>Email address</th>
                    <th>Access role</th>
                    <th>Account status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {team.data?.items.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <span className="cc-name-with-icon">
                          <i className="cc-user-avatar">{m.name[0]}</i>
                          <strong>
                            {m.name}
                            <small>
                              {m.owner
                                ? "Organization owner"
                                : m.id === user.id
                                  ? "Your account"
                                  : "Dectrocel team"}
                            </small>
                          </strong>
                        </span>
                      </td>
                      <td>{m.email}</td>
                      <td>
                        <select
                          aria-label={`Role for ${m.name}`}
                          value={m.role}
                          disabled={busy || m.owner || m.id === user.id}
                          onChange={(e) =>
                            void mutate(
                              () =>
                                api.commandPut(`team/${m.id}`, {
                                  role: e.target.value,
                                  active: m.active,
                                }),
                              "Team role updated.",
                            )
                          }
                        >
                          {Object.entries(roles).map(([key, r]) => (
                            <option key={key} value={key}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <Badge tone={m.active ? "good" : "neutral"}>
                          {m.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="cc-text-button"
                          disabled={busy || m.owner || m.id === user.id}
                          onClick={() =>
                            void mutate(
                              () =>
                                api.commandPut(`team/${m.id}`, {
                                  role: m.role,
                                  active: !m.active,
                                }),
                              "Team access updated.",
                            )
                          }
                        >
                          {m.active ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {team.loading && (
                <div className="cc-loading">Loading team members...</div>
              )}
            </div>
          </Card>
          <details className="cc-definitions">
            <summary>
              Understand the six access roles
              <Icon name="chevron" size={14} />
            </summary>
            <div className="cc-role-guide">
              {Object.entries(roles).map(([key, r]) => (
                <div key={key}>
                  <strong>{r.label}</strong>
                  <p>{r.description}</p>
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      {view === "audit" && (
        <Card
          title="Recorded organization changes"
          description="Team access and source-control actions, ordered newest first"
        >
          <div className="cc-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When · IST</th>
                  <th>Team member</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {audits.data?.items.map((a) => (
                  <tr key={a.id}>
                    <td>{stamp(a.createdAt)}</td>
                    <td>
                      <strong>{a.actor}</strong>
                    </td>
                    <td>
                      <Badge
                        tone={
                          a.action.endsWith("failed")
                            ? "danger"
                            : a.action.endsWith("applied")
                              ? "good"
                              : "blue"
                        }
                      >
                        {a.action.replaceAll(".", " / ")}
                      </Badge>
                    </td>
                    <td className="cc-wrap-cell">{a.target}</td>
                    <td>
                      <button
                        className="cc-text-button"
                        onClick={() => setSelectedAudit(a)}
                      >
                        View record <Icon name="arrow" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!audits.data?.items.length && (
              <Empty
                title={
                  audits.loading
                    ? "Loading audit records..."
                    : "No audited changes on this page"
                }
                description="Changes made by your internal team will be recorded here."
                icon="audit"
              />
            )}
          </div>
          <footer className="cc-pagination">
            <span>Page {auditPage} · Up to 50 records per page</span>
            <div>
              <button
                disabled={auditPage === 1}
                onClick={() => setAuditPage((p) => p - 1)}
              >
                Previous
              </button>
              <button
                disabled={(audits.data?.items.length ?? 0) < 50}
                onClick={() => setAuditPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </footer>
        </Card>
      )}

      {dialog === "member" && (
        <Drawer
          title="Add a team member"
          subtitle="Give a colleague access to the organization workspace"
          onClose={() => {
            setDialog(null);
            setMember((m) => ({ ...m, password: "" }));
          }}
        >
          <form
            className="cc-drawer-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate(
                  () => api.commandPost("team", member),
                  "Team member created.",
                )
              ) {
                setDialog(null);
                setMember({
                  name: "",
                  email: "",
                  password: "",
                  role: "viewer",
                });
              }
            }}
          >
            <label>
              Full name
              <input
                required
                maxLength={100}
                value={member.name}
                onChange={(e) => setMember({ ...member, name: e.target.value })}
              />
            </label>
            <label>
              Work email
              <input
                type="email"
                required
                value={member.email}
                onChange={(e) =>
                  setMember({ ...member, email: e.target.value })
                }
              />
            </label>
            <label>
              Initial password
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={member.password}
                onChange={(e) =>
                  setMember({ ...member, password: e.target.value })
                }
              />
              <small>At least 12 characters.</small>
            </label>
            <label>
              Access role
              <select
                value={member.role}
                onChange={(e) => setMember({ ...member, role: e.target.value })}
              >
                {Object.entries(roles).map(([key, r]) => (
                  <option key={key} value={key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="cc-form-note">
              <Icon name="team" size={18} />
              {roles[member.role].description}
            </div>
            {mutationError && (
              <div className="cc-alert danger" role="alert">
                {mutationError}
              </div>
            )}
            <footer>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Creating member..." : "Add team member"}
              </button>
            </footer>
          </form>
        </Drawer>
      )}
      {dialog === "control" && (
        <Drawer
          title={
            reviewing ? "Review access change" : "Request an access change"
          }
          subtitle={
            reviewing
              ? "Confirm the exact resource and intended state before queuing"
              : "Choose a portal, resource and desired state"
          }
          onClose={() => setDialog(null)}
        >
          {!reviewing ? (
            <form
              className="cc-drawer-form"
              onSubmit={(e) => {
                e.preventDefault();
                setReviewing(true);
              }}
            >
              <label>
                1. Environment
                <select
                  required
                  value={controlPortal}
                  onChange={(e) => {
                    setControlPortal(e.target.value);
                    setTarget("");
                    setAction(
                      e.target.value === "onprem"
                        ? "license_access"
                        : "center_access",
                    );
                  }}
                >
                  <option value="">Choose a portal</option>
                  {portals.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                      {!p.controlConfigured ? " · Controls not configured" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {currentPortal && !currentPortal.controlConfigured && (
                <div className="cc-form-note">
                  This portal needs a control connection before access changes
                  are available.
                </div>
              )}
              <label>
                2. What are you managing?
                <select
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value);
                    setTarget("");
                  }}
                >
                  {currentPortal?.kind === "onprem" ? (
                    <>
                      <option value="license_access">License access</option>
                      <option value="workstation_access">
                        Workstation access
                      </option>
                    </>
                  ) : (
                    <>
                      <option value="center_access">Center access</option>
                      <option value="service_access">
                        Portal-wide service availability
                      </option>
                      <option value="user_access">Portal user access</option>
                      <option value="subscription_access">
                        Center service subscription
                      </option>
                    </>
                  )}
                </select>
              </label>
              <label>
                3. Resource
                <select
                  required
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={!controlPortal || resources.loading}
                >
                  <option value="">
                    {resources.loading
                      ? "Loading source inventory..."
                      : "Choose a resource"}
                  </option>
                  {action === "center_access"
                    ? currentPortal?.centers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.status}
                        </option>
                      ))
                    : resources.data?.items
                        .filter(
                          (r) =>
                            r.kind === action.replace("_access", "") &&
                            !(
                              r.kind === "user" &&
                              r.details.role === "SUPER_ADMIN"
                            ),
                        )
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {r.enabled ? "Enabled" : "Disabled"}
                            {r.centerId
                              ? ` · ${currentPortal?.centers.find((c) => c.id === r.centerId)?.name || r.centerId}`
                              : ""}
                          </option>
                        ))}
                </select>
              </label>
              <label>
                4. Desired access
                <select
                  value={String(enabled)}
                  onChange={(e) => setEnabled(e.target.value === "true")}
                >
                  <option value="true">Enabled / active</option>
                  <option value="false">Disabled / blocked</option>
                </select>
              </label>
              <label>
                5. Reason
                <textarea
                  required
                  minLength={8}
                  maxLength={500}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe why this change is needed"
                />
              </label>
              {resources.error && (
                <div className="cc-alert danger">{resources.error}</div>
              )}
              <footer>
                <button type="button" onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={
                    !currentPortal?.controlConfigured ||
                    !target ||
                    reason.trim().length < 8
                  }
                >
                  Review change
                  <Icon name="arrow" size={15} />
                </button>
              </footer>
            </form>
          ) : (
            <div className="cc-drawer-form">
              <div className="cc-form-note">
                <Icon name="audit" size={18} />
                This request will be attributed to you and recorded in the
                organization audit trail.
              </div>
              <dl className="cc-detail-list">
                <div>
                  <dt>Environment</dt>
                  <dd>{currentPortal?.name}</dd>
                </div>
                <div>
                  <dt>Control</dt>
                  <dd>{action.replaceAll("_", " ")}</dd>
                </div>
                <div>
                  <dt>Resource</dt>
                  <dd>
                    {action === "center_access"
                      ? selectedCenter?.name || target
                      : selectedResource?.name || target}
                  </dd>
                </div>
                <div>
                  <dt>Desired state</dt>
                  <dd>
                    <Badge tone={enabled ? "good" : "warning"}>
                      {enabled ? "Enabled / active" : "Disabled / blocked"}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{reason}</dd>
                </div>
              </dl>
              {mutationError && (
                <div className="cc-alert danger" role="alert">
                  {mutationError}
                </div>
              )}
              <footer>
                <button onClick={() => setReviewing(false)}>Back</button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await mutate(
                        () =>
                          api.commandPost(`portals/${controlPortal}/controls`, {
                            action,
                            targetId: target,
                            enabled,
                            reason,
                            requestKey: requestKey.current,
                          }),
                        "Change queued. Check its recorded result in control history.",
                      )
                    ) {
                      setDialog(null);
                      setReviewing(false);
                      setReason("");
                    }
                  }}
                >
                  {busy ? "Queuing request..." : "Confirm & queue change"}
                </button>
              </footer>
            </div>
          )}
        </Drawer>
      )}
      {view === "centers" && directoryCenter && (
        <Drawer
          title={directoryCenter.name}
          subtitle={`${directoryCenter.portalName} · ${directoryCenter.kind === "onprem" ? "Client account" : "Center workspace"}`}
          onClose={() => setCenterDetails(null)}
        >
          <dl className="cc-detail-list">
            <div>
              <dt>Portal</dt>
              <dd>{directoryCenter.portalName}</dd>
            </div>
            <div>
              <dt>Client</dt>
              <dd>{directoryCenter.clientCode}</dd>
            </div>
            <div>
              <dt>Source status</dt>
              <dd>{directoryCenter.status || "Unknown"}</dd>
            </div>
            <div>
              <dt>Source ID</dt>
              <dd>{directoryCenter.id}</dd>
            </div>
          </dl>
          <h3 className="cc-section-title">Open workspace</h3>
          <div className="cc-detail-actions">
            {(directoryCenter.kind === "onprem"
              ? [
                  ["/processing", "Processing"],
                  ["/reports", "Analytics"],
                ]
              : [
                  ["/services", "Services"],
                  ["/users", "Users"],
                  ["/studies", "Studies"],
                  ["/processing", "Processing"],
                  ["/generated-reports", "Reports"],
                  ["/reports", "Analytics"],
                ]
            ).map(([path, label]) => (
              <Link
                className="cc-button"
                key={path}
                to={`${path}?portal=${directoryCenter.portal}&client=${encodeURIComponent(directoryCenter.clientCode)}&center=${encodeURIComponent(directoryCenter.id)}`}
              >
                {label}
                <Icon name="arrow" size={13} />
              </Link>
            ))}
          </div>
          {can("portals:control") && directoryCenter.kind !== "onprem" && (
            <Link
              className="cc-button primary"
              to={`/operations?portal=${directoryCenter.portal}&action=center_access&target=${encodeURIComponent(directoryCenter.id)}`}
            >
              Manage center access <Icon name="controls" size={15} />
            </Link>
          )}
          <p className="cc-caption">
            Each workspace opens with this portal, client and center selected.
          </p>
        </Drawer>
      )}
      {selectedAudit && (
        <Drawer
          title="Audit record"
          subtitle={`${selectedAudit.action} · ${stamp(selectedAudit.createdAt)}`}
          onClose={() => setSelectedAudit(null)}
        >
          <dl className="cc-detail-list">
            <div>
              <dt>Team member</dt>
              <dd>{selectedAudit.actor}</dd>
            </div>
            <div>
              <dt>Action</dt>
              <dd>{selectedAudit.action}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>{selectedAudit.target}</dd>
            </div>
            {Object.entries(selectedAudit.details)
              .filter(([, v]) => typeof v !== "object")
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replaceAll(/([A-Z])/g, " $1")}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
          </dl>
          <details className="cc-inventory">
            <summary>Technical record</summary>
            <pre>{JSON.stringify(selectedAudit.details, null, 2)}</pre>
          </details>
        </Drawer>
      )}
      <footer className="cc-page-footer">
        <span>
          DECTROCEL <i /> ORGANIZATION COMMAND
        </span>
        <span>
          All timestamps in IST · Source systems remain the operational
          authority
        </span>
      </footer>
    </div>
  );
}
