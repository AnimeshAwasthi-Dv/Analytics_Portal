import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Database,
  Cpu,
  Server,
  HardDrive,
  BarChart4,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Radio,
} from "lucide-react";
import { DatabaseInstance } from "../types";

interface SyncFlowVisualizationProps {
  instances: DatabaseInstance[];
  onSelectInstance?: (id: string) => void;
}

export const SyncFlowVisualization: React.FC<SyncFlowVisualizationProps> = ({
  instances,
  onSelectInstance,
}) => {
  const navigate = useNavigate();

  const handleInstanceClick = (id: string) => {
    if (onSelectInstance) {
      onSelectInstance(id);
    } else {
      navigate(`/instances/${id}`);
    }
  };

  const getStatusIcon = (status: string) => {
    if (status === "Online") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    if (status === "Delayed") return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
    return <XCircle className="w-3.5 h-3.5 text-rose-500" />;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Radio className="w-4 h-4 text-blue-600 animate-pulse" />
            Central Real-time Synchronization Architecture
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            5 Independent Database Nodes &rarr; 5 Sync Agents &rarr; Central API Ingestion &rarr; Central DB &rarr; Analytics
          </p>
        </div>
        <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
          Interactive Architecture Topology
        </span>
      </div>

      {/* Topology Diagram Container */}
      <div className="min-w-[860px] py-4 px-2">
        <div className="grid grid-cols-12 gap-3 items-center">
          
          {/* Column 1: 5 Independent Source Databases */}
          <div className="col-span-3 space-y-2.5">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-slate-600" />
              Source Databases (5 Nodes)
            </div>
            {instances.map((inst) => (
              <div
                key={inst.id}
                onClick={() => handleInstanceClick(inst.id)}
                className={`p-2.5 rounded-lg border transition-all cursor-pointer group hover:shadow-md ${
                  inst.status === "Online"
                    ? "bg-slate-50/80 border-slate-200 hover:border-blue-400 hover:bg-blue-50/40"
                    : inst.status === "Delayed"
                    ? "bg-amber-50/60 border-amber-200"
                    : "bg-rose-50/60 border-rose-200"
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
                    {getStatusIcon(inst.status)}
                    <span>{inst.id}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">{inst.port}</span>
                </div>
                <div className="text-[11px] text-slate-600 font-medium truncate mt-0.5">{inst.name}</div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">Host: {inst.host}</div>
              </div>
            ))}
          </div>

          {/* Connectors 1 */}
          <div className="col-span-1 flex flex-col justify-around h-[340px] items-center text-slate-300">
            {instances.map((i) => (
              <div key={i.id} className="flex items-center text-blue-500/70 font-mono text-[10px]">
                <ArrowRight className="w-4 h-4 animate-pulse" />
              </div>
            ))}
          </div>

          {/* Column 2: 5 Independent Sync Agents */}
          <div className="col-span-3 space-y-2.5">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-slate-600" />
              Sync Agents (Daemon Agents)
            </div>
            {instances.map((inst, index) => (
              <div
                key={`agent-${inst.id}`}
                className="p-2.5 rounded-lg border border-slate-200 bg-slate-900 text-white shadow-sm"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-blue-400 font-mono">Sync Agent #{index + 1}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {inst.syncAgentStatus}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1 font-mono">
                  <span>Replication Rate:</span>
                  <span className="text-slate-200">{inst.successRate}%</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>Last Push:</span>
                  <span className="text-blue-300">{inst.lastSyncTime}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Connectors 2 - Converging */}
          <div className="col-span-1 flex flex-col justify-around h-[340px] items-center text-slate-400">
            <div className="h-full border-r-2 border-dashed border-blue-400 flex items-center justify-center relative">
              <span className="absolute bg-blue-600 text-white text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                HTTPS
              </span>
            </div>
          </div>

          {/* Column 3: Central API & Central DB & Analytics */}
          <div className="col-span-4 space-y-3 pl-2">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-slate-600" />
              Central Ingestion & Analytics
            </div>

            {/* Central API */}
            <div className="p-3.5 rounded-xl border-2 border-blue-600 bg-blue-50/50 shadow-sm relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-600 text-white shadow-sm">
                    <Server className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">CENTRAL API</h3>
                    <p className="text-[10px] text-slate-500 font-mono">FastAPI /api/v1/sync</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500 text-white rounded-full">
                  ONLINE
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-2">
                Validates API credentials, parses study metadata & QC records, verifies idempotency.
              </p>
            </div>

            <div className="flex justify-center text-blue-500">
              <ArrowRight className="w-4 h-4 rotate-90" />
            </div>

            {/* Central DB */}
            <div className="p-3 rounded-xl border border-slate-300 bg-white shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-slate-800 text-white">
                    <HardDrive className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">CENTRAL DATABASE</h3>
                    <p className="text-[10px] text-slate-500 font-mono">Unified Medical & QC Store</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-emerald-600 font-bold">CONNECTED</span>
              </div>
            </div>

            <div className="flex justify-center text-blue-500">
              <ArrowRight className="w-4 h-4 rotate-90" />
            </div>

            {/* Analytics & UI */}
            <div className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/40 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-600 text-white">
                    <BarChart4 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">CENTRAL PORTAL UI & ANALYTICS</h3>
                    <p className="text-[10px] text-slate-500">Real-time KPI & Synchronized Reports</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-indigo-600">ACTIVE</span>
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
};
