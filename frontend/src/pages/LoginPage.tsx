import React, { FormEvent, useState } from "react";
import { api } from "../services/api.ts";
import type { User } from "../services/api";

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
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
    <div className="login-page min-h-screen flex items-center justify-center px-4">

      <div className="login-shell w-full max-w-md">

        {/* BRAND */}
        <div className="login-brand text-center mb-8">

          <h1 className="text-2xl font-bold text-white">
            DecXpert Control Panel
          </h1>

          <p className="text-sm text-slate-400 mt-2">
            Centralized Data Synchronization
          </p>
        </div>

        {/* LOGIN CARD */}
        <div className="login-card bg-white border border-slate-300 rounded-lg p-7">

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
            <div className="mb-5 p-3 rounded border border-rose-200 bg-rose-50">
              <p className="text-xs font-medium text-rose-700" role="alert">
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

              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="admin@local.com"
                autoComplete="email"
                className="w-full px-3 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded outline-none focus:border-blue-500"
                disabled={loading}
              />
            </div>

            {/* PASSWORD */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Password
              </label>

              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="Enter your password"
                autoComplete="current-password"
                className="w-full px-3 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded outline-none focus:border-blue-500"
                disabled={loading}
              />
            </div>

            {/* SUBMIT */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-500 text-white text-sm font-semibold rounded"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>

          </form>
        </div>

        <p className="text-center text-[11px] text-slate-500 mt-6">
          DecXpert Control Panel
        </p>

      </div>
    </div>
  );
};