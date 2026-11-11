// These pages own their data requests and do not consume the legacy full overview.
export function needsFullAdminOverview(section: string) {
  return !new Set(['Dashboard', 'Clients', 'Group Admins', 'Technical Alerts', 'Healthcheck', 'Analytics', 'Audit Logs', 'Patients', 'Follow-ups']).has(section);
}
