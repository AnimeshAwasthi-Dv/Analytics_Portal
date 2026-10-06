import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FileText,
  Search,
  Filter,
  ExternalLink,
  RefreshCw,
  Building2,
  Database,
  Calendar,
} from "lucide-react";
import { api } from "../services/api.ts";
import { SyncReport } from "../types";

export const ReportsPage: React.FC = () => {
  const [reports, setReports] = useState<SyncReport[]>([]);
  const [selectedInstance, setSelectedInstance] = useState("ALL");
  const [selectedModality, setSelectedModality] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

  const loadReports = async () => {
    try {
      const data = await api.getReports();
      setReports(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const filtered = reports.filter((r) => {
    const matchInst = selectedInstance === "ALL" || r.source_instance_id === selectedInstance;
    const matchMod = selectedModality === "ALL" || r.modality === selectedModality;
    const matchSearch =
      r.report_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.study_uid.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.client_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.service_name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchInst && matchMod && matchSearch;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Synchronized Clinical Reports
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Consolidated medical and radiology reports ingested from all 5 independent source databases
            </p>
          </div>
          <button
            onClick={loadReports}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 self-start sm:self-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100">
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Source Instance ID
            </label>
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="ALL">All Source Databases (5)</option>
              <option value="DB-01">DB-01 (Ahmedabad)</option>
              <option value="DB-02">DB-02 (Delhi)</option>
              <option value="DB-03">DB-03 (Mumbai)</option>
              <option value="DB-04">DB-04 (Bangalore)</option>
              <option value="DB-05">DB-05 (Chennai)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Modality
            </label>
            <select
              value={selectedModality}
              onChange={(e) => setSelectedModality(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              <option value="ALL">All Modalities</option>
              <option value="XR">XR (X-Ray)</option>
              <option value="CT">CT Scan</option>
              <option value="MR">MR (MRI)</option>
              <option value="US">US (Ultrasound)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Search Query
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Study UID, report ID, client..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Reports Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Report ID</th>
                <th className="py-3 px-4">Study UID</th>
                <th className="py-3 px-4">Source Instance</th>
                <th className="py-3 px-4">Client Code</th>
                <th className="py-3 px-4">Modality</th>
                <th className="py-3 px-4">Service</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Credits</th>
                <th className="py-3 px-4">Created At</th>
                <th className="py-3 px-4">Pushed At</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((report) => (
                <tr key={report.report_id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                    <Link
                      to={`/reports/${report.report_id}`}
                      className="text-blue-600 hover:underline flex items-center gap-1"
                    >
                      {report.report_id}
                    </Link>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600 max-w-[140px] truncate">
                    {report.study_uid}
                  </td>
                  <td className="py-3.5 px-4">
                    {/* CRITICAL: Highlight Source Instance */}
                    <span className="inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[11px]">
                      <Database className="w-3 h-3 text-blue-500" />
                      {report.source_instance_id}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-slate-800">
                    {report.client_code}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {report.modality}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-700 font-medium">
                    {report.service_name}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        report.report_status === "PUSHED"
                          ? "bg-emerald-100 text-emerald-800"
                          : report.report_status === "APPROVED"
                          ? "bg-sky-100 text-sky-800"
                          : report.report_status === "REVIEWED"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {report.report_status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-800">
                    {report.credits.credits_used}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500">
                    {report.timestamps.study_created_at.split("T")[1] || report.timestamps.study_created_at}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-700">
                    {report.timestamps.pushed_at
                      ? report.timestamps.pushed_at.split("T")[1] || report.timestamps.pushed_at
                      : "—"}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <Link
                      to={`/reports/${report.report_id}`}
                      className="px-2 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 font-medium rounded text-[11px] transition-colors"
                    >
                      View
                    </Link>
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
