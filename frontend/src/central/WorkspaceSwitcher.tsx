import { currentWorkspace, selectWorkspace, workspaceNames } from "./transport";
export function WorkspaceSwitcher() {
 const scope=currentWorkspace();
 return <nav className="central-workspace-switcher" aria-label="Portal bookmarks">{Object.entries(workspaceNames).map(([code,name])=><button key={code} className={scope===code?"active":""} aria-current={scope===code?"page":undefined} onClick={()=>selectWorkspace(code)}>{name}</button>)}</nav>;
}
