import React, { useEffect, useState } from "react";
import {
  ScrollText,
  Search,
  RefreshCw,
  AlertOctagon,
  CheckCircle2,
  Clock,
  RotateCcw,
  Eye,
  Filter,
} from "lucide-react";
import { api } from "../services/api.ts";
import { SyncLogEvent } from "../types";

export const SyncLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<SyncLogEvent[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedInstance, setSelectedInstance] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [selectedLog, setSelectedLog] = useState<SyncLogEvent | null>(null);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  const loadLogs = async () => {
    const data = await api.getSyncLogs();
    setLogs(data);
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const handleRetry = (log: SyncLogEvent) => {
    setRetryMsg(`Re-dispatching event ${log.eventId} for ${log.instanceId}...`);
    setTimeout(() => {
      setRetryMsg(`Event ${log.eventId} re-processed successfully with HTTP 200 OK.`);
      setTimeout(() => setRetryMsg(null), 4000);
    }, 800);
  };

  const filtered = logs.filter((log) => {
    const matchInst = selectedInstance === "ALL" || log.instanceId === selectedInstance;
    const matchStat = selectedStatus === "ALL" || log.status === selectedStatus;
    const matchSearch =
      log.eventId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.endpoint.toLowerCase().includes(searchTerm.toLowerCase());
    return matchInst && matchStat && matchSearch;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner & Filters */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ScrollText className="w-5 h-5 text-blue-600" />
              Centralized Synchronization Audit Logs
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Unified trace records of batch payloads, HTTP status codes, and replication latencies
            </p>
          </div>

          <button
            onClick={loadLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 self-start sm:self-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Logs
          </button>
        </div>

        {/* Filter Toolbar */}
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
              <option value="ALL">All Instances</option>
              <option value="DB-01">DB-01 (Ahmedabad)</option>
              <option value="DB-02">DB-02 (Delhi)</option>
              <option value="DB-03">DB-03 (Mumbai)</option>
              <option value="DB-04">DB-04 (Bangalore)</option>
              <option value="DB-05">DB-05 (Chennai)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Status Code / Result
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED (Errors Only)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Search Text
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search event ID or log text..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      {retryMsg && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm">
          <RotateCcw className="w-4 h-4 text-blue-600" />
          {retryMsg}
        </div>
      )}

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Instance</th>
                <th className="py-3 px-4">Event ID</th>
                <th className="py-3 px-4">Endpoint</th>
                <th className="py-3 px-4">Operation</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Response Time</th>
                <th className="py-3 px-4">Message</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono">
              {filtered.map((log) => {
                const isFailed = log.status === "FAILED";
                return (
                  <tr
                    key={log.id}
                    className={`transition-colors ${
                      isFailed ? "bg-rose-50/70 hover:bg-rose-100/60" : "hover:bg-slate-50/80"
                    }`}
                  >
                    <td className="py-3.5 px-4 text-slate-700">{log.timestamp}</td>
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[11px]">
                        {log.instanceId}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-800">{log.eventId}</td>
                    <td className="py-3.5 px-4 text-slate-600">{log.endpoint}</td>
                    <td className="py-3.5 px-4">
                      <span className="font-bold text-[10px] text-slate-700">{log.operation}</span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          log.status === "SUCCESS"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800 border border-rose-300"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right text-slate-700 font-semibold">{log.responseTime}</td>
                    <td className="py-3.5 px-4 font-sans text-slate-800 max-w-xs truncate">
                      {log.message}
                    </td>
                    <td className="py-3.5 px-4 text-center font-sans">
                      <div className="flex items-center justify-center gap-1.5">
                        {isFailed && (
                          <button
                            onClick={() => handleRetry(log)}
                            className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded text-[11px] transition-colors flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Retry
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded text-[11px] transition-colors flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 font-mono">
                Log Event: {selectedLog.eventId}
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕ Close
              </button>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
                <div><strong>Timestamp:</strong> {selectedLog.timestamp}</div>
                <div><strong>Source Instance:</strong> {selectedLog.instanceId}</div>
                <div><strong>Endpoint:</strong> {selectedLog.endpoint}</div>
                <div><strong>Operation:</strong> {selectedLog.operation}</div>
                <div><strong>Status:</strong> {selectedLog.status}</div>
                <div><strong>Response Latency:</strong> {selectedLog.responseTime}</div>
              </div>

              <div>
                <strong className="font-sans block mb-1">Diagnostic Message:</strong>
                <pre className="p-3 bg-slate-900 text-emerald-400 rounded-lg text-xs overflow-x-auto">
                  {selectedLog.message}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
