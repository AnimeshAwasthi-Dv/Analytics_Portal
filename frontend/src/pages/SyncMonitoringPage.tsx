import React, { useEffect, useState } from "react";
import {
  RefreshCw,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  Pause,
  Play,
  Activity,
  Layers,
} from "lucide-react";
import { api } from "../services/api.ts";

interface SyncMonitorItem {
  syncId: string;
  instanceId: string;
  startedAt: string;
  completedAt: string;
  records: number;
  duration: string;
  status: "SUCCESS" | "PROCESSING" | "PENDING" | "FAILED";
  errorCount: number;
}

export const SyncMonitoringPage: React.FC = () => {
  const [selectedInstance, setSelectedInstance] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [syncs, setSyncs] = useState<SyncMonitorItem[]>([]);

  const mockSyncList: SyncMonitorItem[] = [
    { syncId: "SYNC-8921", instanceId: "DB-01", startedAt: "10:20:10", completedAt: "10:20:15", records: 120, duration: "5.0s", status: "SUCCESS", errorCount: 0 },
    { syncId: "SYNC-8920", instanceId: "DB-02", startedAt: "10:20:05", completedAt: "10:20:11", records: 83, duration: "6.0s", status: "SUCCESS", errorCount: 0 },
    { syncId: "SYNC-8919", instanceId: "DB-03", startedAt: "10:19:50", completedAt: "10:19:58", records: 340, duration: "8.0s", status: "SUCCESS", errorCount: 0 },
    { syncId: "SYNC-8918", instanceId: "DB-04", startedAt: "10:19:35", completedAt: "10:19:43", records: 72, duration: "8.0s", status: "SUCCESS", errorCount: 0 },
    { syncId: "SYNC-8917", instanceId: "DB-05", startedAt: "10:19:20", completedAt: "10:19:31", records: 91, duration: "11.0s", status: "SUCCESS", errorCount: 0 },
    { syncId: "SYNC-8916", instanceId: "DB-03", startedAt: "10:18:10", completedAt: "10:18:15", records: 0, duration: "5.0s", status: "FAILED", errorCount: 2 },
    { syncId: "SYNC-8915", instanceId: "DB-01", startedAt: "10:17:00", completedAt: "—", records: 15, duration: "In progress", status: "PROCESSING", errorCount: 0 },
    { syncId: "SYNC-8914", instanceId: "DB-02", startedAt: "10:16:30", completedAt: "—", records: 0, duration: "Queued", status: "PENDING", errorCount: 0 },
  ];

  const refreshData = () => {
    setSyncs(mockSyncList);
    setLastUpdated(new Date().toTimeString().split(" ")[0]);
  };

  useEffect(() => {
    refreshData();
    let interval: any;
    if (autoRefresh) {
      interval = setInterval(refreshData, 4000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const filtered = syncs.filter((item) => {
    const matchInst = selectedInstance === "ALL" || item.instanceId === selectedInstance;
    const matchStat = selectedStatus === "ALL" || item.status === selectedStatus;
    return matchInst && matchStat;
  });

  return (
    <div className="space-y-5 pb-12">
      {/* Top Banner & Filters */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-600" />
              Real-time Ingestion & Sync Monitor
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Continuous live telemetry across all 5 localized Sync Agents streaming into Central API
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500 flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
              <span>Last updated: <strong className="font-mono text-slate-800">{lastUpdated || "10:20:20"}</strong></span>
              <span className="text-slate-300">|</span>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className="flex items-center gap-1 text-blue-600 font-semibold hover:underline"
              >
                {autoRefresh ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                Auto refresh: {autoRefresh ? "ON" : "OFF"}
              </button>
            </div>
            <button
              onClick={refreshData}
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100">
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Source Instance
            </label>
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="ALL">All 5 Instances</option>
              <option value="DB-01">DB-01 (Ahmedabad)</option>
              <option value="DB-02">DB-02 (Delhi)</option>
              <option value="DB-03">DB-03 (Mumbai)</option>
              <option value="DB-04">DB-04 (Bangalore)</option>
              <option value="DB-05">DB-05 (Chennai)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Batch Status
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="PROCESSING">PROCESSING</option>
              <option value="PENDING">PENDING</option>
              <option value="FAILED">FAILED</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Date Range
            </label>
            <select className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
              <option>Live Window (Today)</option>
              <option>Past 24 Hours</option>
              <option>Past 7 Days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Sync Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            <tr>
              <th className="py-3 px-4">Sync ID</th>
              <th className="py-3 px-4">Source Instance</th>
              <th className="py-3 px-4">Started At</th>
              <th className="py-3 px-4">Completed At</th>
              <th className="py-3 px-4 text-right">Records Synced</th>
              <th className="py-3 px-4">Duration</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-right">Error Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filtered.map((item) => (
              <tr key={item.syncId} className="hover:bg-slate-50/80 transition-colors">
                <td className="py-3 px-4 font-mono font-bold text-slate-900">{item.syncId}</td>
                <td className="py-3 px-4">
                  <span className="font-mono font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    {item.instanceId}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono text-slate-700">{item.startedAt}</td>
                <td className="py-3 px-4 font-mono text-slate-700">{item.completedAt}</td>
                <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900">
                  {item.records}
                </td>
                <td className="py-3 px-4 font-mono text-slate-600">{item.duration}</td>
                <td className="py-3 px-4 text-center">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      item.status === "SUCCESS"
                        ? "bg-emerald-100 text-emerald-800"
                        : item.status === "PROCESSING"
                        ? "bg-blue-100 text-blue-800 animate-pulse"
                        : item.status === "PENDING"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    {item.status}
                  </span>
                </td>
                <td className="py-3 px-4 text-right font-mono font-bold text-slate-700">
                  {item.errorCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
