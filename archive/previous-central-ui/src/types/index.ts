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
  id: number | string;
  instanceCode: string;
  modality: string | null;
  studyDescription: string | null;
  patientName?: string | null;
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
  availableModalities: string[];
  daily: Array<{
    date: string;
    instanceCode: string;
    modality: string;
    records: number;
    credits: number;
  }>;
  byDescription: Array<{
    date: string;
    instanceCode: string;
    modality: string;
    studyDescription: string | null;
    records: number;
    credits: number;
  }>;
  byInstance: Array<{
    instanceCode: string;
    modality: string;
    records: number;
    credits: number;
  }>;
  byCentre: Array<{
    centreId: string;
    centreName: string;
    instanceCode: string;
    studies: number;
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

export type DashboardLoadResult =
  | { ok: true; data: DashboardResponse }
  | { ok: false; error: unknown };
