import axios from "axios";

const BASE_URL = "http://localhost:8000";

export const axiosInstance = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

export const api = {
  async getCurrentUser() {
    const response = await axiosInstance.get("/auth/me");
    return response.data;
  },

  async login(email: string, password: string) {
    const response = await axiosInstance.post("/auth/login", {
      email,
      password,
    });

    return response.data;
  },

  async logout() {
    await axiosInstance.post("/auth/logout");
  },

  async getDashboard() {
    const response = await axiosInstance.get(
      "/api/v1/dashboard"
    );

    return response.data;
  },
};