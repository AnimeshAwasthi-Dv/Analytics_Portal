import React, { FormEvent, useState } from "react";
import { Lock, Mail, LogIn, AlertCircle } from "lucide-react";
import { api } from "../services/api.ts";

interface LoginPageProps {
  onLoginSuccess: (user: any) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginSuccess,
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    setError("");

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    try {
      setLoading(true);

      const response = await api.login(
        email.trim(),
        password
      );

      onLoginSuccess(response.user);
    } catch (err: any) {
      console.error("Login error:", err);

      setError(
        err?.response?.data?.detail ||
          err?.message ||
          "Invalid email or password."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090e1a] flex items-center justify-center px-4">

      <div className="w-full max-w-md">

        {/* BRAND */}
        <div className="text-center mb-8">

          <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/30">
            <Lock className="w-7 h-7 text-white" />
          </div>

          <h1 className="text-2xl font-bold text-white mt-5">
            Central Sync Portal
          </h1>

          <p className="text-sm text-slate-400 mt-2">
            Centralized Data Synchronization
          </p>
        </div>

        {/* LOGIN CARD */}
        <div className="bg-white rounded-2xl shadow-2xl p-7">

          <div className="mb-6">
            <h2 className="text-lg font-bold text-slate-900">
              Sign in
            </h2>

            <p className="text-xs text-slate-500 mt-1">
              Sign in to access the synchronization dashboard.
            </p>
          </div>

          {/* ERROR */}
          {error && (
            <div className="mb-5 flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />

              <p className="text-xs font-medium text-rose-700">
                {error}
              </p>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="space-y-5"
          >

            {/* EMAIL */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Email Address
              </label>

              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

                <input
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  placeholder="admin@local.com"
                  autoComplete="email"
                  className="w-full pl-10 pr-3 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  disabled={loading}
                />
              </div>
            </div>

            {/* PASSWORD */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Password
              </label>

              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />

                <input
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full pl-10 pr-3 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  disabled={loading}
                />
              </div>
            </div>

            {/* SUBMIT */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Sign In
                </>
              )}
            </button>

          </form>
        </div>

        <p className="text-center text-[11px] text-slate-500 mt-6">
          Central Sync Portal
        </p>

      </div>
    </div>
  );
};