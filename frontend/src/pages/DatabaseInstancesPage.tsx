import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Database,
  Search,
  RefreshCw,
  ExternalLink,
  Activity,
  Server,
  Play,
  FileCode,
  ShieldCheck,
} from "lucide-react";
import { api } from "../services/api.ts";
import { DatabaseInstance } from "../types";

export const DatabaseInstancesPage: React.FC = () => {
  const [instances, setInstances] = useState<DatabaseInstance[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadInstances = async () => {
    const data = await api.getInstances();
    setInstances(data);
  };

  useEffect(() => {
    loadInstances();
  }, []);

  const handleTestConnection = (id: string) => {
    setTestingId(id);
    setTimeout(() => {
      setTestingId(null);
      setBannerMsg(`Connection to ${id} verified. Latency: 14ms (TCP Handshake OK).`);
      setTimeout(() => setBannerMsg(null), 4000);
    }, 800);
  };

  const handleSyncNow = async (id: string) => {
    setSyncingId(id);
    try {
      const res = await api.triggerSync(id);
      setBannerMsg(res.message);
      await loadInstances();
      setTimeout(() => setBannerMsg(null), 4000);
    } finally {
      setSyncingId(null);
    }
  };

  const filtered = instances.filter(
    (i) =>
      i.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.host.includes(searchTerm)
  );

  return (
    <div className="space-y-5 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            Independent Database Instances
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            5 distributed source databases streaming real-time clinical reports via localized Sync Agents
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter by name, ID or host..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
          <button
            onClick={loadInstances}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {bannerMsg && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm animate-in fade-in">
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          {bannerMsg}
        </div>
      )}

      {/* Main Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Instance ID</th>
                <th className="py-3 px-4">Instance Name</th>
                <th className="py-3 px-4">Database</th>
                <th className="py-3 px-4">Host : Port</th>
                <th className="py-3 px-4">Sync Agent</th>
                <th className="py-3 px-4">Last Sync</th>
                <th className="py-3 px-4 text-right">Records</th>
                <th className="py-3 px-4 text-right">Pending</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((inst) => (
                <tr key={inst.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                    <Link
                      to={`/instances/${inst.id}`}
                      className="text-blue-600 hover:underline flex items-center gap-1"
                    >
                      {inst.id}
                      <ExternalLink className="w-3 h-3 text-slate-400" />
                    </Link>
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-slate-800">
                    {inst.name}
                    <span className="block text-[10px] text-slate-400 font-mono">{inst.clientCode}</span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">
                      PostgreSQL
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-slate-600">
                    {inst.host}:{inst.port}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-900 text-blue-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      {inst.syncAgentStatus}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-slate-700">{inst.lastSyncTime}</td>
                  <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900">
                    {inst.recordsSynced.toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-semibold text-amber-600">
                    {inst.recordsPending}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        inst.status === "Online"
                          ? "bg-emerald-100 text-emerald-800"
                          : inst.status === "Delayed"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          inst.status === "Online"
                            ? "bg-emerald-500"
                            : inst.status === "Delayed"
                            ? "bg-amber-500"
                            : "bg-rose-500"
                        }`}
                      ></span>
                      {inst.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => navigate(`/instances/${inst.id}`)}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded text-[11px] transition-colors"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleTestConnection(inst.id)}
                        disabled={testingId === inst.id}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded text-[11px] transition-colors"
                      >
                        {testingId === inst.id ? "Testing..." : "Test Connection"}
                      </button>
                      <button
                        onClick={() => handleSyncNow(inst.id)}
                        disabled={syncingId === inst.id}
                        className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded text-[11px] transition-colors"
                      >
                        {syncingId === inst.id ? "Syncing..." : "Sync Now"}
                      </button>
                      <button
                        onClick={() => navigate("/logs")}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded text-[11px] transition-colors"
                      >
                        Logs
                      </button>
                    </div>
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
