import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Database,
  ArrowLeft,
  Server,
  Activity,
  CheckCircle2,
  RefreshCw,
  Clock,
  AlertTriangle,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { api } from "../services/api";
import { DatabaseInstance, SyncHistoryItem } from "../types";

export const InstanceDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [instance, setInstance] = useState<DatabaseInstance | null>(null);
  const [history, setHistory] = useState<SyncHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadDetails = async () => {
    if (!id) return;
    try {
      const data = await api.getInstanceById(id);
      const hist = await api.getInstanceSyncHistory(id);
      setInstance(data);
      setHistory(hist);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetails();
  }, [id]);

  const handleManualSync = async () => {
    if (!id) return;
    setSyncing(true);
    try {
      const res = await api.triggerSync(id);
      setStatusMsg(res.message);
      await loadDetails();
      setTimeout(() => setStatusMsg(null), 4000);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-xs text-slate-500">Loading instance details...</div>;
  }

  if (!instance) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-sm font-semibold text-slate-800">Database instance not found.</p>
        <Link to="/instances" className="text-xs text-blue-600 underline">
          Back to Database Instances
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4">
          <Link
            to="/instances"
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">{instance.name}</h2>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-200">
                {instance.id}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Client Code: <strong className="font-mono text-slate-700">{instance.clientCode}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Trigger Manual Sync"}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          {statusMsg}
        </div>
      )}

      {/* Grid: Instance Overview & Sync Agent Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Node Details */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-600" />
            Database Node Specifications
          </h3>

          <div className="divide-y divide-slate-100 text-xs">
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Instance ID:</span>
              <span className="font-bold text-slate-900 font-mono">{instance.id}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Instance Name:</span>
              <span className="font-medium text-slate-800">{instance.name}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Engine / Connection:</span>
              <span className="font-mono text-slate-800">PostgreSQL 15.4</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Host IP:</span>
              <span className="font-mono text-slate-800">{instance.host}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Database Port:</span>
              <span className="font-mono text-slate-800">{instance.port}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Database Name:</span>
              <span className="font-mono text-slate-800">{instance.database}</span>
            </div>
            <div className="py-2.5 flex justify-between items-center">
              <span className="text-slate-500">Database Health:</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                {instance.status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Sync Agent & Heartbeat Details */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-600" />
            Sync Agent Daemon State
          </h3>

          <div className="divide-y divide-slate-100 text-xs">
            <div className="py-2.5 flex justify-between items-center">
              <span className="text-slate-500">Sync Agent Status:</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-900 text-blue-400 font-mono">
                {instance.syncAgentStatus.toUpperCase()}
              </span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Last Heartbeat:</span>
              <span className="font-mono text-slate-800 font-semibold">{instance.lastHeartbeat}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Last Successful Sync:</span>
              <span className="font-mono text-emerald-600 font-bold">{instance.lastSyncTime}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Target Ingestion API:</span>
              <span className="font-mono text-blue-600 text-[11px]">https://central-api/v1/sync</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Heartbeat Interval:</span>
              <span className="font-mono text-slate-800">10 seconds</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Batch Size Limit:</span>
              <span className="font-mono text-slate-800">50 records / payload</span>
            </div>
          </div>
        </div>
      </div>

      {/* SYNC STATISTICS */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
          Sync Statistics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-[11px] text-slate-400 block">Total Records</span>
            <span className="text-xl font-bold text-slate-900 font-mono">
              {(instance.recordsSynced + instance.recordsPending).toLocaleString()}
            </span>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-[11px] text-slate-400 block">Synced</span>
            <span className="text-xl font-bold text-emerald-600 font-mono">
              {instance.recordsSynced.toLocaleString()}
            </span>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-[11px] text-slate-400 block">Pending</span>
            <span className="text-xl font-bold text-amber-600 font-mono">
              {instance.recordsPending}
            </span>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-[11px] text-slate-400 block">Failed</span>
            <span className="text-xl font-bold text-rose-600 font-mono">
              {instance.failedSyncs}
            </span>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-[11px] text-slate-400 block">Last 24 Hours</span>
            <span className="text-xl font-bold text-blue-600 font-mono">
              {instance.totalRecords24h.toLocaleString()}
            </span>
          </div>
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-[11px] text-slate-400 block">Last 7 Days</span>
            <span className="text-xl font-bold text-indigo-600 font-mono">
              {instance.totalRecords7d.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* SYNC HISTORY TABLE */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-600" />
          Recent Sync Batch History
        </h3>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Batch ID</th>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4 text-right">Records Synced</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Error Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {history.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-slate-900">{item.id}</td>
                  <td className="py-3 px-4 font-mono text-slate-700">{item.timestamp}</td>
                  <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900">
                    {item.records}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">{item.duration}</td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.status === "SUCCESS"
                          ? "bg-emerald-100 text-emerald-800"
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
    </div>
  );
};
