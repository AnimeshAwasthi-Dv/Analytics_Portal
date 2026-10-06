import React, { useState } from "react";
import {
  Settings,
  Shield,
  Bell,
  Sliders,
  CheckCircle2,
  HardDrive,
  RefreshCw,
  Lock,
} from "lucide-react";

export const SettingsPage: React.FC = () => {
  const [pollInterval, setPollInterval] = useState("5");
  const [autoBatchSize, setAutoBatchSize] = useState("50");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            Central System & Pipeline Settings
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure global replication telemetry polling, daemon heartbeat thresholds, and alert notifications
          </p>
        </div>
      </div>

      {saved && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          Settings updated successfully.
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Polling & Sync Parameters */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-600" />
            Telemetry & Ingestion Polling
          </h3>

          <div className="space-y-4 text-xs">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                UI Telemetry Polling Interval (seconds)
              </label>
              <select
                value={pollInterval}
                onChange={(e) => setPollInterval(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="2">2 seconds (High Frequency)</option>
                <option value="5">5 seconds (Recommended)</option>
                <option value="10">10 seconds (Low Bandwidth)</option>
                <option value="30">30 seconds</option>
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Sync Agent Max Batch Ingestion Size
              </label>
              <input
                type="number"
                value={autoBatchSize}
                onChange={(e) => setAutoBatchSize(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Number of clinical study records per HTTPS POST payload.
              </span>
            </div>
          </div>
        </div>

        {/* Security & System Info */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600" />
            Central Portal Topology Specs
          </h3>

          <div className="divide-y divide-slate-100 text-xs">
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Central API Version:</span>
              <span className="font-mono text-slate-900 font-bold">1.0.0 (FastAPI)</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Frontend Environment:</span>
              <span className="font-mono text-slate-900 font-bold">React 19 + TypeScript + Vite</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Authentication Scheme:</span>
              <span className="font-mono text-slate-900">JWT Bearer & HTTP-Only Lax Cookies</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500">Topology Architecture:</span>
              <span className="font-bold text-blue-600">5 Source DBs &rarr; 5 Sync Agents &rarr; Central API</span>
            </div>
          </div>

          <div className="pt-3">
            <button
              type="submit"
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition-colors text-xs"
            >
              Save Pipeline Settings
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
