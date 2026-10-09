import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Database,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api, type TrafficAnalyticsData, type TrafficPeriod } from "../services/api.ts";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export function TrafficAnalyticsPage() {
  const [period, setPeriod] = useState<TrafficPeriod>("30d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [analytics, setAnalytics] = useState<TrafficAnalyticsData | null>(null);
  const [loadedRequest, setLoadedRequest] = useState("");
  const [error, setError] = useState("");

  const customRangeReady = period !== "custom" || Boolean(startDate && endDate);
  const requestKey = `${period}:${startDate}:${endDate}:${refreshCount}`;
  const loading = customRangeReady && loadedRequest !== requestKey;

  useEffect(() => {
    if (!customRangeReady) return;

    let cancelled = false;
    void api
      .getTrafficAnalytics({ period, startDate, endDate })
      .then((result) => {
        if (cancelled) return;
        setAnalytics(result);
        setError("");
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        const message = requestError as {
          response?: { data?: { detail?: string } };
          message?: string;
        };
        setError(
          message.response?.data?.detail ??
            message.message ??
            "Unable to load traffic analytics."
        );
      })
      .finally(() => {
        if (!cancelled) setLoadedRequest(requestKey);
      });

    return () => {
      cancelled = true;
    };
  }, [customRangeReady, endDate, period, requestKey, startDate]);

  const summary = analytics?.overview;
  const cards = [
    {
      label: "Total requests",
      value: summary?.totalRequests.toLocaleString() ?? "0",
      detail: "Requests in selected range",
      icon: Activity,
      tone: "text-cyan-700 bg-cyan-50",
    },
    {
      label: "Total data",
      value: formatBytes(summary?.totalDataBytes ?? 0),
      detail: "Request and response bytes",
      icon: Database,
      tone: "text-emerald-700 bg-emerald-50",
    },
    {
      label: "Highest traffic instance",
      value: summary?.highestTrafficInstance?.name ?? "No traffic",
      detail: summary?.highestTrafficInstance
        ? formatBytes(summary.highestTrafficInstance.totalDataBytes)
        : "No instance traffic in range",
      icon: ArrowUpWideNarrow,
      tone: "text-amber-700 bg-amber-50",
    },
    {
      label: "Active instances",
      value: summary?.activeInstances.toLocaleString() ?? "0",
      detail: summary?.lowestTrafficInstance
        ? `Lowest: ${summary.lowestTrafficInstance.name} (${formatBytes(summary.lowestTrafficInstance.totalDataBytes)})`
        : "Instances with requests in range",
      icon: ArrowDownWideNarrow,
      tone: "text-blue-700 bg-blue-50",
    },
  ];

  const dailyChart = (analytics?.daily ?? []).map((row) => ({
    ...row,
    dataMB: row.totalDataBytes / (1024 * 1024),
  }));
  const instanceChart = (analytics?.instances ?? []).map((row) => ({
    ...row,
    dataMB: row.totalDataBytes / (1024 * 1024),
  }));
  const routeChart = (analytics?.routes ?? []).slice(0, 10).map((row) => ({
    ...row,
    dataMB: row.totalDataBytes / (1024 * 1024),
    routeLabel: row.route,
  }));
  const routeHighlights = analytics?.routeHighlights;

  return (
    <main className="min-h-screen bg-slate-50 p-5 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase text-emerald-700">Monitoring</p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">Traffic analytics</h1>
            <p className="mt-1 text-xs text-slate-500">Request volume and data transfer by source and route</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-semibold text-slate-600">
              Date range
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as TrafficPeriod)}
                className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-2 text-xs text-slate-800"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {period === "custom" && (
              <>
                <label className="text-[11px] font-semibold text-slate-600">
                  From
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-[7px] text-xs text-slate-800"
                  />
                </label>
                <label className="text-[11px] font-semibold text-slate-600">
                  To
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-[7px] text-xs text-slate-800"
                  />
                </label>
              </>
            )}
            <button
              type="button"
              title="Refresh traffic analytics"
              aria-label="Refresh traffic analytics"
              onClick={() => setRefreshCount((count) => count + 1)}
              disabled={loading}
              className="grid h-9 w-9 place-items-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {error && !loading && (
          <div role="alert" className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div><strong>Traffic analytics unavailable</strong><p className="mt-1">{error}</p></div>
          </div>
        )}

        {period === "custom" && (!startDate || !endDate) && (
          <p className="text-sm text-slate-500">Select both dates to load traffic data.</p>
        )}

        <section aria-label="Traffic summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(({ label, value, detail, icon: Icon, tone }) => (
            <article key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-500">{label}</span>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${tone}`}><Icon className="h-4 w-4" /></span>
              </div>
              <p className="mt-3 truncate text-xl font-bold text-slate-900" title={value}>{loading ? "..." : value}</p>
              <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
            </article>
          ))}
        </section>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-700" />Loading traffic data...
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-4 text-sm font-bold text-slate-900">Daily traffic trend</h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyChart} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                      <CartesianGrid stroke="#e8ede9" vertical={false} />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} />
                      <YAxis yAxisId="requests" allowDecimals={false} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="data" orientation="right" tickLine={false} axisLine={false} />
                      <Tooltip />
                      <Line yAxisId="requests" type="monotone" dataKey="requests" name="Requests" stroke="#197455" strokeWidth={2} dot={false} />
                      <Line yAxisId="data" type="monotone" dataKey="dataMB" name="Data (MB)" stroke="#c47a28" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-4 text-sm font-bold text-slate-900">Data volume by instance</h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={instanceChart} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                      <CartesianGrid stroke="#e8ede9" vertical={false} />
                      <XAxis dataKey="instance" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value) => [`${Number(value).toFixed(2)} MB`, "Data"]} />
                      <Bar dataKey="dataMB" name="Data (MB)" fill="#277d8a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
                <h2 className="mb-4 text-sm font-bold text-slate-900">Routes by data volume</h2>
                <div className="mb-3 grid grid-cols-1 gap-1 text-[11px] text-slate-500 sm:grid-cols-2">
                  <p>Most data: {routeHighlights?.highestTrafficRoute?.route ?? "None"} ({formatBytes(routeHighlights?.highestTrafficRoute?.totalDataBytes ?? 0)})</p>
                  <p>Least data: {routeHighlights?.lowestTrafficRoute?.route ?? "None"} ({formatBytes(routeHighlights?.lowestTrafficRoute?.totalDataBytes ?? 0)})</p>
                  <p>Most requests: {routeHighlights?.mostRequestsRoute?.route ?? "None"} ({routeHighlights?.mostRequestsRoute?.requests.toLocaleString() ?? 0})</p>
                  <p>Fewest requests: {routeHighlights?.fewestRequestsRoute?.route ?? "None"} ({routeHighlights?.fewestRequestsRoute?.requests.toLocaleString() ?? 0})</p>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={routeChart} margin={{ top: 4, right: 16, bottom: 36, left: 8 }}>
                      <CartesianGrid stroke="#e8ede9" vertical={false} />
                      <XAxis dataKey="routeLabel" interval={0} angle={-25} textAnchor="end" height={68} tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value) => [`${Number(value).toFixed(2)} MB`, "Data"]} />
                      <Bar dataKey="dataMB" name="Data (MB)" fill="#bd812a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>
            </section>

            <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-bold text-slate-900">Instance and route breakdown</h2>
              </div>
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Instance</th>
                    <th className="px-4 py-3 font-semibold">Route</th>
                    <th className="px-4 py-3 font-semibold">Requests</th>
                    <th className="px-4 py-3 font-semibold">Total data</th>
                    <th className="px-4 py-3 font-semibold">Avg response</th>
                    <th className="px-4 py-3 font-semibold">Success rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(analytics?.details ?? []).map((row) => (
                    <tr key={`${row.instance}-${row.route}`} className="text-slate-700">
                      <td className="px-4 py-3 font-semibold">{row.instance}</td>
                      <td className="px-4 py-3 font-mono">{row.route}</td>
                      <td className="px-4 py-3">{row.requests.toLocaleString()}</td>
                      <td className="px-4 py-3">{formatBytes(row.totalDataBytes)}</td>
                      <td className="px-4 py-3">{row.averageResponseTimeMs.toLocaleString()} ms</td>
                      <td className="px-4 py-3">{row.successRate.toFixed(1)}%</td>
                    </tr>
                  ))}
                  {!analytics?.details.length && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No traffic recorded for this range.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </main>
  );
}