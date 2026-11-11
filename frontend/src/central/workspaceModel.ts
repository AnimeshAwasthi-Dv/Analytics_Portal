import { currentWorkspace } from "./transport";

export const organizationTabs=["Dashboard","Portals","Records","Analytics","Analysis assistant","Access controls","Internal Team","Audit Logs","Connections"];
export const onpremTabs=["Dashboard","License management","Workstations","Analytics","Audit Logs","Connections"];
export function isCentralSection(section:string) {
  return currentWorkspace()==="all" || currentWorkspace()==="onprem" || section==="Records" || section==="Analysis assistant" || section==="Access controls";
}
