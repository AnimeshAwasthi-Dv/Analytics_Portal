export interface DatabaseInstance {
  id: string;
  name: string;
  database: string;
  host: string;
  port: number;
  syncAgentStatus: 'Running' | 'Degraded' | 'Stopped';
  lastSyncTime: string;
  lastHeartbeat: string;
  recordsSynced: number;
  recordsPending: number;
  failedSyncs: number;
  successRate: number;
  status: 'Online' | 'Delayed' | 'Offline';
  clientCode: string;
  totalRecords24h: number;
  totalRecords7d: number;
}

export interface SyncHistoryItem {
  id: string;
  timestamp: string;
  records: number;
  duration: string;
  status: 'SUCCESS' | 'PROCESSING' | 'PENDING' | 'FAILED';
  errorCount: number;
}

export interface SyncLogEvent {
  id: string;
  timestamp: string;
  instanceId: string;
  eventId: string;
  endpoint: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'SYNC' | 'HEARTBEAT';
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'PROCESSING';
  responseTime: string;
  message: string;
}

export interface IncomingEvent {
  eventId: string;
  instanceId: string;
  entity: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  receivedAt: string;
  processedAt: string;
  status: 'SUCCESS' | 'FAILED' | 'QUEUED';
}

export interface SyncReport {
  report_id: string;
  study_uid: string;
  source_instance_id: string;
  client_code: string;
  modality: string;
  service_name: string;
  report_status: 'PUSHED' | 'APPROVED' | 'REVIEWED' | 'AI_GENERATED' | 'CREATED';
  timestamps: {
    study_created_at: string;
    ai_generated_at: string;
    reviewed_at: string;
    approved_at: string;
    pushed_at: string;
  };
  credits: {
    credits_used: number;
  };
}

export interface ApiKeyItem {
  id: string;
  instanceId: string;
  instanceName: string;
  keyMasked: string;
  createdAt: string;
  lastUsed: string;
  status: 'Active' | 'Revoked';
}

export interface ApiEndpointStat {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  status: 'Active' | 'Healthy' | 'Degraded';
  requests24h: number;
  avgLatency: string;
  description: string;
}

export interface SystemKPIs {
  totalInstances: number;
  onlineInstances: number;
  recordsSynced: number;
  recordsPending: number;
  failedSyncs: number;
  apiStatus: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  requestsToday: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: string;
}
