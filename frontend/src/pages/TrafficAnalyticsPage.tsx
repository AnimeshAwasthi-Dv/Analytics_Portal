import { memo, useEffect, useMemo, useState } from "react";
import {
  api,
  type DailyInstanceTraffic,
  type DailyTraffic,
  type HourlyInstanceTraffic,
  type TrafficAnalyticsData,
  type TrafficPeriod,
} from "../services/api.ts";
import { Link } from "react-router-dom";

type Granularity = "daily" | "weekly" | "monthly";
type TrendPoint = {
  key: string;
  label: string;
  requests: number;
  totalDataBytes: number;
};

const numberFormat = new Intl.NumberFormat();

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${numberFormat.format(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function startOfPeriod(date: Date, granularity: Granularity): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (granularity === "weekly") {
    result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7));
  } else if (granularity === "monthly") {
    result.setUTCDate(1);
  }
  return result;
}

function makeTrend(
  overall: DailyTraffic[],
  byInstance: DailyInstanceTraffic[],
  instance: string,
  granularity: Granularity,
  firstDate: string,
  lastDate: string
): TrendPoint[] {
  if (!firstDate || !lastDate) return [];

  const totals = new Map<string, Omit<TrendPoint, "key" | "label">>();
  const addRow = (row: DailyTraffic) => {
    const date = new Date(`${row.date}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return;
    const key = startOfPeriod(date, granularity).toISOString().slice(0, 10);
    const value = totals.get(key) ?? { requests: 0, totalDataBytes: 0 };
    value.requests += row.requests;
    value.totalDataBytes += row.totalDataBytes;
    totals.set(key, value);
  };

  if (instance === "ALL") {
    overall.forEach(addRow);
  } else {
    for (const row of byInstance) {
      if (row.instance === instance) addRow(row);
    }
  }

  const cursor = startOfPeriod(new Date(`${firstDate}T00:00:00Z`), granularity);
  const end = startOfPeriod(new Date(`${lastDate}T00:00:00Z`), granularity);
  const points: TrendPoint[] = [];

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const label =
      granularity === "monthly"
        ? cursor.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" })
        : cursor.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
    points.push({
      key,
      label,
      ...(totals.get(key) ?? { requests: 0, totalDataBytes: 0 }),
    });
    if (granularity === "daily") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (granularity === "weekly") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return points;
}

function makeHourlyTrend(rows: HourlyInstanceTraffic[], instance: string): TrendPoint[] {
  const totals = new Map<number, { requests: number; totalDataBytes: number }>();
  for (const row of rows) {
    if (instance !== "ALL" && row.instance !== instance) continue;
    const total = totals.get(row.hour) ?? { requests: 0, totalDataBytes: 0 };
    total.requests += row.requests;
    total.totalDataBytes += row.totalDataBytes;
    totals.set(row.hour, total);
  }
  return Array.from({ length: 24 }, (_, hour) => ({
    key: String(hour).padStart(2, "0"),
    label: `${String(hour).padStart(2, "0")}:00`,
    ...(totals.get(hour) ?? { requests: 0, totalDataBytes: 0 }),
  }));
}

const TrafficMetricChart = memo(function TrafficMetricChart({
  title,
  description,
  points,
  metric,
  chartType = "bar",
}: {
  title: string;
  description?: string;
  points: TrendPoint[];
  metric: "requests" | "totalDataBytes";
  chartType?: "bar" | "line";
}) {
  const width = 900;
  const height = 250;
  const left = 58;
  const right = 12;
  const top = 16;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = points.map((point) => point[metric]);
  const maximum = Math.max(1, ...values);
  const ceiling = maximum + (maximum < 5 ? 1 : Math.ceil(maximum * 0.12));
  const slotWidth = points.length ? plotWidth / points.length : plotWidth;
  const barWidth = Math.max(3, Math.min(24, slotWidth * 0.62));
  const labelStep = Math.max(1, Math.ceil(points.length / 8));
  const hasData = values.some((value) => value > 0);
  const formatValue =
    metric === "requests"
      ? (value: number) => numberFormat.format(value)
      : formatBytes;

  return (
    <article className="traffic-chart-card">
      <h2>{title}</h2>
      {description && <p className="traffic-chart-description">{description}</p>}
      {hasData ? (
        <svg
          className="traffic-trend-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title} ${chartType} chart`}
        >
          {[0, 0.5, 1].map((fraction) => {
            const y = top + plotHeight * fraction;
            const value = Math.round(ceiling * (1 - fraction));
            return (
              <g key={fraction}>
                <line
                  x1={left}
                  y1={y}
                  x2={width - right}
                  y2={y}
                  className="traffic-grid-line"
                />
                <text
                  x={left - 9}
                  y={y + 4}
                  textAnchor="end"
                  className="traffic-axis-label"
                >
                  {formatValue(value)}
                </text>
              </g>
            );
          })}
          {chartType === "line" && (
            <g>
              <polyline
                points={                values.map((value, index) => {
                  const x = left + slotWidth * index + slotWidth / 2;
                  const y = top + plotHeight - (value / ceiling) * plotHeight;
                  return `${x},${y}`;
                }).join(" ")}
                fill="none"
                className="traffic-data-line"
              />
              {points.map((point, index) => {
                const value = values[index];
                const x = left + slotWidth * index + slotWidth / 2;
                const y = top + plotHeight - (value / ceiling) * plotHeight;
                const showLabel = index === 0 || index === points.length - 1 || index % labelStep === 0;
                return (
                  <g key={point.key}>
                    <circle cx={x} cy={y} r="3.5" className="traffic-data-point">
                      <title>{`${point.label}: ${formatValue(value)}`}</title>
                    </circle>
                    {showLabel && value > 0 && (
                      <text
                        x={x}
                        y={Math.max(top + 11, y - 8)}
                        textAnchor="middle"
                        className="traffic-value-label"
                      >
                        {formatValue(value)}
                      </text>
                    )}
                    {showLabel && (
                      <text x={x} y={height - 12} textAnchor="middle" className="traffic-axis-label">
                        {point.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}
          {chartType === "bar" && points.map((point, index) => {
            const value = values[index];
            const barHeight = (value / ceiling) * plotHeight;
            const x = left + slotWidth * index + (slotWidth - barWidth) / 2;
            const y = top + plotHeight - barHeight;
            const showLabel =
              index === 0 ||
              index === points.length - 1 ||
              index % labelStep === 0;
            return (
              <g key={point.key}>
                <rect
                  x={x}
                  y={value ? y : top + plotHeight - 1}
                  width={barWidth}
                  height={value ? Math.max(2, barHeight) : 1}
                  rx="2"
                  className={metric === "requests" ? "traffic-request-bar" : "traffic-bytes-bar"}
                >
                  <title>{`${point.label}: ${formatValue(value)}`}</title>
                </rect>
                {value > 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={Math.max(top + 10, y - 5)}
                    textAnchor="middle"
                    className="traffic-value-label"
                  >
                    {formatValue(value)}
                  </text>
                )}
                {showLabel && (
                  <text
                    x={x + barWidth / 2}
                    y={height - 12}
                    textAnchor="middle"
                    className="traffic-axis-label"
                  >
                    {point.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="traffic-empty">No {metric === "requests" ? "requests" : "data transfer"} in this date range.</p>
      )}
    </article>
  );
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Unable to load traffic analytics.";
}

export function TrafficAnalyticsPage() {
  const [period, setPeriod] = useState<TrafficPeriod>("30d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [selectedInstance, setSelectedInstance] = useState("ALL");
  const [analytics, setAnalytics] = useState<TrafficAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const customRange = period === "custom";
  const invalidRange = customRange && Boolean(startDate && endDate && startDate > endDate);
  const datesReady = !customRange || Boolean(startDate && endDate && !invalidRange);

  useEffect(() => {
    if (!datesReady) return;
    let cancelled = false;

    async function loadAnalytics() {
      setLoading(true);
      setError("");
      try {
        const result = await api.getTrafficAnalytics({
          period,
          startDate: customRange ? startDate : "",
          endDate: customRange ? endDate : "",
        });
        if (!cancelled) {
          setAnalytics(result);
          setSelectedInstance((current) =>
            current !== "ALL" && !result.instances.some((row) => row.instance === current)
              ? "ALL"
              : current
          );
        }
      } catch (requestError: unknown) {
        if (!cancelled) setError(getErrorMessage(requestError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [period, startDate, endDate, refreshCount, datesReady, customRange]);

  const overview = analytics?.overview;
  const instances = analytics?.instances ?? [];
  const selected = instances.find((row) => row.instance === selectedInstance);
  const dailyTrend = useMemo(
    () =>
      analytics
        ? makeTrend(
            analytics.daily,
            analytics.dailyByInstance,
            selectedInstance,
            granularity,
            analytics.startDate,
            analytics.endDate
          )
        : [],
    [analytics, granularity, selectedInstance]
  );
  const hourlyTrend = useMemo(
    () => makeHourlyTrend(analytics?.hourlyByInstance ?? [], selectedInstance),
    [analytics, selectedInstance]
  );
  const maxBytes = Math.max(1, ...instances.map((row) => row.totalDataBytes));
  const displayName = selected?.name ?? "All instances";
  const displayRequests = selected?.requests ?? overview?.totalRequests ?? 0;
  const displayBytes = selected?.totalDataBytes ?? overview?.totalDataBytes ?? 0;
  const displayResponse = selected
    ? `${selected.averageResponseTimeMs.toLocaleString()} ms`
    : "Overall";
  const recentRequests = (analytics?.recentRequests ?? []).filter(
    (request) =>
      selectedInstance === "ALL" || request.instance === selectedInstance
  );

  return (
    <main className="traffic-page">
      <div className="traffic-content">
        <header className="traffic-header">
          <div>
            <Link to="/dashboard" className="traffic-back-link">Back to dashboard</Link>
            <h1>Traffic analytics</h1>
            <p>Request volume and data transferred by instance and time.</p>
          </div>
          <div className="traffic-controls">
            <label>
              Date range
              <select value={period} onChange={(event) => setPeriod(event.target.value as TrafficPeriod)}>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {customRange && (
              <>
                <label>From<input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} /></label>
                <label>To<input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} /></label>
              </>
            )}
            <label>
              Group by
              <select value={granularity} onChange={(event) => setGranularity(event.target.value as Granularity)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label>
              Instance
              <select value={selectedInstance} onChange={(event) => setSelectedInstance(event.target.value)}>
                <option value="ALL">All instances</option>
                {instances.map((row) => (
                  <option key={row.instance} value={row.instance}>{row.name}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setRefreshCount((count) => count + 1)} disabled={loading || !datesReady}>
              Refresh
            </button>
          </div>
        </header>

        {invalidRange && <p className="traffic-message" role="alert">Start date must be on or before end date.</p>}
        {customRange && datesReady === false && !invalidRange && (
          <p className="traffic-message">Choose a start and end date to load traffic.</p>
        )}
        {error && <p className="traffic-message is-error" role="alert">{error}</p>}

        <section className="traffic-summary" aria-label="Traffic summary">
          <article><span>Requests</span><strong>{loading ? "…" : numberFormat.format(displayRequests)}</strong><small>{selected ? displayName : "All instances in range"}</small></article>
          <article><span>Data transferred</span><strong>{loading ? "…" : formatBytes(displayBytes)}</strong><small>Request + response bytes</small></article>
          <article><span>Active instances</span><strong>{loading ? "…" : numberFormat.format(overview?.activeInstances ?? 0)}</strong><small>With recorded traffic</small></article>
          <article><span>Average response</span><strong>{loading ? "…" : displayResponse}</strong><small>{selected ? "Selected instance" : "Select an instance for its average"}</small></article>
        </section>

        {loading && !analytics ? (
          <p className="traffic-panel" role="status">Loading traffic data…</p>
        ) : analytics && !error ? (
          <>
            <section className="traffic-chart-grid" aria-label="Traffic over time">
              <TrafficMetricChart
                title={`${granularity[0].toUpperCase()}${granularity.slice(1)} request frequency · ${displayName}`}
                description="Number of requests received in each time period."
                points={dailyTrend}
                metric="requests"
              />
              <TrafficMetricChart
                title={`${granularity[0].toUpperCase()}${granularity.slice(1)} data volume · ${displayName}`}
                description="Request and response data transferred in each time period."
                points={dailyTrend}
                metric="totalDataBytes"
                chartType="line"
              />
            </section>
            <section className="traffic-chart-grid traffic-hourly-grid" aria-label="Traffic frequency by time of day">
              <TrafficMetricChart
                title={`Request frequency by hour · ${displayName}`}
                description={`Requests grouped by UTC hour of day across ${analytics.startDate} to ${analytics.endDate}.`}
                points={hourlyTrend}
                metric="requests"
              />
              <TrafficMetricChart
                title={`Data transferred by hour · ${displayName}`}
                description="Request and response bytes grouped by UTC hour of day."
                points={hourlyTrend}
                metric="totalDataBytes"
                chartType="line"
              />
            </section>
            <section className="traffic-panel">
              <div className="traffic-section-heading">
                <div>
                  <h2>Load by instance</h2>
                  <p>Select an instance to inspect its time trend above.</p>
                </div>
              </div>
              {instances.length ? (
                <div className="traffic-instance-list">
                  {instances.map((row) => (
                    <button
                      type="button"
                      key={row.instance}
                      className={`traffic-instance-row${selectedInstance === row.instance ? " is-selected" : ""}`}
                      onClick={() => setSelectedInstance((current) => current === row.instance ? "ALL" : row.instance)}
                    >
                      <span className="traffic-instance-name" title={row.name}>{row.name}</span>
                      <span className="traffic-load-track" aria-label={`${Math.round((row.totalDataBytes / maxBytes) * 100)} percent of largest instance data load`}>
                        <i style={{ width: `${(row.totalDataBytes / maxBytes) * 100}%` }} />
                      </span>
                      <span>{numberFormat.format(row.requests)} requests</span>
                      <strong>{formatBytes(row.totalDataBytes)}</strong>
                      <span>{row.averageResponseTimeMs.toLocaleString()} ms avg</span>
                      <span>{row.successRate.toFixed(1)}% success</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="traffic-empty">No instance traffic in this date range.</p>
              )}
            </section>
            <section className="traffic-panel">
              <div className="traffic-section-heading">
                <div>
                  <h2>Recent request times</h2>
                  <p>Latest recorded requests in this date range, shown in your local time.</p>
                </div>
              </div>
              {recentRequests.length ? (
                <div className="traffic-request-table-wrap">
                  <table className="traffic-request-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Instance</th>
                        <th>Request</th>
                        <th>Status</th>
                        <th>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentRequests.map((request, index) => (
                          <tr key={`${request.timestamp}-${request.route}-${index}`}>
                            <td className="traffic-request-time">
                              {new Date(request.timestamp).toLocaleString()}
                            </td>
                            <td>{request.instanceName}</td>
                            <td className="traffic-request-route">
                              <span>{request.method}</span> {request.route}
                            </td>
                            <td>
                              <span className={`traffic-status${request.statusCode >= 400 ? " is-error" : ""}`}>
                                {request.statusCode}
                              </span>
                            </td>
                            <td>{formatBytes(request.totalDataBytes)}</td>
                          </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="traffic-empty">No identified requests in this date range.</p>
              )}
            </section>
          </>
        ) : !error ? (
          <p className="traffic-panel">Select a valid date range to view traffic.</p>
        ) : null}
      </div>
    </main>
  );
}
