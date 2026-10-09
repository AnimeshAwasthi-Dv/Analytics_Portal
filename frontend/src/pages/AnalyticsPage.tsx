import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../services/api.ts";
import type { AnalyticsResponse } from "../types";

type BreakdownMode = "modality" | "instance" | "modality-instance";
type AnalyticsRow = {
  category: string;
  records: number;
  credits: number;
};
type TrendPoint = {
  key: string;
  label: string;
  records: number;
  credits: number;
};

function TrendChart({ data, title }: { data: TrendPoint[]; title: string }) {
  const width = 360;
  const height = 112;
  const left = 30;
  const right = 8;
  const top = 8;
  const bottom = 20;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(
    1,
    ...data.flatMap((point) => [point.records, point.credits])
  );
  const pointsFor = (value: "records" | "credits") =>
    data
      .map((point, index) => {
        const x = left + (data.length <= 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
        const y = top + plotHeight - (point[value] / maximum) * plotHeight;
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <div>
      <svg
        className="analytics-mini-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}: line chart for records and credits`}
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = top + plotHeight * fraction;
          return (
            <g key={fraction}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke="#e5e7eb" />
              <text x={left - 5} y={y + 3} textAnchor="end" className="analytics-chart-label">
                {Math.round(maximum * (1 - fraction))}
              </text>
            </g>
          );
        })}
        <polyline
          points={pointsFor("records")}
          fill="none"
          stroke="#1765e9"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={pointsFor("credits")}
          fill="none"
          stroke="#16805d"
          strokeWidth="2"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
        {data.map((point, index) => {
          const x = left + (data.length <= 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
          const y = top + plotHeight - (point.records / maximum) * plotHeight;
          return <circle key={point.key} cx={x} cy={y} r="2" fill="#1765e9"><title>{`${point.label}: ${point.records} records, ${point.credits} credits`}</title></circle>;
        })}
        {data.length > 0 && (
          <>
            <text x={left} y={height - 3} className="analytics-chart-label">{data[0].label}</text>
            <text x={width - right} y={height - 3} textAnchor="end" className="analytics-chart-label">{data[data.length - 1].label}</text>
          </>
        )}
      </svg>
      <div className="analytics-chart-legend" aria-hidden="true">
        <span><i className="records" />Records</span>
        <span><i className="credits" />Credits</span>
      </div>
    </div>
  );
}

const numberFormat = new Intl.NumberFormat();

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function periodStart(date: Date, period: "daily" | "weekly" | "monthly"): Date {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  if (period === "weekly") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  } else if (period === "monthly") {
    start.setUTCDate(1);
  }
  return start;
}

function buildTrend(
  analytics: AnalyticsResponse,
  period: "daily" | "weekly" | "monthly",
  modality: string,
  instance: string
): TrendPoint[] {
  const now = new Date();
  const currentPeriod = periodStart(now, period);
  const count = period === "daily" ? 30 : 12;
  const firstPeriod = new Date(currentPeriod);

  if (period === "daily") {
    firstPeriod.setUTCDate(firstPeriod.getUTCDate() - count + 1);
  } else if (period === "weekly") {
    firstPeriod.setUTCDate(firstPeriod.getUTCDate() - 7 * (count - 1));
  } else {
    firstPeriod.setUTCMonth(firstPeriod.getUTCMonth() - (count - 1));
  }

  const bucketStart = (date: Date): Date => periodStart(date, period);
  const totals = new Map<string, { records: number; credits: number }>();

  for (const row of analytics.daily) {
    if (
      (modality !== "ALL" &&
        row.modality.toLocaleUpperCase() !== modality.toLocaleUpperCase()) ||
      (instance !== "ALL" && row.instanceCode !== instance)
    ) {
      continue;
    }

    const parsedDate = new Date(`${row.date}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime())) continue;
    const key = dateKey(bucketStart(parsedDate));
    const total = totals.get(key) ?? { records: 0, credits: 0 };
    total.records += row.records;
    total.credits += row.credits;
    totals.set(key, total);
  }

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(firstPeriod);
    if (period === "daily") {
      date.setUTCDate(date.getUTCDate() + index);
    } else if (period === "weekly") {
      date.setUTCDate(date.getUTCDate() + 7 * index);
    } else {
      date.setUTCMonth(date.getUTCMonth() + index);
    }

    const key = dateKey(date);
    const total = totals.get(key) ?? { records: 0, credits: 0 };
    const label =
      period === "daily"
        ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
        : period === "weekly"
        ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
        : date.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
    return { key, label, ...total };
  });
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safeText = typeof value === "string" && /^[\s]*[=+\-@]/.test(text)
    ? `'${text}`
    : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedModality, setSelectedModality] = useState("ALL");
  const [selectedInstance, setSelectedInstance] = useState("ALL");
  const [breakdownMode, setBreakdownMode] =
    useState<BreakdownMode>("modality");

  const loadAnalytics = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      setAnalytics(await api.getAnalytics());
    } catch (requestError) {
      const message = requestError as {
        response?: { data?: { detail?: string } };
        message?: string;
      };
      setError(
        message.response?.data?.detail ??
          message.message ??
          "Unable to load analytics from the portal database."
      );
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
        if (!active) return;
        const message = requestError as {
          response?: { data?: { detail?: string } };
          message?: string;
        };
        setError(
          message.response?.data?.detail ??
            message.message ??
            "Unable to load analytics from the portal database."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const modalities = analytics?.availableModalities ?? [];
  const instances = useMemo(
    () =>
      Array.from(
        new Set((analytics?.byInstance ?? []).map((row) => row.instanceCode))
      ).sort((a, b) => a.localeCompare(b)),
    [analytics]
  );

  const filteredRows = useMemo(
    () =>
      (analytics?.byInstance ?? []).filter(
        (row) =>
          (selectedModality === "ALL" ||
            row.modality.toLocaleUpperCase() ===
              selectedModality.toLocaleUpperCase()) &&
          (selectedInstance === "ALL" ||
            row.instanceCode === selectedInstance)
      ),
    [analytics, selectedInstance, selectedModality]
  );

  const breakdown = useMemo<AnalyticsRow[]>(() => {
    const grouped = new Map<string, AnalyticsRow>();
    for (const row of filteredRows) {
      const category =
        breakdownMode === "modality"
          ? row.modality
          : breakdownMode === "instance"
          ? row.instanceCode
          : `${row.modality} / ${row.instanceCode}`;
      const total = grouped.get(category) ?? {
        category,
        records: 0,
        credits: 0,
      };
      total.records += row.records;
      total.credits += row.credits;
      grouped.set(category, total);
    }
    return Array.from(grouped.values()).sort(
      (a, b) => b.records - a.records || a.category.localeCompare(b.category)
    );
  }, [breakdownMode, filteredRows]);

  const summary = useMemo(
    () => ({
      records: breakdown.reduce((total, row) => total + row.records, 0),
      credits: breakdown.reduce((total, row) => total + row.credits, 0),
      modalities: new Set(filteredRows.map((row) => row.modality)).size,
      instances: new Set(filteredRows.map((row) => row.instanceCode)).size,
    }),
    [breakdown, filteredRows]
  );

  const dailyTrend = useMemo(
    () => analytics && buildTrend(analytics, "daily", selectedModality, selectedInstance),
    [analytics, selectedInstance, selectedModality]
  );
  const weeklyTrend = useMemo(
    () => analytics && buildTrend(analytics, "weekly", selectedModality, selectedInstance),
    [analytics, selectedInstance, selectedModality]
  );
  const monthlyTrend = useMemo(
    () => analytics && buildTrend(analytics, "monthly", selectedModality, selectedInstance),
    [analytics, selectedInstance, selectedModality]
  );

  const downloadCsv = () => {
    const totalRecords = summary.records;
    const rows: Array<Array<string | number>> = [
      ["Metric", "Value"],
      ["Modality filter", selectedModality === "ALL" ? "All modalities" : selectedModality],
      ["Instance filter", selectedInstance === "ALL" ? "All instances" : selectedInstance],
      ["Saved records", summary.records],
      ["Credits used", summary.credits],
      [],
      ["Breakdown", "Category", "Records", "Credits", "Share of records"],
      ...breakdown.map((row) => [
        breakdownMode,
        row.category,
        row.records,
        row.credits,
        totalRecords ? `${((row.records / totalRecords) * 100).toFixed(1)}%` : "0.0%",
      ]),
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
    { label: "Saved records", value: summary.records },
    { label: "Credits used", value: summary.credits },
    { label: "Modalities", value: summary.modalities },
    { label: "Source instances", value: summary.instances },
  ];

  const trendCards = [
    { title: "Daily · last 30 days", data: dailyTrend ?? [] },
    { title: "Weekly · last 12 weeks", data: weeklyTrend ?? [] },
    { title: "Monthly · last 12 months", data: monthlyTrend ?? [] },
  ];

  return (
    <main className="analytics-page min-h-screen">
      <div className="analytics-content mx-auto max-w-7xl p-5 sm:p-6">
        <header className="analytics-topbar flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <Link
              to="/dashboard"
              className="mb-2 inline-flex text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              Back to dashboard
            </Link>
            <h1 className="text-xl font-bold text-slate-900">Sync analytics</h1>
            <p className="mt-1 text-xs text-slate-600">
              Record and credit trends, grouped by modality or source instance.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-semibold text-slate-600">
              Modality
              <select
                value={selectedModality}
                onChange={(event) => setSelectedModality(event.target.value)}
                className="ml-2 rounded border border-slate-300 bg-white px-2 py-2 text-xs"
              >
                <option value="ALL">All modalities</option>
                {modalities.map((modality) => (
                  <option key={modality} value={modality}>{modality}</option>
                ))}
              </select>
            </label>

            <label className="text-[11px] font-semibold text-slate-600">
              Instance
              <select
                value={selectedInstance}
                onChange={(event) => setSelectedInstance(event.target.value)}
                className="ml-2 rounded border border-slate-300 bg-white px-2 py-2 text-xs"
              >
                <option value="ALL">All instances</option>
                {instances.map((instance) => (
                  <option key={instance} value={instance}>{instance}</option>
                ))}
              </select>
            </label>

            {analytics?.lastUpdated && (
              <span className="px-1 text-[11px] text-slate-500">
                Updated {new Date(analytics.lastUpdated).toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={() => void loadAnalytics()}
              disabled={refreshing || loading}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={!breakdown.length}
              className="rounded bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Download CSV
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <strong>Analytics unavailable:</strong> {error}
          </div>
        )}

        {loading && !analytics ? (
          <p className="rounded border border-slate-200 bg-white p-5 text-sm text-slate-600">
            Loading saved portal data...
          </p>
        ) : analytics ? (
          <>
            <section
              className="analytics-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4"
              aria-label="Filtered analytics summary"
            >
              {cards.map(({ label, value }) => (
                <article key={label} className="analytics-kpi-card rounded border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-600">{label}</p>
                  <p className="mt-2 font-mono text-2xl font-bold text-slate-900">
                    {numberFormat.format(value)}
                  </p>
                </article>
              ))}
            </section>

            <section className="grid grid-cols-1 gap-3 lg:grid-cols-3" aria-label="Record trends">
              {trendCards.map(({ title, data }) => (
                <article key={title} className="analytics-chart-card min-w-0 rounded border border-slate-200 bg-white p-3">
                  <h2 className="mb-2 text-xs font-bold text-slate-800">{title}</h2>
                  <TrendChart data={data} title={title} />
                </article>
              ))}
            </section>

            <section className="analytics-breakdown overflow-x-auto rounded border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Records breakdown</h2>
                  <p className="mt-1 text-[11px] text-slate-600">
                    {numberFormat.format(summary.records)} records · {numberFormat.format(summary.credits)} credits
                  </p>
                </div>
                <label className="text-xs font-semibold text-slate-700">
                  Group by
                  <select
                    value={breakdownMode}
                    onChange={(event) => setBreakdownMode(event.target.value as BreakdownMode)}
                    className="ml-2 rounded border border-slate-300 bg-white px-2 py-2 text-xs"
                  >
                    <option value="modality">Modality</option>
                    <option value="instance">Instance</option>
                    <option value="modality-instance">Modality + instance</option>
                  </select>
                </label>
              </div>
              {breakdown.length ? (
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Category</th>
                      <th className="px-4 py-2 font-semibold">Records</th>
                      <th className="px-4 py-2 font-semibold">Credits</th>
                      <th className="px-4 py-2 font-semibold">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {breakdown.map((row) => (
                      <tr key={row.category} className="text-slate-700">
                        <td className="px-4 py-2 font-medium">{row.category}</td>
                        <td className="px-4 py-2">{numberFormat.format(row.records)}</td>
                        <td className="px-4 py-2">{numberFormat.format(row.credits)}</td>
                        <td className="px-4 py-2">
                          {summary.records
                            ? `${((row.records / summary.records) * 100).toFixed(1)}%`
                            : "0.0%"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-slate-600">
                  No records match the selected filters.
                </p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
