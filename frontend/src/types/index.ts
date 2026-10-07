export interface DashboardKPIs {
  totalInstances: number;
  onlineInstances: number;
  recordsSynced: number;
  failedSyncs: number;
  totalCredits: number;
  modalityCount: number;
}

export interface DatabaseInstance {
  id: string;
  name: string;
  status: string;
  lastSyncTime: string | null;
  recordsSynced: number;
  failedSyncs: number;
  successRate: number;
  modalities: string[];
}

export interface SyncRecord {
  id: number;
  instanceCode: string;
  modality: string | null;
  processingCreatedAt: string | null;
  processingCompletedAt: string | null;
  creditsUsed: number;
  syncStatus: string | null;
  syncedAt: string | null;
}

export interface AnalyticsResponse {
  summary: {
    totalRecords: number;
    totalCredits: number;
    totalModalities: number;
    sourceInstances: number;
  };
  byModality: Array<{
    modality: string;
    records: number;
    credits: number;
  }>;
  daily: Array<{
    date: string;
    modality: string;
    records: number;
    credits: number;
  }>;
  byInstance: Array<{
    instanceCode: string;
    modality: string;
    records: number;
    credits: number;
  }>;
  lastUpdated: string;
}

export interface DashboardResponse {
  kpis: DashboardKPIs;
  instances: DatabaseInstance[];
  recentRecords: SyncRecord[];
  lastUpdated: string;
}