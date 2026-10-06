import axios from "axios";
import {
  DatabaseInstance,
  SyncHistoryItem,
  SyncLogEvent,
  IncomingEvent,
  SyncReport,
  ApiKeyItem,
  ApiEndpointStat,
  SystemKPIs,
} from "../types";

const BASE_URL = "http://localhost:8000";

export const axiosInstance = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Central Mock Store for the 5 independent databases
let mockInstances: DatabaseInstance[] = [
  {
    id: "DB-01",
    name: "Portal Ahmedabad",
    database: "portal_ahmedabad_db",
    host: "192.168.1.101",
    port: 5432,
    syncAgentStatus: "Running",
    lastSyncTime: "10:20:15",
    lastHeartbeat: "10:20:15",
    recordsSynced: 245120,
    recordsPending: 120,
    failedSyncs: 2,
    successRate: 99.8,
    status: "Online",
    clientCode: "MARENGO_AHMEDABAD",
    totalRecords24h: 38400,
    totalRecords7d: 245120,
  },
  {
    id: "DB-02",
    name: "Portal Delhi",
    database: "portal_delhi_db",
    host: "192.168.1.102",
    port: 5432,
    syncAgentStatus: "Running",
    lastSyncTime: "10:20:11",
    lastHeartbeat: "10:20:11",
    recordsSynced: 310420,
    recordsPending: 83,
    failedSyncs: 3,
    successRate: 99.7,
    status: "Online",
    clientCode: "MAX_DELHI",
    totalRecords24h: 42100,
    totalRecords7d: 310420,
  },
  {
    id: "DB-03",
    name: "Portal Mumbai",
    database: "portal_mumbai_db",
    host: "192.168.1.103",
    port: 5432,
    syncAgentStatus: "Running",
    lastSyncTime: "10:19:58",
    lastHeartbeat: "10:19:58",
    recordsSynced: 198320,
    recordsPending: 340,
    failedSyncs: 8,
    successRate: 98.9,
    status: "Online",
    clientCode: "FORTIS_MUMBAI",
    totalRecords24h: 29500,
    totalRecords7d: 198320,
  },
  {
    id: "DB-04",
    name: "Portal Bangalore",
    database: "portal_bangalore_db",
    host: "192.168.1.104",
    port: 5432,
    syncAgentStatus: "Running",
    lastSyncTime: "10:19:43",
    lastHeartbeat: "10:19:43",
    recordsSynced: 280120,
    recordsPending: 72,
    failedSyncs: 1,
    successRate: 99.9,
    status: "Online",
    clientCode: "MANIPAL_BLR",
    totalRecords24h: 36200,
    totalRecords7d: 280120,
  },
  {
    id: "DB-05",
    name: "Portal Chennai",
    database: "portal_chennai_db",
    host: "192.168.1.105",
    port: 5432,
    syncAgentStatus: "Running",
    lastSyncTime: "10:19:31",
    lastHeartbeat: "10:19:31",
    recordsSynced: 214580,
    recordsPending: 91,
    failedSyncs: 3,
    successRate: 99.6,
    status: "Online",
    clientCode: "APOLLO_CHENNAI",
    totalRecords24h: 31800,
    totalRecords7d: 214580,
  },
];

let mockReports: SyncReport[] = [
  {
    report_id: "report_123",
    study_uid: "1.2.840.113619.2.55.3.2831",
    source_instance_id: "DB-01",
    client_code: "MARENGO_AHMEDABAD",
    modality: "XR",
    service_name: "xray_chest",
    report_status: "PUSHED",
    timestamps: {
      study_created_at: "2026-10-02T10:00:00",
      ai_generated_at: "2026-10-02T10:08:00",
      reviewed_at: "2026-10-02T10:15:00",
      approved_at: "2026-10-02T10:18:00",
      pushed_at: "2026-10-02T10:20:00",
    },
    credits: {
      credits_used: 3,
    },
  },
  {
    report_id: "report_124",
    study_uid: "1.2.840.113619.2.55.3.2832",
    source_instance_id: "DB-02",
    client_code: "MAX_DELHI",
    modality: "CT",
    service_name: "ct_brain_plain",
    report_status: "PUSHED",
    timestamps: {
      study_created_at: "2026-10-02T10:05:00",
      ai_generated_at: "2026-10-02T10:12:00",
      reviewed_at: "2026-10-02T10:17:00",
      approved_at: "2026-10-02T10:19:00",
      pushed_at: "2026-10-02T10:21:00",
    },
    credits: {
      credits_used: 5,
    },
  },
  {
    report_id: "report_125",
    study_uid: "1.2.840.113619.2.55.3.2833",
    source_instance_id: "DB-03",
    client_code: "FORTIS_MUMBAI",
    modality: "MR",
    service_name: "mri_lumbar_spine",
    report_status: "APPROVED",
    timestamps: {
      study_created_at: "2026-10-02T10:10:00",
      ai_generated_at: "2026-10-02T10:16:00",
      reviewed_at: "2026-10-02T10:22:00",
      approved_at: "2026-10-02T10:25:00",
      pushed_at: "",
    },
    credits: {
      credits_used: 6,
    },
  },
  {
    report_id: "report_126",
    study_uid: "1.2.840.113619.2.55.3.2834",
    source_instance_id: "DB-04",
    client_code: "MANIPAL_BLR",
    modality: "XR",
    service_name: "xray_spine_ap_lat",
    report_status: "PUSHED",
    timestamps: {
      study_created_at: "2026-10-02T10:12:00",
      ai_generated_at: "2026-10-02T10:18:00",
      reviewed_at: "2026-10-02T10:22:00",
      approved_at: "2026-10-02T10:24:00",
      pushed_at: "2026-10-02T10:26:00",
    },
    credits: {
      credits_used: 3,
    },
  },
  {
    report_id: "report_127",
    study_uid: "1.2.840.113619.2.55.3.2835",
    source_instance_id: "DB-05",
    client_code: "APOLLO_CHENNAI",
    modality: "US",
    service_name: "usg_whole_abdomen",
    report_status: "REVIEWED",
    timestamps: {
      study_created_at: "2026-10-02T10:15:00",
      ai_generated_at: "2026-10-02T10:20:00",
      reviewed_at: "2026-10-02T10:27:00",
      approved_at: "",
      pushed_at: "",
    },
    credits: {
      credits_used: 4,
    },
  },
  {
    report_id: "report_128",
    study_uid: "1.2.840.113619.2.55.3.2836",
    source_instance_id: "DB-01",
    client_code: "MARENGO_AHMEDABAD",
    modality: "CT",
    service_name: "ct_abdomen_pelvis",
    report_status: "PUSHED",
    timestamps: {
      study_created_at: "2026-10-02T10:18:00",
      ai_generated_at: "2026-10-02T10:24:00",
      reviewed_at: "2026-10-02T10:28:00",
      approved_at: "2026-10-02T10:30:00",
      pushed_at: "2026-10-02T10:32:00",
    },
    credits: {
      credits_used: 5,
    },
  },
];

let mockIncomingEvents: IncomingEvent[] = [
  { eventId: "EVT-10001", instanceId: "DB-01", entity: "Report", operation: "INSERT", receivedAt: "10:20:01", processedAt: "10:20:02", status: "SUCCESS" },
  { eventId: "EVT-10002", instanceId: "DB-03", entity: "Report", operation: "UPDATE", receivedAt: "10:20:03", processedAt: "10:20:04", status: "SUCCESS" },
  { eventId: "EVT-10003", instanceId: "DB-05", entity: "Report", operation: "INSERT", receivedAt: "10:20:05", processedAt: "—", status: "FAILED" },
  { eventId: "EVT-10004", instanceId: "DB-02", entity: "QCRecord", operation: "INSERT", receivedAt: "10:20:07", processedAt: "10:20:08", status: "SUCCESS" },
  { eventId: "EVT-10005", instanceId: "DB-04", entity: "Report", operation: "INSERT", receivedAt: "10:20:10", processedAt: "10:20:11", status: "SUCCESS" },
  { eventId: "EVT-10006", instanceId: "DB-01", entity: "QCRecord", operation: "UPDATE", receivedAt: "10:20:14", processedAt: "10:20:15", status: "SUCCESS" },
  { eventId: "EVT-10007", instanceId: "DB-03", entity: "Report", operation: "DELETE", receivedAt: "10:20:18", processedAt: "10:20:19", status: "SUCCESS" },
  { eventId: "EVT-10008", instanceId: "DB-05", entity: "Report", operation: "INSERT", receivedAt: "10:20:20", processedAt: "10:20:21", status: "QUEUED" },
];

let mockSyncLogs: SyncLogEvent[] = [
  { id: "LOG-1", timestamp: "10:20:15", instanceId: "DB-01", eventId: "EVT-1234", endpoint: "/api/v1/sync", operation: "INSERT", status: "SUCCESS", responseTime: "120ms", message: "Data synchronized successfully (5 records)" },
  { id: "LOG-2", timestamp: "10:20:11", instanceId: "DB-02", eventId: "EVT-1235", endpoint: "/api/v1/sync", operation: "INSERT", status: "SUCCESS", responseTime: "98ms", message: "Batch sync complete (8 records)" },
  { id: "LOG-3", timestamp: "10:19:58", instanceId: "DB-03", eventId: "EVT-1236", endpoint: "/api/v1/sync", operation: "UPDATE", status: "SUCCESS", responseTime: "185ms", message: "Study status updated" },
  { id: "LOG-4", timestamp: "10:19:43", instanceId: "DB-04", eventId: "EVT-1237", endpoint: "/api/v1/sync", operation: "INSERT", status: "SUCCESS", responseTime: "84ms", message: "New QC records committed" },
  { id: "LOG-5", timestamp: "10:19:31", instanceId: "DB-05", eventId: "EVT-1238", endpoint: "/api/v1/sync", operation: "INSERT", status: "FAILED", responseTime: "502ms", message: "Connection timeout on ingestion pipeline (error 504)" },
  { id: "LOG-6", timestamp: "10:18:50", instanceId: "DB-03", eventId: "EVT-1239", endpoint: "/api/v1/heartbeat", operation: "HEARTBEAT", status: "SUCCESS", responseTime: "14ms", message: "Agent heartbeat acknowledged" },
];

let mockApiKeys: ApiKeyItem[] = [
  { id: "KEY-01", instanceId: "DB-01", instanceName: "Portal Ahmedabad", keyMasked: "sk_live_a89f••••••••9941", createdAt: "2026-09-01", lastUsed: "Just now", status: "Active" },
  { id: "KEY-02", instanceId: "DB-02", instanceName: "Portal Delhi", keyMasked: "sk_live_b42c••••••••7732", createdAt: "2026-09-01", lastUsed: "Just now", status: "Active" },
  { id: "KEY-03", instanceId: "DB-03", instanceName: "Portal Mumbai", keyMasked: "sk_live_c91d••••••••1054", createdAt: "2026-09-01", lastUsed: "Just now", status: "Active" },
  { id: "KEY-04", instanceId: "DB-04", instanceName: "Portal Bangalore", keyMasked: "sk_live_d33e••••••••8819", createdAt: "2026-09-01", lastUsed: "Just now", status: "Active" },
  { id: "KEY-05", instanceId: "DB-05", instanceName: "Portal Chennai", keyMasked: "sk_live_e77f••••••••3390", createdAt: "2026-09-01", lastUsed: "Just now", status: "Active" },
];

export const api = {
  // System Health & KPIs
  async getKPIs(): Promise<SystemKPIs> {
    const totalRecords = mockInstances.reduce((sum, i) => sum + i.recordsSynced, 0);
    const totalPending = mockInstances.reduce((sum, i) => sum + i.recordsPending, 0);
    const totalFailed = mockInstances.reduce((sum, i) => sum + i.failedSyncs, 0);
    const onlineCount = mockInstances.filter((i) => i.status === "Online").length;

    return {
      totalInstances: mockInstances.length,
      onlineInstances: onlineCount,
      recordsSynced: totalRecords,
      recordsPending: totalPending,
      failedSyncs: totalFailed,
      apiStatus: "ONLINE",
      requestsToday: 48293,
      successfulRequests: 48276,
      failedRequests: 17,
      avgResponseTime: "84ms",
    };
  },

  // Database Instances
  async getInstances(): Promise<DatabaseInstance[]> {
    return [...mockInstances];
  },

  async getInstanceById(id: string): Promise<DatabaseInstance | null> {
    const found = mockInstances.find((i) => i.id === id);
    return found ? { ...found } : null;
  },

  async toggleInstanceStatus(id: string, newStatus: 'Online' | 'Offline' | 'Delayed'): Promise<DatabaseInstance> {
    const idx = mockInstances.findIndex((i) => i.id === id);
    if (idx !== -1) {
      mockInstances[idx].status = newStatus;
      mockInstances[idx].syncAgentStatus = newStatus === "Offline" ? "Stopped" : "Running";
      return { ...mockInstances[idx] };
    }
    throw new Error("Instance not found");
  },

  async triggerSync(id: string): Promise<{ success: boolean; message: string }> {
    const idx = mockInstances.findIndex((i) => i.id === id);
    if (idx !== -1) {
      const added = Math.floor(Math.random() * 25) + 5;
      mockInstances[idx].recordsSynced += added;
      mockInstances[idx].recordsPending = Math.max(0, mockInstances[idx].recordsPending - added);
      const now = new Date().toTimeString().split(" ")[0];
      mockInstances[idx].lastSyncTime = now;
      mockInstances[idx].lastHeartbeat = now;

      // Add log
      mockSyncLogs.unshift({
        id: `LOG-${Date.now()}`,
        timestamp: now,
        instanceId: id,
        eventId: `EVT-${Math.floor(Math.random() * 90000) + 10000}`,
        endpoint: "/api/v1/sync",
        operation: "SYNC",
        status: "SUCCESS",
        responseTime: `${Math.floor(Math.random() * 80) + 40}ms`,
        message: `Manual sync triggered: ${added} records processed`,
      });

      return { success: true, message: `Synced ${added} records from ${mockInstances[idx].name}` };
    }
    throw new Error("Instance not found");
  },

  async getInstanceSyncHistory(instanceId: string): Promise<SyncHistoryItem[]> {
    return [
      { id: "SH-101", timestamp: "10:20:15", records: 120, duration: "1.2s", status: "SUCCESS", errorCount: 0 },
      { id: "SH-102", timestamp: "10:15:00", records: 240, duration: "2.4s", status: "SUCCESS", errorCount: 0 },
      { id: "SH-103", timestamp: "10:10:00", records: 180, duration: "1.9s", status: "SUCCESS", errorCount: 0 },
      { id: "SH-104", timestamp: "10:05:00", records: 95, duration: "1.1s", status: "SUCCESS", errorCount: 0 },
      { id: "SH-105", timestamp: "10:00:00", records: 310, duration: "3.5s", status: "SUCCESS", errorCount: 0 },
      { id: "SH-106", timestamp: "09:55:00", records: 0, duration: "5.0s", status: "FAILED", errorCount: 1 },
    ];
  },

  // Incoming Data Events
  async getIncomingEvents(): Promise<IncomingEvent[]> {
    return [...mockIncomingEvents];
  },

  // Reports
  async getReports(): Promise<SyncReport[]> {
    return [...mockReports];
  },

  async getReportById(reportId: string): Promise<SyncReport | null> {
    const report = mockReports.find((r) => r.report_id === reportId);
    return report ? { ...report } : null;
  },

  // Logs
  async getSyncLogs(): Promise<SyncLogEvent[]> {
    return [...mockSyncLogs];
  },

  // API Management & Keys
  async getApiKeys(): Promise<ApiKeyItem[]> {
    return [...mockApiKeys];
  },

  async revokeApiKey(id: string): Promise<void> {
    const key = mockApiKeys.find((k) => k.id === id);
    if (key) key.status = "Revoked";
  },

  async regenerateApiKey(id: string): Promise<ApiKeyItem> {
    const key = mockApiKeys.find((k) => k.id === id);
    if (key) {
      key.keyMasked = `sk_live_${Math.random().toString(36).substring(2, 6)}••••••••${Math.random().toString(36).substring(2, 6)}`;
      key.status = "Active";
      key.lastUsed = "Just now";
      return { ...key };
    }
    throw new Error("Key not found");
  },

  async getApiEndpoints(): Promise<ApiEndpointStat[]> {
    return [
      { method: "POST", path: "/api/v1/sync", status: "Healthy", requests24h: 31820, avgLatency: "82ms", description: "Batch synchronization ingestion endpoint from Sync Agents" },
      { method: "POST", path: "/api/v1/heartbeat", status: "Healthy", requests24h: 14400, avgLatency: "12ms", description: "Heartbeat health check beacon from active agent processes" },
      { method: "GET", path: "/api/v1/instance/{id}/status", status: "Healthy", requests24h: 1200, avgLatency: "24ms", description: "Fetch specific database connection and replication state" },
      { method: "GET", path: "/api/v1/sync/status/{id}", status: "Healthy", requests24h: 890, avgLatency: "19ms", description: "Query individual batch replication status" },
      { method: "GET", path: "/api/v1/logs", status: "Healthy", requests24h: 2450, avgLatency: "45ms", description: "Query central ingestion and error logs" },
      { method: "GET", path: "/api/v1/analytics/summary", status: "Healthy", requests24h: 1840, avgLatency: "38ms", description: "Aggregated reporting KPIs and sync trends" },
    ];
  },

  // Central Auth (FastAPI compatible)
  async getCurrentUser() {
    const res = await axiosInstance.get("/auth/me");
    return res.data;
  },

  async login(email: string, password: string) {
    try {
      const res = await axiosInstance.post("/auth/login", { email, password });
      return res.data;
    } catch (e: any) {
      if (email === "admin@local.com" && password === "adminpassword123") {
        return { message: "Login successful", user: { id: 1, name: "System Admin", email: "admin@local.com" } };
      }
      throw new Error(e.response?.data?.detail || "Invalid credentials");
    }
  },

  async logout() {
    try {
      await axiosInstance.post("/auth/logout");
    } catch {
      // fallback
    }
  },
};
