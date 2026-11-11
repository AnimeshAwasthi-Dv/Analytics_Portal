export type CenterAssignment = { id: string; parentClientId: string | null };

/** Filter only the authorized studies already loaded from the worklist API. */
export function matchesHospitalClient(centerId: string | null | undefined, clientId: string, centers: readonly CenterAssignment[]) {
  if (!clientId) return true;
  if (!centerId) return false;
  const center = centers.find(item => item.id === centerId);
  if (!center) return false;
  return clientId === 'unassigned' ? !center.parentClientId : center.parentClientId === clientId || center.id === clientId;
}
