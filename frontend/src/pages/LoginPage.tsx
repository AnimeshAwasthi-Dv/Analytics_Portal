import React, { useState } from "react";
import { Layers, Lock, Mail, ArrowRight, ShieldCheck } from "lucide-react";
import { api } from "../services/api.ts";

interface LoginPageProps {
  onLoginSuccess: (user: any) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState("admin@local.com");
  const [password, setPassword] = useState("adminpassword123");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await api.login(email, password);
      onLoginSuccess(res.user || { name: "System Admin", email });
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to authenticate");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090e1a] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#0c1322] border border-slate-800 rounded-2xl shadow-2xl p-8 space-y-6 text-slate-200">
        
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-blue-600 mx-auto flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
            <Layers className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide">Central Sync Portal</h1>
          <p className="text-xs text-slate-400">
            Centralized Real-Time Data Synchronization Architecture
          </p>
        </div>

        {/* Info Card */}
        <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300 space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-blue-400">
            <ShieldCheck className="w-4 h-4" />
            <span>Architecture Overview</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Consolidating 5 independent database instances via dedicated daemon Sync Agents into one Central Ingestion API.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-semibold">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1.5">Admin Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="admin@local.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1.5">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                placeholder="••••••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg shadow-md shadow-blue-600/30 transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50"
          >
            {loading ? "Authenticating..." : "Sign In to Central Portal"}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="text-center text-[11px] text-slate-500 font-mono">
          Default: <span className="text-slate-400">admin@local.com</span> / <span className="text-slate-400">adminpassword123</span>
        </div>
      </div>
    </div>
  );
};
