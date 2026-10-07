import axios from "axios";
import type { AnalyticsResponse, DashboardResponse } from "../types";

export interface User {
  id: number;
  name: string;
  email: string;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const BASE_URL = import.meta.env.DEV ? "" : API_BASE_URL;

export const axiosInstance = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

export const api = {
  async getCurrentUser(): Promise<User> {
    const response = await axiosInstance.get<User>("/auth/me");
    return response.data;
  },

  async login(email: string, password: string): Promise<{ message: string; user: User }> {
    const response = await axiosInstance.post<{ message: string; user: User }>("/auth/login", {
      email,
      password,
    });

    return response.data;
  },

  async logout() {
    await axiosInstance.post("/auth/logout");
  },

  async getDashboard(): Promise<DashboardResponse> {
    const response = await axiosInstance.get<DashboardResponse>(
      "/api/v1/dashboard"
    );

    return response.data;
  },

  async getAnalytics(): Promise<AnalyticsResponse> {
    const response = await axiosInstance.get<AnalyticsResponse>(
      "/api/v1/analytics"
    );

    return response.data;
  },
};