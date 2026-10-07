import axios from "axios";
import type { AnalyticsResponse, DashboardResponse } from "../types";

export interface User {
  id: number;
  name: string;
  email: string;
}

/*
 * Backend URL
 *
 * frontend:
 * http://localhost:5173
 *
 * backend:
 * http://localhost:8000
 *
 * Make sure frontend/.env contains:
 *
 * VITE_API_BASE_URL=http://localhost:8000
 */
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? ""
).replace(/\/$/, "");

console.log("API_BASE_URL =", API_BASE_URL);

export const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

export const api = {
  // --------------------------------------------------
  // GET CURRENT USER
  // --------------------------------------------------
  async getCurrentUser(): Promise<User> {
    const response = await axiosInstance.get<User>("/auth/me");

    return response.data;
  },

  // --------------------------------------------------
  // LOGIN
  // --------------------------------------------------
  async login(
    email: string,
    password: string
  ): Promise<{
    message: string;
    user: User;
  }> {
    const response = await axiosInstance.post<{
      message: string;
      user: User;
    }>("/auth/login", {
      email,
      password,
    });

    return response.data;
  },

  // --------------------------------------------------
  // LOGOUT
  // --------------------------------------------------
  async logout(): Promise<void> {
    await axiosInstance.post("/auth/logout");
  },

  // --------------------------------------------------
  // DASHBOARD
  // --------------------------------------------------
  async getDashboard(): Promise<DashboardResponse> {
    const response = await axiosInstance.get<DashboardResponse>(
      "/api/v1/dashboard"
    );

    return response.data;
  },

  // --------------------------------------------------
  // ANALYTICS
  // --------------------------------------------------
  async getAnalytics(): Promise<AnalyticsResponse> {
    const response = await axiosInstance.get<AnalyticsResponse>(
      "/api/v1/analytics"
    );

    return response.data;
  },
};