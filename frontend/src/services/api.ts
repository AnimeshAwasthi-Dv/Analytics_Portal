import type { AnalyticsResponse, DashboardResponse } from "../types";

export interface User {
  id: number;
  name: string;
  email: string;
  canManageControl: boolean;
}

export interface ControlOverview {
  apiKeys: Array<{ id: number; keyName: string }>;
  users: Array<{
    id: number;
    name: string;
    email: string;
    isActive: boolean;
  }>;
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
}

export interface InstanceTraffic {
  instance: string;
  name: string;
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

export interface DailyInstanceTraffic extends DailyTraffic {
  instance: string;
}

export interface HourlyInstanceTraffic {
  hour: number;
  instance: string;
  requests: number;
  totalDataBytes: number;
  averageResponseTimeMs: number;
}

export interface RecentTrafficRequest {
  timestamp: string;
  instance: string;
  instanceName: string;
  method: string;
  route: string;
  statusCode: number;
  totalDataBytes: number;
}

export interface TrafficAnalyticsData {
  startDate: string;
  endDate: string;
  overview: TrafficOverview;
  daily: DailyTraffic[];
  dailyByInstance: DailyInstanceTraffic[];
  hourlyByInstance: HourlyInstanceTraffic[];
  recentRequests: RecentTrafficRequest[];
  instances: InstanceTraffic[];
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

interface ApiRequestOptions {
  method?: "GET" | "POST";
  data?: unknown;
  params?: Record<string, string | undefined>;
  cache?: RequestCache;
}

interface ApiError extends Error {
  response: {
    data: unknown;
    status: number;
  };
}

function getErrorMessage(data: unknown, status: number): string {
  if (typeof data === "object" && data !== null && "detail" in data) {
    const detail = data.detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      return detail
        .map((item) =>
          typeof item === "object" && item !== null && "msg" in item
            ? String(item.msg)
            : String(item)
        )
        .join(", ");
    }
  }

  return `Request failed with status code ${status}`;
}


async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined) {
      query.set(key, value);
    }
  }

  const search = query.toString();
  const method = options.method ?? "GET";
  const hasBody = options.data !== undefined;

  const response = await fetch(
    `${API_BASE_URL}${endpoint}${search ? `?${search}` : ""}`,
    {
      method,
      credentials: "include",
      ...(options.cache ? { cache: options.cache } : {}),
      ...(hasBody
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options.data),
          }
        : {}),
    }
  );

  const responseText = await response.text();
  let responseData: unknown = responseText;

  if (responseText) {
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }
  }

  if (!response.ok) {
    const error = new Error(
      getErrorMessage(responseData, response.status)
    ) as ApiError;

    error.response = {
      data: responseData,
      status: response.status,
    };

    throw error;
  }

  return responseData as T;
}


const httpClient = {
  get<T>(
    endpoint: string,
    config?: { params?: Record<string, string | undefined>; cache?: RequestCache }
  ): Promise<{ data: T }> {
    return apiRequest<T>(endpoint, {
      params: config?.params,
      cache: config?.cache,
    }).then((data) => ({
      data,
    }));
  },
  post<T>(endpoint: string, data?: unknown): Promise<{ data: T }> {
    return apiRequest<T>(endpoint, { method: "POST", data }).then((result) => ({
      data: result,
    }));
  },
};

let currentUserRequest: Promise<User> | null = null;
let dashboardRequest: Promise<DashboardResponse> | null = null;
let analyticsRequest: Promise<AnalyticsResponse> | null = null;

export const api = {
  // --------------------------------------------------
  // GET CURRENT USER
  // --------------------------------------------------
  async getCurrentUser(): Promise<User> {
    if (!currentUserRequest) {
      currentUserRequest = httpClient
        .get<User>("/auth/me")
        .then((response) => response.data);
    }
    const request = currentUserRequest;

    try {
      return await request;
    } finally {
      if (currentUserRequest === request) {
        currentUserRequest = null;
      }
    }
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
    const response = await httpClient.post<{
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
    await httpClient.post("/auth/logout");
  },

  async getControlOverview(): Promise<ControlOverview> {
    return httpClient
      .get<ControlOverview>("/api/v1/control", { cache: "no-store" })
      .then((response) => response.data);
  },

  async createControlApiKey(data: {
    keyName: string;
    apiKey: string;
    adminPassword: string;
  }): Promise<{ id: number; keyName: string }> {
    return httpClient
      .post<{ id: number; keyName: string }>("/api/v1/control/api-keys", data)
      .then((response) => response.data);
  },

  async createControlUser(data: {
    name: string;
    email: string;
    password: string;
    adminPassword: string;
  }): Promise<{ id: number; name: string; email: string; isActive: boolean }> {
    return httpClient
      .post<{ id: number; name: string; email: string; isActive: boolean }>(
        "/api/v1/control/users",
        data
      )
      .then((response) => response.data);
  },

  // --------------------------------------------------
  // DASHBOARD
  // --------------------------------------------------
  async getDashboard(): Promise<DashboardResponse> {
    if (!dashboardRequest) {
      dashboardRequest = httpClient
        .get<DashboardResponse>("/api/v1/dashboard")
        .then((response) => response.data);
    }
    const request = dashboardRequest;

    try {
      return await request;
    } finally {
      if (dashboardRequest === request) {
        dashboardRequest = null;
      }
    }
  },

  // --------------------------------------------------
  // ANALYTICS
  // --------------------------------------------------
  async getAnalytics(): Promise<AnalyticsResponse> {
    if (!analyticsRequest) {
      analyticsRequest = httpClient
        .get<AnalyticsResponse>("/api/v1/analytics", { cache: "no-store" })
        .then((response) => response.data);
    }
    const request = analyticsRequest;

    try {
      return await request;
    } finally {
      if (analyticsRequest === request) {
        analyticsRequest = null;
      }
    }
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
    return httpClient
      .get<TrafficAnalyticsData>("/api/v1/analytics/traffic/summary", { params })
      .then((response) => response.data);
  },
};