import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Database,
  RefreshCw,
  ArrowDownToLine,
  FileText,
  BarChart3,
  Server,
  ScrollText,
  Sliders,
  Settings,
  LogOut,
  Layers,
  CheckCircle2,
} from "lucide-react";
import { api } from "../services/api";

interface SidebarProps {
  onlineCount: number;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onlineCount, onLogout }) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await api.logout();
    onLogout();
    navigate("/login");
  };

  const navItems = [
    { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
    { name: "Database Instances", path: "/instances", icon: Database, badge: "5" },
    { name: "Sync Monitoring", path: "/sync", icon: RefreshCw },
    { name: "Incoming Data", path: "/incoming-data", icon: ArrowDownToLine },
    { name: "Reports", path: "/reports", icon: FileText },
    { name: "Analytics", path: "/analytics", icon: BarChart3 },
    { name: "API Management", path: "/api-management", icon: Server },
    { name: "Sync Logs", path: "/logs", icon: ScrollText },
    { name: "Database Configuration", path: "/database-config", icon: Sliders },
    { name: "Settings", path: "/settings", icon: Settings },
  ];

  return (
    <aside className="w-64 bg-[#0c1322] text-slate-300 flex flex-col h-screen shrink-0 border-r border-slate-800 select-none">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 gap-3 border-b border-slate-800/80 bg-[#090e1a]">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
          <Layers className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold text-white text-base tracking-wide flex items-center gap-1.5">
            Central Sync
            <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
              v1.0
            </span>
          </div>
          <p className="text-[11px] text-slate-400">Enterprise Sync Portal</p>
        </div>
      </div>

      {/* Instance Summary Pill */}
      <div className="mx-4 my-3 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50 flex items-center justify-between text-xs">
        <span className="text-slate-400">Active Pipeline</span>
        <span className="flex items-center gap-1 text-emerald-400 font-medium font-mono">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {onlineCount}/5 DBs Online
        </span>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto py-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm shadow-blue-600/30"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                }`
              }
            >
              <div className="flex items-center gap-3">
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.name}</span>
              </div>
              {item.badge && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-700/80 text-slate-300">
                  {item.badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Logout Footer */}
      <div className="p-3 border-t border-slate-800/80 bg-[#090e1a]">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
};
