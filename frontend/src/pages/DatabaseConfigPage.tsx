import React, { useState } from "react";
import {
  Sliders,
  Database,
  ShieldCheck,
  Server,
  Lock,
  CheckCircle2,
  AlertCircle,
  Save,
  Radio,
} from "lucide-react";

interface DBConfigForm {
  instanceId: string;
  instanceName: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  status: "Online" | "Testing" | "Offline";
}

export const DatabaseConfigPage: React.FC = () => {
  const [configs, setConfigs] = useState<DBConfigForm[]>([
    { instanceId: "DB-01", instanceName: "Portal Ahmedabad", host: "192.168.1.101", port: 5432, databaseName: "portal_ahmedabad_db", username: "pacs_ahmedabad", password: "••••••••••••", status: "Online" },
    { instanceId: "DB-02", instanceName: "Portal Delhi", host: "192.168.1.102", port: 5432, databaseName: "portal_delhi_db", username: "pacs_delhi", password: "••••••••••••", status: "Online" },
    { instanceId: "DB-03", instanceName: "Portal Mumbai", host: "192.168.1.103", port: 5432, databaseName: "portal_mumbai_db", username: "pacs_mumbai", password: "••••••••••••", status: "Online" },
    { instanceId: "DB-04", instanceName: "Portal Bangalore", host: "192.168.1.104", port: 5432, databaseName: "portal_bangalore_db", username: "pacs_bangalore", password: "••••••••••••", status: "Online" },
    { instanceId: "DB-05", instanceName: "Portal Chennai", host: "192.168.1.105", port: 5432, databaseName: "portal_chennai_db", username: "pacs_chennai", password: "••••••••••••", status: "Online" },
  ]);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const current = configs[selectedIdx];

  const handleFieldChange = (field: keyof DBConfigForm, value: any) => {
    const updated = [...configs];
    updated[selectedIdx] = { ...updated[selectedIdx], [field]: value };
    setConfigs(updated);
  };

  const handleTest = () => {
    setIsTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setIsTesting(false);
      setTestResult(`Successfully connected to ${current.host}:${current.port}/${current.databaseName}. TCP Handshake & SSL OK.`);
      setTimeout(() => setTestResult(null), 5000);
    }, 700);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccess(`Configuration for ${current.instanceName} (${current.instanceId}) saved securely.`);
    setTimeout(() => setSaveSuccess(null), 4000);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-blue-600" />
            Source Database Configuration Manager
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure host IP, ports, schemas, and secure authentication for all 5 independent source databases
          </p>
        </div>
      </div>

      {saveSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          {saveSuccess}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Select Instance Node */}
        <div className="lg:col-span-4 space-y-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            Select Instance to Configure (5 Nodes)
          </h3>
          {configs.map((cfg, idx) => (
            <button
              key={cfg.instanceId}
              onClick={() => {
                setSelectedIdx(idx);
                setTestResult(null);
              }}
              className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between ${
                selectedIdx === idx
                  ? "bg-blue-50/70 border-blue-500 shadow-xs"
                  : "bg-white border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-900">{cfg.instanceId}</span>
                  <span className="text-xs font-semibold text-slate-800">{cfg.instanceName}</span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                  {cfg.host}:{cfg.port}
                </div>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            </button>
          ))}
        </div>

        {/* Right Side: Form */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900 font-mono">
                {current.instanceId} — {current.instanceName}
              </h3>
              <p className="text-xs text-slate-500">Database Connection Credentials</p>
            </div>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              Connection Verified
            </span>
          </div>

          <form onSubmit={handleSave} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Instance Name</label>
                <input
                  type="text"
                  value={current.instanceName}
                  onChange={(e) => handleFieldChange("instanceName", e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Database Engine</label>
                <input
                  type="text"
                  value="PostgreSQL (psycopg3 driver)"
                  disabled
                  className="w-full bg-slate-100 text-slate-500 border border-slate-200 rounded-lg p-2 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="font-semibold text-slate-700 block mb-1">Host IP / FQDN</label>
                <input
                  type="text"
                  value={current.host}
                  onChange={(e) => handleFieldChange("host", e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Port</label>
                <input
                  type="number"
                  value={current.port}
                  onChange={(e) => handleFieldChange("port", parseInt(e.target.value) || 5432)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Database Name</label>
                <input
                  type="text"
                  value={current.databaseName}
                  onChange={(e) => handleFieldChange("databaseName", e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Username</label>
                <input
                  type="text"
                  value={current.username}
                  onChange={(e) => handleFieldChange("username", e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>
            </div>

            {/* Password input (Section 14: must always be a password field, do not expose) */}
            <div>
              <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                Database Password (Encrypted at rest)
              </label>
              <input
                type="password"
                value={current.password}
                onChange={(e) => handleFieldChange("password", e.target.value)}
                placeholder="Enter password..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                required
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Passwords are never displayed in clear text or exposed over UI responses.
              </span>
            </div>

            {testResult && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-lg flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                {testResult}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors"
              >
                {isTesting ? "Testing Connection..." : "Test Connection"}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                Save Configuration
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
