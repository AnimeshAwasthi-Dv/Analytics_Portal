import React, { useEffect, useState } from "react";
import {
  Database,
  CheckCircle2,
  RefreshCw,
  Clock,
  AlertOctagon,
  Activity,
  Radio,
  Zap,
  LogOut,
} from "lucide-react";
import { api } from "../services/api.ts";

interface DashboardKPIs {
  totalInstances: number;
  onlineInstances: number;
  recordsSynced: number;
  recordsPending: number | null;
  failedSyncs: number;
  apiStatus: string;
  avgResponseTime: string | null;
}

interface DashboardInstance {
  id: string;
  name: string;
  status: "Online" | "Delayed" | "Offline";
  lastSyncTime: string | null;
  recordsSynced: number;
  recordsPending: number | null;
  successRate: number;
  failedSyncs: number;
}

interface DashboardData {
  kpis: DashboardKPIs;
  instances: DashboardInstance[];
  lastUpdated: string;
}

interface DashboardPageProps {
  user?: {
    name?: string;
    email?: string;
  };
  onLogout?: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  user,
  onLogout,
}) => {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadDashboard = async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setRefreshing(true);
      }

      setError("");

      const data = await api.getDashboard();

      setDashboard(data);
    } catch (err: any) {
      console.error("Dashboard loading error:", err);

      setError(
        err?.response?.data?.detail ||
          "Unable to fetch dashboard data from the server."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboard();

    // Automatically refresh every 6 seconds
    const timer = setInterval(() => {
      loadDashboard();
    }, 6000);

    return () => clearInterval(timer);
  }, []);

  const formatNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return "—";
    }

    return value.toLocaleString();
  };

  const formatLastUpdated = (value: string) => {
    if (!value) {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleTimeString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-7 h-7 text-blue-600 animate-spin mx-auto mb-3" />

          <p className="text-sm font-semibold text-slate-700">
            Loading dashboard...
          </p>

          <p className="text-xs text-slate-400 mt-1">
            Fetching data from Central Sync Portal
          </p>
        </div>
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white border border-rose-200 rounded-xl p-6">
            <div className="flex items-center gap-3">
              <AlertOctagon className="w-6 h-6 text-rose-600" />

              <div>
                <h2 className="font-bold text-slate-900">
                  Unable to load dashboard
                </h2>

                <p className="text-sm text-slate-500 mt-1">
                  {error}
                </p>
              </div>
            </div>

            <button
              onClick={() => loadDashboard(true)}
              className="mt-5 flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const kpis = dashboard?.kpis;
  const instances = dashboard?.instances ?? [];

  const offlineInstances = instances.filter(
    (instance) => instance.status === "Offline"
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* HEADER */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center">
                <Radio className="w-5 h-5 text-blue-600 animate-pulse" />
              </div>

              <div>
                <h1 className="text-lg font-bold text-slate-900">
                  Centralized Synchronization Dashboard
                </h1>

                <p className="text-xs text-slate-500 mt-1">
                  Live data from the Central Sync Portal database
                </p>

                {user?.email && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Logged in as {user.email}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">

              <div className="text-right">
                <p className="text-[10px] text-slate-400">
                  Last Updated
                </p>

                <p className="text-xs font-mono font-semibold text-slate-700">
                  {formatLastUpdated(dashboard?.lastUpdated || "")}
                </p>
              </div>

              <button
                onClick={() => loadDashboard(true)}
                disabled={refreshing}
                className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg disabled:opacity-60"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    refreshing ? "animate-spin" : ""
                  }`}
                />

                {refreshing ? "Refreshing..." : "Refresh"}
              </button>

              {onLogout && (
                <button
                  onClick={onLogout}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Logout
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ERROR WHILE REFRESHING */}
        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-xs font-medium text-amber-800">
              {error}
            </p>
          </div>
        )}

        {/* OFFLINE ALERT */}
        {offlineInstances.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <AlertOctagon className="w-5 h-5 text-rose-600" />

              <div>
                <p className="text-sm font-bold text-rose-900">
                  {offlineInstances.length} instance
                  {offlineInstances.length > 1 ? "s" : ""} with no recent
                  sync activity
                </p>

                <p className="text-xs text-rose-700 mt-1">
                  {offlineInstances
                    .map((instance) => instance.name)
                    .join(", ")}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* KPI CARDS */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">

          {/* TOTAL INSTANCES */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Total Instances
              </span>

              <Database className="w-4 h-4 text-blue-600" />
            </div>

            <div className="mt-3">
              <p className="text-2xl font-bold text-slate-900">
                {kpis?.totalInstances ?? 0}
              </p>

              <p className="text-[11px] text-slate-400 mt-1">
                Registered API sources
              </p>
            </div>
          </div>

          {/* ONLINE */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Online
              </span>

              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>

            <div className="mt-3">
              <p className="text-2xl font-bold text-emerald-600 font-mono">
                {kpis?.onlineInstances ?? 0}
                <span className="text-sm text-slate-400">
                  {" "}
                  / {kpis?.totalInstances ?? 0}
                </span>
              </p>

              <p className="text-[11px] text-slate-400 mt-1">
                Recent sync activity
              </p>
            </div>
          </div>

          {/* RECORDS */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Records Synced
              </span>

              <RefreshCw className="w-4 h-4 text-indigo-600" />
            </div>

            <div className="mt-3">
              <p className="text-2xl font-bold text-slate-900 font-mono">
                {formatNumber(kpis?.recordsSynced)}
              </p>

              <p className="text-[11px] text-slate-400 mt-1">
                Central sync records
              </p>
            </div>
          </div>

          {/* PENDING */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Records Pending
              </span>

              <Clock className="w-4 h-4 text-amber-600" />
            </div>

            <div className="mt-3">
              <p className="text-2xl font-bold text-amber-600 font-mono">
                {formatNumber(kpis?.recordsPending)}
              </p>

              <p className="text-[11px] text-slate-400 mt-1">
                Not available in current DB
              </p>
            </div>
          </div>

          {/* FAILED */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Failed Syncs
              </span>

              <AlertOctagon className="w-4 h-4 text-rose-600" />
            </div>

            <div className="mt-3">
              <p className="text-2xl font-bold text-rose-600 font-mono">
                {formatNumber(kpis?.failedSyncs)}
              </p>

              <p className="text-[11px] text-slate-400 mt-1">
                Failed sync events
              </p>
            </div>
          </div>

          {/* API STATUS */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                API Status
              </span>

              <Activity className="w-4 h-4 text-emerald-600" />
            </div>

            <div className="mt-3">
              <p className="text-xl font-bold text-emerald-600 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />

                {kpis?.apiStatus ?? "UNKNOWN"}
              </p>

              <p className="text-[11px] text-slate-400 mt-1">
                Latency: {kpis?.avgResponseTime ?? "—"}
              </p>
            </div>
          </div>
        </div>

        {/* INSTANCE HEALTH */}
        <div className="space-y-3">

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600" />
              Database Instance Health
            </h2>

            <span className="text-xs text-slate-400">
              {instances.length} registered node
              {instances.length !== 1 ? "s" : ""}
            </span>
          </div>

          {instances.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
              <Database className="w-8 h-8 text-slate-300 mx-auto mb-2" />

              <p className="text-sm font-semibold text-slate-600">
                No database instances found
              </p>

              <p className="text-xs text-slate-400 mt-1">
                No API key/source is currently registered in the database.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">

              {instances.map((instance) => {
                const isOnline = instance.status === "Online";
                const isDelayed = instance.status === "Delayed";

                return (
                  <div
                    key={instance.id}
                    className={`bg-white rounded-xl border p-4 shadow-sm ${
                      isOnline
                        ? "border-slate-200"
                        : isDelayed
                        ? "border-amber-300 bg-amber-50/20"
                        : "border-rose-300 bg-rose-50/20"
                    }`}
                  >
                    {/* HEADER */}
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">

                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-slate-900 font-mono">
                          {instance.id}
                        </p>

                        <p className="text-xs text-slate-600 font-semibold truncate mt-0.5">
                          {instance.name}
                        </p>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 ${
                          isOnline
                            ? "bg-emerald-100 text-emerald-700"
                            : isDelayed
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isOnline
                              ? "bg-emerald-600"
                              : isDelayed
                              ? "bg-amber-600"
                              : "bg-rose-600"
                          }`}
                        />

                        {instance.status}
                      </span>
                    </div>

                    {/* METRICS */}
                    <div className="py-4 space-y-2 text-xs">

                      <div className="flex justify-between gap-3">
                        <span className="text-slate-500">
                          Last Sync
                        </span>

                        <strong className="text-slate-800 font-mono text-right">
                          {instance.lastSyncTime ?? "Never"}
                        </strong>
                      </div>

                      <div className="flex justify-between gap-3">
                        <span className="text-slate-500">
                          Records
                        </span>

                        <strong className="text-slate-900 font-mono">
                          {formatNumber(instance.recordsSynced)}
                        </strong>
                      </div>

                      <div className="flex justify-between gap-3">
                        <span className="text-slate-500">
                          Pending
                        </span>

                        <strong className="text-amber-600 font-mono">
                          {formatNumber(instance.recordsPending)}
                        </strong>
                      </div>

                      <div className="flex justify-between gap-3">
                        <span className="text-slate-500">
                          Success Rate
                        </span>

                        <strong className="text-emerald-600 font-mono">
                          {instance.successRate}%
                        </strong>
                      </div>

                      <div className="flex justify-between gap-3">
                        <span className="text-slate-500">
                          Failed
                        </span>

                        <strong className="text-rose-600 font-mono">
                          {instance.failedSyncs}
                        </strong>
                      </div>
                    </div>

                    {/* FOOTER */}
                    <div className="pt-3 border-t border-slate-100">
                      <p className="text-[10px] text-slate-400">
                        Status is inferred from recent sync activity.
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};