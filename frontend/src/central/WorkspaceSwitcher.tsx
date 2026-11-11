import { ArrowLeft, Building2 } from "lucide-react";
import { currentWorkspace, selectWorkspace, workspaceNames } from "./transport";
export function WorkspaceSwitcher() {
 const scope=currentWorkspace();
 return <div className="central-workspace-switcher">{scope!=="all"&&<button onClick={()=>selectWorkspace("all")} aria-label="All portals" title="All portals"><ArrowLeft size={15}/></button>}<label><Building2 size={15}/><select aria-label="Portal workspace" value={scope} onChange={e=>selectWorkspace(e.target.value)}>{Object.entries(workspaceNames).map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label></div>;
}
