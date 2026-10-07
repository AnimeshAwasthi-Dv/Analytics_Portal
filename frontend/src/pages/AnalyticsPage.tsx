import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  Coins,
  Database,
  RefreshCw,
  ScanLine,
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

import { api } from "../services/api.ts";
import type { AnalyticsResponse } from "../types";

type ModalityFilter = "ALL" | string;

export function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedModality, setSelectedModality] =
    useState<ModalityFilter>("ALL");

  async function loadAnalytics(isRefresh = false) {
    if (isRefresh) {
      setRefreshing(true);
    }

    setError("");

    try {
      const response = await api.getAnalytics();
      setAnalytics(response);

      /*
       * If the currently selected modality no longer exists
       * after refreshing the database data, reset the filter.
       */
      if (selectedModality !== "ALL") {
        const availableModalities = new Set(
          (response.byModality ?? [])
            .map((row) => row.modality?.trim())
            .filter(Boolean)
        );

        if (!availableModalities.has(selectedModality)) {
          setSelectedModality("ALL");
        }
      }
    } catch (requestError) {
      const message = requestError as {
        response?: {
          data?: {
            detail?: string;
          };
        };
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
  }

  useEffect(() => {
    void loadAnalytics();
  }, []);

  /*
   * Get modalities directly from the data returned by the backend.
   *
   * No XR / CT / MRI values are hardcoded here.
   */
  const availableModalities = useMemo(() => {
    const modalities = new Map<string, string>();

    for (const row of analytics?.byModality ?? []) {
      const rawModality = row.modality?.trim();

      if (!rawModality) {
        continue;
      }

      const normalized = rawModality.toUpperCase();

      if (!modalities.has(normalized)) {
        modalities.set(normalized, rawModality);
      }
    }

    return Array.from(modalities.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, modality]) => modality);
  }, [analytics]);

  /*
   * Generic modality matching.
   *
   * This does not assume which modalities exist.
   */
  const matchesModality = (modality: string) => {
    if (selectedModality === "ALL") {
      return true;
    }

    return (
      modality.trim().toUpperCase() ===
      selectedModality.trim().toUpperCase()
    );
  };

  /*
   * Filter modality analytics using the selected database modality.
   */
  const modalityRows = useMemo(() => {
    return (analytics?.byModality ?? []).filter((row) =>
      matchesModality(row.modality)
    );
  }, [analytics, selectedModality]);

  /*
   * Aggregate daily records and credits.
   */
  const dailyData = useMemo(() => {
    const dailyTotals = new Map<
      string,
      {
        date: string;
        records: number;
        credits: number;
      }
    >();

    for (const row of (analytics?.daily ?? []).filter((entry) =>
      matchesModality(entry.modality)
    )) {
      const total = dailyTotals.get(row.date) ?? {
        date: row.date,
        records: 0,
        credits: 0,
      };

      total.records += row.records;
      total.credits += row.credits;

      dailyTotals.set(row.date, total);
    }

    return Array.from(dailyTotals.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }, [analytics, selectedModality]);

  /*
   * Aggregate records and credits by source instance.
   */
  const instanceData = useMemo(() => {
    const instanceTotals = new Map<
      string,
      {
        instanceCode: string;
        records: number;
        credits: number;
      }
    >();

    for (const row of (analytics?.byInstance ?? []).filter((entry) =>
      matchesModality(entry.modality)
    )) {
      const key = row.instanceCode?.trim() || "Unknown";

      const total = instanceTotals.get(key) ?? {
        instanceCode: key,
        records: 0,
        credits: 0,
      };

      total.records += row.records;
      total.credits += row.credits;

      instanceTotals.set(key, total);
    }

    return Array.from(instanceTotals.values()).sort(
      (a, b) => b.records - a.records
    );
  }, [analytics, selectedModality]);

  /*
   * Summary values are calculated from actual API data.
   */
  const selectedRecordCount = useMemo(
    () =>
      modalityRows.reduce(
        (total, row) => total + row.records,
        0
      ),
    [modalityRows]
  );

  const selectedCredits = useMemo(
    () =>
      modalityRows.reduce(
        (total, row) => total + row.credits,
        0
      ),
    [modalityRows]
  );

  const selectedModalityCount =
    selectedModality === "ALL"
      ? availableModalities.length
      : modalityRows.length > 0
      ? 1
      : 0;

  const cards = [
    {
      label: "Saved records",
      value: selectedRecordCount,
      icon: Database,
      tone: "text-emerald-700 bg-emerald-50",
    },
    {
      label: "Credits used",
      value: selectedCredits,
      icon: Coins,
      tone: "text-amber-700 bg-amber-50",
    },
    {
      label: "Modalities",
      value: selectedModalityCount,
      icon: ScanLine,
      tone: "text-cyan-700 bg-cyan-50",
    },
    {
      label: "Source instances",
      value: instanceData.length,
      icon: Activity,
      tone: "text-blue-700 bg-blue-50",
    },
  ];

  return (
    <main className="analytics-page min-h-screen">
      <div className="analytics-content mx-auto max-w-7xl p-5 sm:p-6">
        {/* Header */}
        <header className="analytics-topbar flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <Link
              to="/dashboard"
              className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Dashboard
            </Link>

            <h1 className="text-xl font-bold text-slate-900">
              Sync analytics
            </h1>

            <p className="mt-1 text-xs text-slate-500">
              Calculated from synchronization records saved in the portal
              database.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Dynamic modality filter */}
            <label className="text-[11px] font-semibold text-slate-600">
              Modality

              <select
                value={selectedModality}
                onChange={(event) =>
                  setSelectedModality(event.target.value)
                }
                className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-2 text-xs text-slate-800"
              >
                <option value="ALL">All modalities</option>

                {availableModalities.map((modality) => (
                  <option key={modality} value={modality}>
                    {modality}
                  </option>
                ))}
              </select>
            </label>

            {analytics?.lastUpdated && (
              <p className="text-right text-[11px] text-slate-500">
                Updated
                <br />
                {new Date(analytics.lastUpdated).toLocaleString()}
              </p>
            )}

            <button
              type="button"
              onClick={() => void loadAnalytics(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  refreshing ? "animate-spin" : ""
                }`}
              />

              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
          >
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />

            <div>
              <strong>Analytics unavailable</strong>

              <p className="mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-emerald-700" />

            Loading saved portal data...
          </div>
        ) : analytics ? (
          <>
            {/* Summary Cards */}
            <section
              className="analytics-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
              aria-label="Analytics summary"
            >
              {cards.map(
                ({ label, value, icon: Icon, tone }) => (
                  <article
                    key={label}
                    className="analytics-kpi-card rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-500">
                        {label}
                      </span>

                      <span
                        className={`grid h-9 w-9 place-items-center rounded-md ${tone}`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                    </div>

                    <p className="mt-3 font-mono text-2xl font-bold text-slate-900">
                      {value.toLocaleString()}
                    </p>
                  </article>
                )
              )}
            </section>

            {/* No Data */}
            {selectedRecordCount === 0 ? (
              <section className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                <Database className="mx-auto mb-3 h-8 w-8 text-slate-300" />

                <h2 className="font-semibold text-slate-800">
                  No records for{" "}
                  {selectedModality === "ALL"
                    ? "the selected range"
                    : selectedModality}
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Choose another modality or refresh after new payloads
                  are saved.
                </p>
              </section>
            ) : (
              <>
                {/* Charts */}
                <section className="analytics-chart-grid grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {/* Records by Modality */}
                  <article className="analytics-chart-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h2 className="mb-4 text-sm font-bold text-slate-900">
                      Records by modality
                    </h2>

                    <div className="h-72">
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                      >
                        <BarChart
                          data={modalityRows}
                          margin={{
                            top: 4,
                            right: 16,
                            bottom: 4,
                            left: 8,
                          }}
                        >
                          <CartesianGrid
                            stroke="#e8ede9"
                            vertical={false}
                          />

                          <XAxis
                            dataKey="modality"
                            tickLine={false}
                            axisLine={false}
                          />

                          <YAxis
                            allowDecimals={false}
                            tickLine={false}
                            axisLine={false}
                          />

                          <Tooltip />

                          <Bar
                            dataKey="records"
                            name="Saved records"
                            fill="#197455"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </article>

                  {/* Records by Date */}
                  <article className="analytics-chart-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h2 className="mb-4 text-sm font-bold text-slate-900">
                      Records by processing date
                    </h2>

                    <div className="h-72">
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                      >
                        <LineChart
                          data={dailyData}
                          margin={{
                            top: 4,
                            right: 16,
                            bottom: 4,
                            left: 8,
                          }}
                        >
                          <CartesianGrid
                            stroke="#e8ede9"
                            vertical={false}
                          />

                          <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                          />

                          <YAxis
                            allowDecimals={false}
                            tickLine={false}
                            axisLine={false}
                          />

                          <Tooltip />

                          <Line
                            type="monotone"
                            dataKey="records"
                            name="Saved records"
                            stroke="#277d8a"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </article>

                  {/* Records by Instance */}
                  <article className="analytics-chart-card rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
                    <h2 className="mb-4 text-sm font-bold text-slate-900">
                      Records by source instance
                    </h2>

                    <div className="h-72">
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                      >
                        <BarChart
                          data={instanceData}
                          margin={{
                            top: 4,
                            right: 16,
                            bottom: 4,
                            left: 8,
                          }}
                        >
                          <CartesianGrid
                            stroke="#e8ede9"
                            vertical={false}
                          />

                          <XAxis
                            dataKey="instanceCode"
                            tickLine={false}
                            axisLine={false}
                          />

                          <YAxis
                            allowDecimals={false}
                            tickLine={false}
                            axisLine={false}
                          />

                          <Tooltip />

                          <Bar
                            dataKey="records"
                            name="Saved records"
                            fill="#bd812a"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </article>
                </section>

                {/* Modality Breakdown */}
                <section className="analytics-breakdown overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <h2 className="text-sm font-bold text-slate-900">
                      Modality breakdown
                    </h2>
                  </div>

                  <table className="w-full min-w-[540px] text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">
                          Modality
                        </th>

                        <th className="px-4 py-3 font-semibold">
                          Records
                        </th>

                        <th className="px-4 py-3 font-semibold">
                          Credits
                        </th>

                        <th className="px-4 py-3 font-semibold">
                          Share
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {modalityRows.map((row) => (
                        <tr
                          key={row.modality}
                          className="text-slate-700"
                        >
                          <td className="px-4 py-3 font-semibold">
                            {row.modality}
                          </td>

                          <td className="px-4 py-3">
                            {row.records.toLocaleString()}
                          </td>

                          <td className="px-4 py-3">
                            {row.credits.toLocaleString()}
                          </td>

                          <td className="px-4 py-3">
                            {selectedRecordCount > 0
                              ? (
                                  (row.records /
                                    selectedRecordCount) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}