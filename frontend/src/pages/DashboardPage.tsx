import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Database,
  CheckCircle2,
  RefreshCw,
  Clock,
  AlertOctagon,
  Activity,
  ArrowUpRight,
  Wifi,
  Radio,
  Zap,
} from "lucide-react";
import { api } from "../services/api.ts";
import { DatabaseInstance, SystemKPIs } from "../types";
import { SyncFlowVisualization } from "../Components/SyncFlowVisualization";

export const DashboardPage: React.FC = () => {
  const [kpis, setKpis] = useState<SystemKPIs | null>(null);
  const [instances, setInstances] = useState<DatabaseInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const loadData = async () => {
    try {
      const [kpiData, instanceData] = await Promise.all([
        api.getKPIs(),
        api.getInstances(),
      ]);
      setKpis(kpiData);
      setInstances(instanceData);
      setLastUpdated(new Date().toTimeString().split(" ")[0]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 6000);
    return () => clearInterval(timer);
  }, []);

  const handleManualSync = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncingId(id);
    try {
      await api.triggerSync(id);
      await loadData();
    } finally {
      setSyncingId(null);
    }
  };

  const offlineInstance = instances.find((i) => i.status === "Offline");

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner & Refresh State */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">
              Centralized Synchronization Dashboard
            </h2>
            <p className="text-xs text-slate-500">
              Aggregating live ingestion streams from 5 regional hospital PACS/EHR databases
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          <div className="text-right text-xs">
            <span className="text-slate-400">Last Synced: </span>
            <span className="font-mono font-medium text-slate-700">{lastUpdated || "Syncing..."}</span>
          </div>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors border border-slate-300"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Offline Alert if any instance goes down */}
      {offlineInstance && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertOctagon className="w-5 h-5 text-rose-600 shrink-0" />
            <div>
              <p className="font-bold text-xs">{offlineInstance.name} ({offlineInstance.id}) is OFFLINE</p>
              <p className="text-[11px] text-rose-700">
                Last successful sync: {offlineInstance.lastSyncTime} • Failed attempts: {offlineInstance.failedSyncs}
              </p>
            </div>
          </div>
          <button
            onClick={(e) => handleManualSync(offlineInstance.id, e)}
            className="px-3 py-1.5 text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 rounded-lg shadow-sm"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Top 6 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {/* Card 1 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Total DB Instances</span>
            <Database className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900">{kpis?.totalInstances ?? 5}</div>
            <span className="text-[11px] text-slate-400">Independent Nodes</span>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Online Instances</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-600 font-mono">
              {kpis?.onlineInstances ?? 5} / {kpis?.totalInstances ?? 5}
            </div>
            <span className="text-[11px] text-emerald-600 font-semibold">100% Operational</span>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Records Synced</span>
            <RefreshCw className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 font-mono">
              {kpis?.recordsSynced.toLocaleString() ?? "1,248,560"}
            </div>
            <span className="text-[11px] text-slate-400">Total Central Ingest</span>
          </div>
        </div>

        {/* Card 4 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Records Pending</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-600 font-mono">
              {kpis?.recordsPending.toLocaleString() ?? "2,341"}
            </div>
            <span className="text-[11px] text-slate-400">Queued in source DBs</span>
          </div>
        </div>

        {/* Card 5 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">Failed Syncs</span>
            <AlertOctagon className="w-4 h-4 text-rose-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-rose-600 font-mono">
              {kpis?.failedSyncs ?? "17"}
            </div>
            <span className="text-[11px] text-rose-500 font-semibold">Requires Attention</span>
          </div>
        </div>

        {/* Card 6 */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium">API Status</span>
            <Activity className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <div className="text-xl font-bold text-emerald-600 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              {kpis?.apiStatus ?? "ONLINE"}
            </div>
            <span className="text-[11px] text-slate-400 font-mono">Lat: {kpis?.avgResponseTime ?? "84ms"}</span>
          </div>
        </div>
      </div>

      {/* Visual Architecture Section */}
      <SyncFlowVisualization instances={instances} />

      {/* DATABASE INSTANCE HEALTH (5 Cards) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600" />
            Database Instance Health (5 Nodes)
          </h3>
          <Link
            to="/instances"
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            Manage Instances <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {instances.map((inst) => {
            const isOnline = inst.status === "Online";
            const isDelayed = inst.status === "Delayed";

            return (
              <div
                key={inst.id}
                className={`bg-white rounded-xl border p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between ${
                  isOnline
                    ? "border-slate-200"
                    : isDelayed
                    ? "border-amber-300 bg-amber-50/20"
                    : "border-rose-300 bg-rose-50/20"
                }`}
              >
                <div>
                  {/* Header */}
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div>
                      <span className="text-xs font-extrabold text-slate-900 font-mono">{inst.id}</span>
                      <p className="text-xs text-slate-600 font-semibold truncate max-w-[130px]">{inst.name}</p>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        isOnline
                          ? "bg-emerald-100 text-emerald-700"
                          : isDelayed
                          ? "bg-amber-100 text-amber-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isOnline ? "bg-emerald-600" : isDelayed ? "bg-amber-600" : "bg-rose-600"
                        }`}
                      ></span>
                      {inst.status}
                    </span>
                  </div>

                  {/* Body Metrics */}
                  <div className="py-3 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-500">
                      <span>Last Sync:</span>
                      <strong className="text-slate-800 font-mono">{inst.lastSyncTime}</strong>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Records Synced:</span>
                      <strong className="text-slate-900 font-mono">{inst.recordsSynced.toLocaleString()}</strong>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Pending:</span>
                      <strong className="text-amber-600 font-mono">{inst.recordsPending}</strong>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Success Rate:</span>
                      <strong className="text-emerald-600 font-mono">{inst.successRate}%</strong>
                    </div>
                  </div>
                </div>

                {/* Footer Action */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                  <Link
                    to={`/instances/${inst.id}`}
                    className="text-[11px] font-semibold text-blue-600 hover:underline"
                  >
                    View Details
                  </Link>
                  <button
                    disabled={syncingId === inst.id || !isOnline}
                    onClick={(e) => handleManualSync(inst.id, e)}
                    className="px-2 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors disabled:opacity-50"
                  >
                    {syncingId === inst.id ? "Syncing..." : "Sync Now"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
