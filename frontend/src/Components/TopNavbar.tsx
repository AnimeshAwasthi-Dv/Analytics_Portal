import React, { useState } from "react";
import { Search, Bell, Activity, ShieldCheck, ChevronDown, CheckCircle2 } from "lucide-react";

interface TopNavbarProps {
  pageTitle: string;
  userEmail?: string;
  apiStatus: string;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  pageTitle,
  userEmail = "admin@local.com",
  apiStatus = "ONLINE",
}) => {
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-30 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      {/* Page Title & Breadcrumb */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">{pageTitle}</h1>
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-xs font-semibold text-emerald-700">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          Central API: {apiStatus}
        </div>
      </div>

      {/* Center Search */}
      <div className="hidden md:flex items-center relative w-80">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
        <input
          type="text"
          placeholder="Search studies, instances, logs (e.g. DB-01)..."
          className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all"
        />
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-4">
        {/* Sync Pipeline Heartbeat indicator */}
        <div className="hidden lg:flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
          <Activity className="w-3.5 h-3.5 text-blue-600 animate-spin" style={{ animationDuration: "3s" }} />
          <span>Sync Pulse: <strong className="text-slate-800 font-mono">1.2s</strong></span>
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg relative transition-colors"
          >
            <Bell className="w-4 h-4" />
            <span className="w-2 h-2 rounded-full bg-blue-600 absolute top-1.5 right-1.5 ring-2 ring-white"></span>
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 p-3 z-50 animate-in fade-in slide-in-from-top-1">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 text-xs font-bold text-slate-800">
                <span>System Notifications</span>
                <span className="text-[10px] text-blue-600 font-medium cursor-pointer">Mark read</span>
              </div>
              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto text-xs py-1">
                <div className="py-2">
                  <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    DB-01 Batch Replication Complete
                  </p>
                  <p className="text-slate-500 text-[11px] mt-0.5">120 studies ingested successfully into Central DB</p>
                  <span className="text-[10px] text-slate-400">10:20:15</span>
                </div>
                <div className="py-2">
                  <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
                    5/5 Sync Agents Active
                  </p>
                  <p className="text-slate-500 text-[11px] mt-0.5">All local agent polling cycles nominal</p>
                  <span className="text-[10px] text-slate-400">10:20:11</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Badge */}
        <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shadow-sm">
            {userEmail.substring(0, 2).toUpperCase()}
          </div>
          <div className="hidden xl:block text-left text-xs">
            <div className="font-semibold text-slate-800 leading-tight">Admin Console</div>
            <div className="text-[11px] text-slate-500 font-mono truncate max-w-[120px]">{userEmail}</div>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </div>
      </div>
    </header>
  );
};
