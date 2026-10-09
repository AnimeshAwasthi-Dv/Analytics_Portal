import axios from "axios";
import type { AnalyticsResponse, DashboardResponse } from "../types";

export interface User {
  id: number;
  name: string;
  email: string;
}

export type TrafficPeriod = "today" | "yesterday" | "7d" | "30d" | "custom";

export interface TrafficFilter {
  period: TrafficPeriod;
  startDate?: string;
  endDate?: string;
}

export interface TrafficOverview {
  totalRequests: number;
  totalDataBytes: number;
  activeInstances: number;
  highestTrafficInstance: {
    name: string;
    requests: number;
    totalDataBytes: number;
  } | null;
  lowestTrafficInstance: {
    name: string;
    requests: number;
    totalDataBytes: number;
  } | null;
}

export interface TrafficBreakdown {
  instance?: string;
  route?: string;
  requests: number;
  totalDataBytes: number;
  averageResponseTimeMs: number;
  successRate: number;
}

export interface DailyTraffic {
  date: string;
  requests: number;
  totalDataBytes: number;
}

export interface TrafficAnalyticsData {
  overview: TrafficOverview;
  daily: DailyTraffic[];
  instances: TrafficBreakdown[];
  routes: TrafficBreakdown[];
  routeHighlights: {
    highestTrafficRoute: TrafficBreakdown | null;
    lowestTrafficRoute: TrafficBreakdown | null;
    mostRequestsRoute: TrafficBreakdown | null;
    fewestRequestsRoute: TrafficBreakdown | null;
  };
  details: TrafficBreakdown[];
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

  async getTrafficAnalytics(
    filter: TrafficFilter
  ): Promise<TrafficAnalyticsData> {
    const params = {
      period: filter.period,
      ...(filter.period === "custom"
        ? { start_date: filter.startDate, end_date: filter.endDate }
        : {}),
    };
    const [overview, daily, instances, routes, details] = await Promise.all([
      axiosInstance.get<TrafficOverview>(
        "/api/v1/analytics/traffic/overview",
        { params }
      ),
      axiosInstance.get<{ items: DailyTraffic[] }>(
        "/api/v1/analytics/traffic/daily",
        { params }
      ),
      axiosInstance.get<{
        items: TrafficBreakdown[];
        highestTrafficRoute: TrafficBreakdown | null;
        lowestTrafficRoute: TrafficBreakdown | null;
        mostRequestsRoute: TrafficBreakdown | null;
        fewestRequestsRoute: TrafficBreakdown | null;
      }>(
        "/api/v1/analytics/traffic/instances",
        { params }
      ),
      axiosInstance.get<{ items: TrafficBreakdown[] }>(
        "/api/v1/analytics/traffic/routes",
        { params }
      ),
      axiosInstance.get<{ items: TrafficBreakdown[] }>(
        "/api/v1/analytics/traffic/details",
        { params }
      ),
    ]);

    return {
      overview: overview.data,
      daily: daily.data.items,
      instances: instances.data.items,
      routes: routes.data.items,
      routeHighlights: {
        highestTrafficRoute: routes.data.highestTrafficRoute,
        lowestTrafficRoute: routes.data.lowestTrafficRoute,
        mostRequestsRoute: routes.data.mostRequestsRoute,
        fewestRequestsRoute: routes.data.fewestRequestsRoute,
      },
      details: details.data.items,
    };
  },
};