import React, { useEffect, useState } from "react";
import {
  Server,
  Activity,
  Key,
  ShieldCheck,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
  Check,
  Clock,
  Zap,
} from "lucide-react";
import { api } from "../services/api";
import { ApiEndpointStat, ApiKeyItem, SystemKPIs } from "../types";

export const ApiManagementPage: React.FC = () => {
  const [endpoints, setEndpoints] = useState<ApiEndpointStat[]>([]);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [kpis, setKpis] = useState<SystemKPIs | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const loadData = async () => {
    const [epData, keyData, kpiData] = await Promise.all([
      api.getApiEndpoints(),
      api.getApiKeys(),
      api.getKPIs(),
    ]);
    setEndpoints(epData);
    setKeys(keyData);
    setKpis(kpiData);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRegenerate = async (id: string) => {
    const updated = await api.regenerateApiKey(id);
    setBannerMsg(`API Key regenerated for ${updated.instanceName}`);
    await loadData();
    setTimeout(() => setBannerMsg(null), 4000);
  };

  const handleRevoke = async (id: string) => {
    await api.revokeApiKey(id);
    setBannerMsg(`API Key revoked for key ID ${id}`);
    await loadData();
    setTimeout(() => setBannerMsg(null), 4000);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Health Card */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Central API Ingestion Gateway</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  ONLINE
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                Base URL: <strong className="text-blue-600">http://localhost:8000</strong> • Gateway Health: <strong className="text-emerald-600">Healthy</strong>
              </p>
            </div>
          </div>

          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 self-start sm:self-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Ping Gateway
          </button>
        </div>

        {/* 4 Gateway Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-500 block">Requests Today</span>
            <span className="text-lg font-bold text-slate-900 font-mono">
              {kpis?.requestsToday.toLocaleString() ?? "48,293"}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-500 block">Successful Ingestions</span>
            <span className="text-lg font-bold text-emerald-600 font-mono">
              {kpis?.successfulRequests.toLocaleString() ?? "48,276"}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-500 block">Failed Requests</span>
            <span className="text-lg font-bold text-rose-600 font-mono">
              {kpis?.failedRequests ?? "17"}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-500 block">Average Response Latency</span>
            <span className="text-lg font-bold text-blue-600 font-mono">
              {kpis?.avgResponseTime ?? "84ms"}
            </span>
          </div>
        </div>
      </div>

      {bannerMsg && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm">
          <ShieldCheck className="w-4 h-4 text-blue-600" />
          {bannerMsg}
        </div>
      )}

      {/* API Endpoints Registry */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600" />
            Central API Ingestion Endpoints
          </h3>
          <span className="text-xs text-slate-400 font-mono">FastAPI Swagger /docs</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Method & Path</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Requests (24h)</th>
                <th className="py-3 px-4 text-right">Avg Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {endpoints.map((ep, idx) => (
                <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                    <span
                      className={`inline-block w-14 text-center px-1.5 py-0.5 rounded text-[10px] mr-2 ${
                        ep.method === "POST"
                          ? "bg-emerald-100 text-emerald-800 font-bold"
                          : "bg-blue-100 text-blue-800 font-bold"
                      }`}
                    >
                      {ep.method}
                    </span>
                    <span>{ep.path}</span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-600">{ep.description}</td>
                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      {ep.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900">
                    {ep.requests24h.toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-600">{ep.avgLatency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* API KEY MANAGEMENT (Section 12 requirement) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Key className="w-4 h-4 text-blue-600" />
              Sync Agent API Credentials (Key Management)
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Each of the 5 database instances authenticates with its own cryptographically masked API credential.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Instance Node</th>
                <th className="py-3 px-4">Masked API Key</th>
                <th className="py-3 px-4">Created Date</th>
                <th className="py-3 px-4">Last Activity</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4">
                    <span className="font-mono font-bold text-slate-900">{k.instanceId}</span>
                    <span className="block text-[11px] text-slate-500">{k.instanceName}</span>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded text-slate-800 border border-slate-200">
                        {k.keyMasked}
                      </span>
                      <button
                        onClick={() => handleCopy(k.id, k.keyMasked)}
                        className="p-1 hover:bg-slate-100 rounded text-slate-500"
                        title="Copy Key"
                      >
                        {copiedId === k.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-slate-500">{k.createdAt}</td>
                  <td className="py-3.5 px-4 font-medium text-slate-700">{k.lastUsed}</td>
                  <td className="py-3.5 px-4 text-center">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        k.status === "Active"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {k.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleRegenerate(k.id)}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded text-[11px] transition-colors"
                      >
                        Regenerate
                      </button>
                      <button
                        onClick={() => handleRevoke(k.id)}
                        className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium rounded text-[11px] transition-colors"
                      >
                        Revoke
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
