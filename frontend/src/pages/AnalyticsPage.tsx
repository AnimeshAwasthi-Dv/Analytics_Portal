import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Icon } from "../Components/Icon.tsx";
import { api } from "../services/api.ts";
import type { AnalyticsResponse } from "../types";

type RangeOption = "7d" | "30d" | "90d" | "custom";
type Granularity = "daily" | "weekly" | "monthly";
type AnalyticsRow = {
  date: string;
  modality: string;
  instanceCode: string;
  records: number;
  credits: number;
};
type TrendPoint = {
  key: string;
  label: string;
};
type TrendSeries = { key: string; label: string; color: string; values: number[] };

const numberFormat = new Intl.NumberFormat();
const rangeDays: Record<Exclude<RangeOption, "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};
const modalityColors = ["#1765e9", "#16805d", "#9333ea", "#f08a12", "#0891b2"];

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateLabel(value: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { timeZone: "UTC", ...options });
}

function initialDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { start: dateKey(start), end: dateKey(end) };
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

function TrendChart({
  points,
  series,
}: {
  points: TrendPoint[];
  series: TrendSeries[];
}) {
  const width = 1000;
  const height = 190;
  const left = 34;
  const right = 8;
  const top = 10;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(1, ...series.flatMap((line) => line.values));
  const xFor = (index: number) =>
    left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (value: number) => top + plotHeight - (value / maximum) * plotHeight;
  const labelIndexes = Array.from(
    new Set(
      Array.from({ length: Math.min(7, points.length) }, (_, index) =>
        Math.round((index / Math.max(1, Math.min(7, points.length) - 1)) * (points.length - 1))
      )
    )
  );

  return (
    <div className="analytics-trend">
      {points.length && series.length ? (
        <svg
          className="analytics-mini-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Line chart showing analytics trends"
        >
          {[0, 0.5, 1].map((fraction) => {
            const y = top + plotHeight * fraction;
            return (
              <g key={fraction}>
                <line x1={left} y1={y} x2={width - right} y2={y} stroke="#e4edf7" />
                <text x={left - 7} y={y + 3} textAnchor="end" className="analytics-chart-label">
                  {Math.round(maximum * (1 - fraction))}
                </text>
              </g>
            );
          })}
          {series.map((line) => (
            <g key={line.key}>
              <polyline
                points={line.values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ")}
                fill="none"
                stroke={line.color}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              {line.values.map((value, index) => (
                <circle key={`${line.key}-${points[index].key}`} cx={xFor(index)} cy={yFor(value)} r="2" fill={line.color}>
                  <title>{`${points[index].label}: ${line.label}, ${numberFormat.format(value)}`}</title>
                </circle>
              ))}
            </g>
          ))}
          {labelIndexes.map((index) => (
            <text
              key={points[index].key}
              x={xFor(index)}
              y={height - 4}
              textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
              className="analytics-chart-label"
            >
              {points[index].label}
            </text>
          ))}
        </svg>
      ) : (
        <p className="analytics-empty">No trend data for this date range.</p>
      )}
      <div className="analytics-chart-legend" aria-hidden="true">
        {series.map((line) => (
          <span key={line.key}><i style={{ backgroundColor: line.color }} />{line.label}</span>
        ))}
      </div>
    </div>
  );
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safeText = typeof value === "string" && /^[\s]*[=+\-@]/.test(text)
    ? `'${text}`
    : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function percentDifference(first: number, second: number): string {
  const baseline = Math.min(first, second);
  const difference = Math.max(first, second) - baseline;
  if (difference === 0) return "0%";
  if (baseline === 0) return "New";
  return `+${Math.round((difference / baseline) * 100)}%`;
}

export function AnalyticsPage() {
  const initialRange = useMemo(() => initialDateRange(), []);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedModality, setSelectedModality] = useState("ALL");
  const [selectedInstance, setSelectedInstance] = useState("ALL");
  const [deepDiveModality, setDeepDiveModality] = useState("");
  const [rangeOption, setRangeOption] = useState<RangeOption>("30d");
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const dateRangeInvalid = Boolean(startDate && endDate && endDate < startDate);

  const showError = (requestError: unknown) => {
    const message = requestError as {
      response?: { data?: { detail?: string } };
      message?: string;
    };
    setError(
      message.response?.data?.detail ??
        message.message ??
        "Unable to load analytics from the portal database."
    );
  };

  const loadAnalytics = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      setAnalytics(await api.getAnalytics());
    } catch (requestError) {
      showError(requestError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    api.getAnalytics()
      .then((response) => {
        if (active) setAnalytics(response);
      })
      .catch((requestError: unknown) => {
        if (active) showError(requestError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const modalities = useMemo(
    () => analytics?.availableModalities ?? [],
    [analytics]
  );
  const instances = useMemo(
    () =>
      Array.from(new Set((analytics?.byInstance ?? []).map((row) => row.instanceCode)))
        .sort((a, b) => a.localeCompare(b)),
    [analytics]
  );

  const rangeFilteredRows = useMemo<AnalyticsRow[]>(
    () =>
      (analytics?.daily ?? [])
        .filter(
          (row) =>
            Boolean(startDate && endDate) &&
            !dateRangeInvalid &&
            row.date >= startDate &&
            row.date <= endDate &&
            (selectedInstance === "ALL" || row.instanceCode === selectedInstance)
        )
        .map((row) => ({
          date: row.date,
          modality: row.modality,
          instanceCode: row.instanceCode,
          records: row.records,
          credits: row.credits,
        })),
    [analytics, dateRangeInvalid, endDate, selectedInstance, startDate]
  );

  const filteredRows = useMemo(
    () =>
      rangeFilteredRows.filter(
        (row) =>
          selectedModality === "ALL" ||
          row.modality.toLocaleUpperCase() === selectedModality.toLocaleUpperCase()
      ),
    [rangeFilteredRows, selectedModality]
  );

  const summary = useMemo(
    () => ({
      records: filteredRows.reduce((total, row) => total + row.records, 0),
      credits: filteredRows.reduce((total, row) => total + row.credits, 0),
      instances: new Set(filteredRows.map((row) => row.instanceCode)).size,
    }),
    [filteredRows]
  );

  const receivedModalities = useMemo(
    () =>
      modalities.filter((modality) =>
        rangeFilteredRows.some(
          (row) => row.modality.toLocaleUpperCase() === modality.toLocaleUpperCase()
        )
      ),
    [modalities, rangeFilteredRows]
  );

  const modalityRows = useMemo(() => {
    const grouped = new Map<string, { records: number; credits: number }>();
    for (const row of filteredRows) {
      const total = grouped.get(row.modality) ?? { records: 0, credits: 0 };
      total.records += row.records;
      total.credits += row.credits;
      grouped.set(row.modality, total);
    }
    return Array.from(grouped, ([modality, total]) => ({ modality, ...total }))
      .sort((a, b) => b.records - a.records || a.modality.localeCompare(b.modality));
  }, [filteredRows]);

  const activeDeepDive =
    deepDiveModality || modalityRows[0]?.modality || modalities[0] || "";

  const trendPoints = useMemo<TrendPoint[]>(() => {
    if (!startDate || !endDate || endDate < startDate) return [];
    const points: TrendPoint[] = [];
    const cursor = startOfPeriod(new Date(`${startDate}T00:00:00Z`), granularity);
    const end = startOfPeriod(new Date(`${endDate}T00:00:00Z`), granularity);
    while (cursor <= end) {
      const key = dateKey(cursor);
      points.push({
        key,
        label: dateLabel(
          key,
          granularity === "monthly"
            ? { month: "short", year: "2-digit" }
            : { month: "short", day: "numeric" }
        ),
      });
      if (granularity === "daily") cursor.setUTCDate(cursor.getUTCDate() + 1);
      else if (granularity === "weekly") cursor.setUTCDate(cursor.getUTCDate() + 7);
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return points;
  }, [endDate, granularity, startDate]);

  const trendTotals = useMemo(() => {
    const totals = new Map<string, { records: number; credits: number }>();
    for (const row of filteredRows) {
      const bucket = dateKey(startOfPeriod(new Date(`${row.date}T00:00:00Z`), granularity));
      const key = `${bucket}\u0000${row.modality}`;
      const total = totals.get(key) ?? { records: 0, credits: 0 };
      total.records += row.records;
      total.credits += row.credits;
      totals.set(key, total);
    }
    return totals;
  }, [filteredRows, granularity]);

  const deepDiveTotals = useMemo(() => {
    const totals = new Map<string, { records: number; credits: number }>();
    for (const row of rangeFilteredRows) {
      const bucket = dateKey(startOfPeriod(new Date(`${row.date}T00:00:00Z`), granularity));
      const key = `${bucket}\u0000${row.modality}`;
      const total = totals.get(key) ?? { records: 0, credits: 0 };
      total.records += row.records;
      total.credits += row.credits;
      totals.set(key, total);
    }
    return totals;
  }, [granularity, rangeFilteredRows]);

  const trendSeries = useMemo<TrendSeries[]>(
    () =>
      modalities
        .filter((modality) => selectedModality === "ALL" || modality === selectedModality)
        .map((modality) => ({
          key: modality,
          label: modality,
          color: modalityColors[modalities.indexOf(modality) % modalityColors.length],
          values: trendPoints.map(
            (point) => trendTotals.get(`${point.key}\u0000${modality}`)?.records ?? 0
          ),
        })),
    [modalities, selectedModality, trendPoints, trendTotals]
  );

  const deepDiveTrendSeries = useMemo<TrendSeries[]>(
    () => [
      {
        key: "records",
        label: "Study",
        color: "#1765e9",
        values: trendPoints.map(
          (point) => deepDiveTotals.get(`${point.key}\u0000${activeDeepDive}`)?.records ?? 0
        ),
      },
      {
        key: "credits",
        label: "Views",
        color: "#16805d",
        values: trendPoints.map(
          (point) => deepDiveTotals.get(`${point.key}\u0000${activeDeepDive}`)?.credits ?? 0
        ),
      },
    ],
    [activeDeepDive, deepDiveTotals, trendPoints]
  );

  const instanceComparison = useMemo(() => {
    const grouped = new Map<string, Map<string, { records: number; credits: number }>>();
    for (const row of rangeFilteredRows) {
      const byInstance = grouped.get(row.modality) ?? new Map();
      const total = byInstance.get(row.instanceCode) ?? { records: 0, credits: 0 };
      total.records += row.records;
      total.credits += row.credits;
      byInstance.set(row.instanceCode, total);
      grouped.set(row.modality, byInstance);
    }
    const compareInstances = instances.filter(
      (instance) => selectedInstance === "ALL" || selectedInstance === instance
    );
    const rows = Array.from(grouped, ([modality, byInstance]) => ({
      modality,
      values: compareInstances.map(
        (instance) => byInstance.get(instance) ?? { records: 0, credits: 0 }
      ),
    })).sort((a, b) => {
      const aTotal = a.values.reduce((sum, value) => sum + value.records, 0);
      const bTotal = b.values.reduce((sum, value) => sum + value.records, 0);
      return bTotal - aTotal || a.modality.localeCompare(b.modality);
    });
    return { instances: compareInstances, rows };
  }, [instances, rangeFilteredRows, selectedInstance]);

  const deepDiveRows = useMemo(() => {
    const grouped = new Map<string, { records: number; credits: number }>();
    for (const row of rangeFilteredRows) {
      if (row.modality !== activeDeepDive) continue;
      const total = grouped.get(row.instanceCode) ?? { records: 0, credits: 0 };
      total.records += row.records;
      total.credits += row.credits;
      grouped.set(row.instanceCode, total);
    }
    return Array.from(grouped, ([instanceCode, total]) => ({ instanceCode, ...total }))
      .sort((a, b) => b.records - a.records || a.instanceCode.localeCompare(b.instanceCode));
  }, [activeDeepDive, rangeFilteredRows]);
  const deepDiveTotal = deepDiveRows.reduce((total, row) => total + row.records, 0);
  const lastSyncByInstance = useMemo(() => {
    const latest = new Map<string, string>();
    for (const row of analytics?.daily ?? []) {
      if (!latest.has(row.instanceCode) || row.date > latest.get(row.instanceCode)!) {
        latest.set(row.instanceCode, row.date);
      }
    }
    return latest;
  }, [analytics]);

  const handleRangeChange = (value: RangeOption) => {
    setRangeOption(value);
    if (value === "custom") return;
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - rangeDays[value] + 1);
    setStartDate(dateKey(start));
    setEndDate(dateKey(end));
  };

  const downloadCsv = () => {
    const rows: Array<Array<string | number>> = [
      ["Sync analytics"],
      ["From", startDate, "To", endDate],
      ["Studies", summary.records, "Views", summary.credits],
      [],
      ["Modality overview", "Study", "Views", "Share"],
      ...modalityRows.map((row) => [
        row.modality,
        row.records,
        row.credits,
        summary.records ? `${((row.records / summary.records) * 100).toFixed(1)}%` : "0.0%",
      ]),
      [],
      [
        "Instance comparison",
        ...instanceComparison.instances.flatMap((instance) => [`${instance} studies`, `${instance} views`]),
        "Difference",
      ],
      ...instanceComparison.rows.map((row) => {
        const records = row.values.map((value) => value.records);
        const positive = Math.max(...records);
        const baseline = Math.min(...records);
        return [
          row.modality,
          ...row.values.flatMap((value) => [value.records, value.credits]),
          percentDifference(positive, baseline),
        ];
      }),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sync-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const cards = [
    {
      label: "Source instances",
      value: summary.instances,
      detail: instances.join("  •  ") || "No instances in this range",
      icon: "database" as const,
    },
    {
      label: "Modalities received",
      value: receivedModalities.length,
      detail: receivedModalities.join("  •  ") || "No modalities in this range",
      icon: "activity" as const,
    },
  ];

  const comparisonModalities = modalities;

  return (
    <main className="analytics-page min-h-screen">
      <div className="analytics-content">
        <header className="analytics-header">
          <div className="analytics-heading">
            <p className="analytics-breadcrumb">
              <Link to="/dashboard">Dashboard</Link><span>/</span>Sync analytics
            </p>
            <h1>Sync analytics</h1>
            <p className="analytics-subtitle">
              {selectedInstance === "ALL" ? "All instances" : selectedInstance}
              <span>•</span>
              {selectedModality === "ALL" ? "modality overview" : selectedModality}
            </p>
          </div>

          <div className="analytics-controls">
            <label>
              <span>Quick range</span>
              <select
                value={rangeOption}
                onChange={(event) => handleRangeChange(event.target.value as RangeOption)}
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="custom">Custom range</option>
              </select>
            </label>
            <label>
              <span>From</span>
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setRangeOption("custom");
                }}
              />
            </label>
            <label>
              <span>To</span>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setRangeOption("custom");
                }}
              />
            </label>
            <label>
              <span>Instance</span>
              <select
                value={selectedInstance}
                onChange={(event) => setSelectedInstance(event.target.value)}
              >
                <option value="ALL">All instances</option>
                {instances.map((instance) => (
                  <option key={instance} value={instance}>{instance}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Modality</span>
              <select
                value={selectedModality}
                onChange={(event) => setSelectedModality(event.target.value)}
              >
                <option value="ALL">All modalities</option>
                {modalities.map((modality) => (
                  <option key={modality} value={modality}>{modality}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="analytics-button"
              onClick={() => void loadAnalytics()}
              disabled={refreshing || loading}
            >
              <span aria-hidden="true">↻</span>{refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              className="analytics-button analytics-button-primary"
              onClick={downloadCsv}
              disabled={!analytics}
            >
              <span aria-hidden="true">↓</span>Export CSV
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="analytics-error">
            <strong>Analytics unavailable:</strong> {error}
          </div>
        )}
        {dateRangeInvalid && (
          <div role="alert" className="analytics-error">
            The end date must be on or after the start date.
          </div>
        )}

        {loading && !analytics ? (
          <p className="analytics-panel analytics-loading">Loading saved portal data...</p>
        ) : analytics ? (
          <>
            <section className="analytics-kpi-grid" aria-label="Filtered analytics summary">
              {cards.map(({ label, value, detail, icon }) => (
                <article key={label} className="analytics-kpi-card">
                  <span className="analytics-kpi-icon"><Icon name={icon} /></span>
                  <div>
                    <p>{label}</p>
                    <strong>{numberFormat.format(value)}</strong>
                    <small>{detail}</small>
                  </div>
                </article>
              ))}
            </section>

            <section className="analytics-panel analytics-main-chart" aria-label="Studies over time by modality">
              <div className="analytics-section-heading">
                <h2>Total studies trend</h2>
                <div className="analytics-chart-controls">
                  <div className="analytics-granularity-tabs" role="group" aria-label="Trend interval">
                    {(["daily", "weekly", "monthly"] as const).map((period) => (
                      <button
                        key={period}
                        type="button"
                        aria-pressed={granularity === period}
                        className={granularity === period ? "active" : ""}
                        onClick={() => setGranularity(period)}
                      >
                        {period[0].toUpperCase() + period.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div className="analytics-chart-range">
                    <span>{dateLabel(startDate, { month: "short", day: "numeric", year: "numeric" })}</span>
                    <span>–</span>
                    <span>{dateLabel(endDate, { month: "short", day: "numeric", year: "numeric" })}</span>
                  </div>
                </div>
              </div>
              {!dateRangeInvalid && <TrendChart points={trendPoints} series={trendSeries} />}
            </section>

            <section className="analytics-panel analytics-table-panel">
              <div className="analytics-section-heading">
                <h2>Instance comparison</h2>
                <span className="analytics-section-note">
                  {selectedInstance === "ALL" ? "Comparing all instances" : `Comparing ${selectedInstance}`}
                </span>
              </div>
              <div className="analytics-table-scroll">
                <table className="analytics-table analytics-comparison-table">
                  <thead>
                    <tr>
                      <th rowSpan={2}>Instance</th>
                      {comparisonModalities.map((modality) => (
                        <th
                          key={modality}
                          colSpan={2}
                          style={{ borderTop: `3px solid ${modalityColors[modalities.indexOf(modality) % modalityColors.length]}` }}
                        >
                          <span className="analytics-modality-name">
                            <i style={{ backgroundColor: modalityColors[modalities.indexOf(modality) % modalityColors.length] }} />
                            {modality}
                          </span>
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {comparisonModalities.map((modality) => (
                        <Fragment key={`${modality}-metrics`}>
                          <th>Study</th><th>Views</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {instanceComparison.instances.map((instance, instanceIndex) => (
                      <tr key={instance}>
                        <th scope="row">{instance}</th>
                        {comparisonModalities.map((modality) => {
                          const row = instanceComparison.rows.find((item) => item.modality === modality);
                          const total = row?.values[instanceIndex] ?? { records: 0, credits: 0 };
                          return (
                            <Fragment key={`${instance}-${modality}`}>
                              <td>{numberFormat.format(total.records)}</td>
                              <td>{numberFormat.format(total.credits)}</td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                    {!instanceComparison.instances.length && (
                      <tr>
                        <td className="analytics-empty-cell" colSpan={Math.max(1, comparisonModalities.length * 2 + 1)}>
                          No records match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {instanceComparison.instances.length > 0 && (
                    <tfoot>
                      <tr>
                        <th>Total</th>
                        {comparisonModalities.map((modality) => {
                          const row = instanceComparison.rows.find((item) => item.modality === modality);
                          const total = (row?.values ?? []).reduce(
                            (sum, value) => ({
                              records: sum.records + value.records,
                              credits: sum.credits + value.credits,
                            }),
                            { records: 0, credits: 0 }
                          );
                          return (
                            <Fragment key={`${modality}-total`}>
                              <th>{numberFormat.format(total.records)}</th>
                              <th>{numberFormat.format(total.credits)}</th>
                            </Fragment>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>

            <section className="analytics-panel analytics-deep-dive">
              <div className="analytics-section-heading analytics-deep-heading">
                <div>
                  <h2>Modality deep dive</h2>
                  <p>Showing all instances in the selected date range.</p>
                </div>
                <div className="analytics-modality-tabs" role="tablist" aria-label="Select modality">
                  {modalities.map((modality) => (
                    <button
                      key={modality}
                      type="button"
                      role="tab"
                      aria-selected={activeDeepDive === modality}
                      className={activeDeepDive === modality ? "active" : ""}
                      onClick={() => setDeepDiveModality(modality)}
                    >
                      {modality}
                    </button>
                  ))}
                </div>
              </div>

              <div className="analytics-deep-grid">
                <div className="analytics-deep-chart">
                  <div className="analytics-section-heading">
                    <h3>{activeDeepDive || "Modality"} trend</h3>
                  </div>
                  <TrendChart points={trendPoints} series={deepDiveTrendSeries} />
                </div>

                <div className="analytics-deep-table">
                  <div className="analytics-section-heading">
                    <h3>{activeDeepDive || "Modality"} details by instance</h3>
                  </div>
                  <div className="analytics-table-scroll">
                    <table className="analytics-table">
                      <thead>
                        <tr><th>Instance</th><th>Study</th><th>Views</th><th>Share</th><th>Last sync</th></tr>
                      </thead>
                      <tbody>
                        {deepDiveRows.map((row) => (
                          <tr key={row.instanceCode}>
                            <td>{row.instanceCode}</td>
                            <td>{numberFormat.format(row.records)}</td>
                            <td>{numberFormat.format(row.credits)}</td>
                            <td>
                              <span className="analytics-share">
                                <i style={{ width: `${deepDiveTotal ? (row.records / deepDiveTotal) * 100 : 0}%` }} />
                              </span>
                              <span className="analytics-share-value">
                                {deepDiveTotal ? `${Math.round((row.records / deepDiveTotal) * 100)}%` : "0%"}
                              </span>
                            </td>
                            <td>
                              {lastSyncByInstance.has(row.instanceCode)
                                ? dateLabel(lastSyncByInstance.get(row.instanceCode)!, {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })
                                : "—"}
                            </td>
                          </tr>
                        ))}
                        {!deepDiveRows.length && (
                          <tr><td className="analytics-empty-cell" colSpan={5}>No records for this modality.</td></tr>
                        )}
                      </tbody>
                      {deepDiveRows.length > 0 && (
                        <tfoot>
                          <tr>
                            <th>Total</th>
                            <th>{numberFormat.format(deepDiveRows.reduce((total, row) => total + row.records, 0))}</th>
                            <th>{numberFormat.format(deepDiveRows.reduce((total, row) => total + row.credits, 0))}</th>
                            <th><span className="analytics-share"><i style={{ width: "100%" }} /></span><span className="analytics-share-value">100%</span></th>
                            <th>—</th>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
