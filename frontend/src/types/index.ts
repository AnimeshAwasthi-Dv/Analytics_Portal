export interface DashboardKPIs {
  totalInstances: number;
  onlineInstances: number;
  recordsSynced: number;
  recordsPending: number;
  failedSyncs: number;
  successRate: number;
  apiStatus: string;
  avgResponseTime: string;
}

export interface DatabaseInstance {
  id: string;
  name: string;
  status: string;
  lastSyncTime: string;
  lastSyncTimestamp: string | null;
  recordsSynced: number;
  recordsPending: number;
  failedSyncs: number;
  successRate: number;
}

export interface DashboardResponse {
  kpis: DashboardKPIs;
  instances: DatabaseInstance[];
}