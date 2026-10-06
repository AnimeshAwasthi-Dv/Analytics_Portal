import React, { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
  RefreshCw,
  Search,
  Filter,
} from "lucide-react";
import { api } from "../services/api";
import { IncomingEvent } from "../types";

export const IncomingDataPage: React.FC = () => {
  const [events, setEvents] = useState<IncomingEvent[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const data = await api.getIncomingEvents();
      setEvents(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const totalReceived = 1248560;
  const totalProcessed = 1246202;
  const totalFailed = 17;
  const totalQueued = 2341;

  const filtered = events.filter(
    (e) =>
      e.eventId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.instanceId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.entity.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ArrowDownToLine className="w-5 h-5 text-blue-600" />
            Central API Incoming Ingestion Stream
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Raw event replication feed ingested via <code className="text-blue-600 font-mono">POST /api/v1/sync</code> from all 5 Sync Agents
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Live Stream
        </button>
      </div>

      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block mb-1">Records Received</span>
          <div className="text-2xl font-bold text-slate-900 font-mono">
            {totalReceived.toLocaleString()}
          </div>
          <span className="text-[11px] text-blue-600 font-medium">All 5 Databases</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block mb-1">Records Processed</span>
          <div className="text-2xl font-bold text-emerald-600 font-mono">
            {totalProcessed.toLocaleString()}
          </div>
          <span className="text-[11px] text-emerald-600 font-semibold">Committed to Central DB</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block mb-1">Records Failed</span>
          <div className="text-2xl font-bold text-rose-600 font-mono">
            {totalFailed}
          </div>
          <span className="text-[11px] text-rose-500 font-semibold">Validation / Timeout</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-medium block mb-1">Records Queued</span>
          <div className="text-2xl font-bold text-amber-600 font-mono">
            {totalQueued.toLocaleString()}
          </div>
          <span className="text-[11px] text-amber-600 font-medium">In Pipeline Buffer</span>
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Incoming Replication Events
          </h3>
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Search event ID, instance..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Event ID</th>
                <th className="py-3 px-4">Source Instance ID</th>
                <th className="py-3 px-4">Entity Type</th>
                <th className="py-3 px-4">Operation</th>
                <th className="py-3 px-4">Received At</th>
                <th className="py-3 px-4">Processed At</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((evt) => (
                <tr key={evt.eventId} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-slate-900">{evt.eventId}</td>
                  <td className="py-3 px-4">
                    <span className="font-mono font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[11px]">
                      {evt.instanceId}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-800">{evt.entity}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                        evt.operation === "INSERT"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : evt.operation === "UPDATE"
                          ? "bg-sky-50 text-sky-700 border border-sky-200"
                          : "bg-rose-50 text-rose-700 border border-rose-200"
                      }`}
                    >
                      {evt.operation}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700">{evt.receivedAt}</td>
                  <td className="py-3 px-4 font-mono text-slate-700">{evt.processedAt}</td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        evt.status === "SUCCESS"
                          ? "bg-emerald-100 text-emerald-800"
                          : evt.status === "QUEUED"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {evt.status}
                    </span>
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
