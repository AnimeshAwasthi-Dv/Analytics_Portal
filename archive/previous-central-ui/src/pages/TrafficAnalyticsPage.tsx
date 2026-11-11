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
  studies: number;
  creditsUsed: number;
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
    const value = totals.get(key) ?? { requests: 0, totalDataBytes: 0, studies: 0, creditsUsed: 0 };
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
      ...(totals.get(key) ?? { requests: 0, totalDataBytes: 0, studies: 0, creditsUsed: 0 }),
    });
    if (granularity === "daily") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (granularity === "weekly") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return points;
}

function makeSourceTrend(
  rows: NonNullable<TrafficAnalyticsData["sourceActivity"]>["daily"],
  instance: string,
  granularity: Granularity,
  firstDate: string,
  lastDate: string
): TrendPoint[] {
  if (!firstDate || !lastDate) return [];
  const totals = new Map<string, { studies: number; creditsUsed: number }>();
  for (const row of rows) {
    if (instance !== "ALL" && row.instance !== instance) continue;
    const date = new Date(`${row.date}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) continue;
    const key = startOfPeriod(date, granularity).toISOString().slice(0, 10);
    const total = totals.get(key) ?? { studies: 0, creditsUsed: 0 };
    total.studies += row.studies;
    total.creditsUsed += row.creditsUsed;
    totals.set(key, total);
  }

  const cursor = startOfPeriod(new Date(`${firstDate}T00:00:00Z`), granularity);
  const end = startOfPeriod(new Date(`${lastDate}T00:00:00Z`), granularity);
  const points: TrendPoint[] = [];
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const label = granularity === "monthly"
      ? cursor.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" })
      : cursor.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
    points.push({
      key,
      label,
      requests: 0,
      totalDataBytes: 0,
      ...(totals.get(key) ?? { studies: 0, creditsUsed: 0 }),
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
    studies: 0,
    creditsUsed: 0,
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
  metric: "requests" | "totalDataBytes" | "studies" | "creditsUsed";
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
  const formatValue = metric === "totalDataBytes"
    ? formatBytes
    : (value: number) => numberFormat.format(value);

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
                  className={metric === "requests" || metric === "studies" ? "traffic-request-bar" : "traffic-bytes-bar"}
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
        <p className="traffic-empty">No {metric === "requests" ? "requests" : metric === "studies" ? "studies" : metric === "creditsUsed" ? "credits used" : "data transfer"} in this date range.</p>
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
            current !== "ALL" &&
            !result.sourceActivity.instances.some((row) => row.instance === current)
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
  const sourceActivity = analytics?.sourceActivity;
  const sourceInstances = sourceActivity?.instances ?? [];
  const maxSourceStudies = Math.max(1, ...sourceInstances.map((row) => row.studies));
  const allInstances = sourceInstances.map((row) => ({ instance: row.instance, name: row.name }));
  const dailyTrend = useMemo(
    () =>
      analytics
        ? makeTrend(
            analytics.daily,
            analytics.dailyByInstance,
            "ALL",
            granularity,
            analytics.startDate,
            analytics.endDate
          )
        : [],
    [analytics, granularity]
  );
  const sourceTrend = useMemo(
    () => analytics
      ? makeSourceTrend(
          analytics.sourceActivity.daily,
          selectedInstance,
          granularity,
          analytics.startDate,
          analytics.endDate
        )
      : [],
    [analytics, granularity, selectedInstance]
  );
  const hourlyTrend = useMemo(
    () => makeHourlyTrend(analytics?.hourlyByInstance ?? [], "ALL"),
    [analytics]
  );
  const displayRequests = overview?.totalRequests ?? 0;
  const displayBytes = overview?.totalDataBytes ?? 0;

  return (
    <main className="traffic-page">
      <div className="traffic-content">
        <header className="traffic-header">
          <div>
            <Link to="/dashboard" className="traffic-back-link">Back to dashboard</Link>
            <h1>Traffic analytics</h1>
            <p>Study activity from connected source databases, with portal HTTP metrics available below.</p>
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
              Source instance
              <select value={selectedInstance} onChange={(event) => setSelectedInstance(event.target.value)}>
                <option value="ALL">All instances</option>
                {allInstances.map((row) => (
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

        <section className="traffic-panel">
          <div className="traffic-section-heading">
            <div>
              <h2>Source database activity</h2>
              <p>Studies imported directly from the connected source databases.</p>
            </div>
          </div>
          <div className="traffic-summary">
            <article><span>Studies received</span><strong>{loading ? "..." : numberFormat.format(sourceActivity?.totalStudies ?? 0)}</strong><small>Successful records saved in this period</small></article>
            <article><span>Credits used</span><strong>{loading ? "..." : numberFormat.format(sourceActivity?.creditsUsed ?? 0)}</strong><small>Summed from imported study records</small></article>
            <article><span>Identified instances</span><strong>{loading ? "..." : numberFormat.format(sourceActivity?.activeInstances ?? 0)}</strong><small>Source database identifiers</small></article>
            <article><span>Latest sync</span><strong>{loading ? "..." : sourceActivity?.lastSync ? new Date(sourceActivity.lastSync).toLocaleString() : "â€”"}</strong><small>Most recent imported study</small></article>
          </div>
          <section className="traffic-chart-grid traffic-source-chart-grid" aria-label="Imported study and credit trends">
            <TrafficMetricChart
              title={`Studies received by ${granularity} Â· ${allInstances.find((row) => row.instance === selectedInstance)?.name ?? "all instances"}`}
              description="Number of successfully imported studies in each time period."
              points={sourceTrend}
              metric="studies"
            />
            <TrafficMetricChart
              title={`Credits used by ${granularity} Â· ${allInstances.find((row) => row.instance === selectedInstance)?.name ?? "all instances"}`}
              description="Credits attributed to imported studies in each time period."
              points={sourceTrend}
              metric="creditsUsed"
              chartType="line"
            />
          </section>
          <div className="traffic-source-instance-list">
            <h3>Load by instance</h3>
            {sourceInstances.length ? sourceInstances.map((row) => (
              <div className="traffic-source-instance-row" key={row.instance}>
                <strong title={row.name}>{row.name}</strong>
                <span>{row.instance}</span>
                <span className="traffic-source-study-load">
                  <b>{numberFormat.format(row.studies)} studies</b>
                  <i><em style={{ width: `${(row.studies / maxSourceStudies) * 100}%` }} /></i>
                </span>
                <span>{numberFormat.format(row.creditsUsed)} credits</span>
                <span>{row.lastSync ? new Date(row.lastSync).toLocaleString() : "Never"}</span>
              </div>
            )) : <p className="traffic-empty">No synchronized studies were saved in this date range.</p>}
          </div>
        </section>

        <section className="traffic-http-section">
        <div className="traffic-section-heading">
          <div>
            <h2>Portal HTTP traffic</h2>
            <p>Portal API requests over time and the data transferred.</p>
          </div>
        </div>
        <section className="traffic-summary" aria-label="Traffic summary">
          <article><span>Requests</span><strong>{loading ? "..." : numberFormat.format(displayRequests)}</strong><small>All portal API traffic in range</small></article>
          <article><span>Data transferred</span><strong>{loading ? "..." : formatBytes(displayBytes)}</strong><small>Request + response bytes</small></article>
          <article><span>API-key instances</span><strong>{loading ? "..." : numberFormat.format(overview?.activeInstances ?? 0)}</strong><small>Portal API-key instances</small></article>
          <article><span>Average response</span><strong>{loading ? "…" : `${overview?.averageResponseTimeMs ?? 0} ms`}</strong><small>{overview?.successRate ?? 0}% successful requests</small></article>
        </section>

        {loading && !analytics ? (
          <p className="traffic-panel" role="status">Loading traffic data...</p>
        ) : analytics && !error ? (
          <>
            <section className="traffic-chart-grid" aria-label="Traffic over time">
              <TrafficMetricChart
                title={`Portal request timeline by ${granularity}`}
                description="Requests received by the portal over the selected date range."
                points={dailyTrend}
                metric="requests"
              />
              <TrafficMetricChart
                title={`Portal data volume by ${granularity}`}
                description="Request and response data transferred in each time period."
                points={dailyTrend}
                metric="totalDataBytes"
                chartType="line"
              />
            </section>
            <section className="traffic-chart-grid traffic-hourly-grid" aria-label="Traffic frequency by time of day">
              <TrafficMetricChart
                title="Portal requests by time of day"
                description={`Requests grouped by UTC hour across ${analytics.startDate} to ${analytics.endDate}.`}
                points={hourlyTrend}
                metric="requests"
              />
              <TrafficMetricChart
                title="Portal data transferred by time of day"
                description="Request and response bytes grouped by UTC hour of day."
                points={hourlyTrend}
                metric="totalDataBytes"
                chartType="line"
              />
            </section>
          </>
        ) : !error ? (
          <p className="traffic-panel">Select a valid date range to view traffic.</p>
        ) : null}
        </section>
      </div>
    </main>
  );
}
