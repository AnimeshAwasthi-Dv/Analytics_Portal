import { useEffect, useState } from "react";
import { RefreshCw, Search, ShieldCheck } from "lucide-react";
import { WorkspaceDrawer } from "../pacs/WorkspaceDrawer";
import { commandGet, commandPost, currentWorkspace, workspaceNames } from "./transport";

type Resource={id:string;name:string;enabled:boolean|null;portal:string;centerName:string|null;details:Record<string,unknown>};
type Command={id:number;portal:string;action:string;target:string;enabled:boolean;reason:string;status:string;result:string|null};
type Kind="user"|"service"|"subscription";
const labels:Record<Kind,string>={user:"Portal users",service:"Services",subscription:"Center subscriptions"};

export default function AccessControls() {
  const [portal,setPortal]=useState(currentWorkspace()==="all"?"marengo":currentWorkspace());
  const [kind,setKind]=useState<Kind>("user");
  const [query,setQuery]=useState("");const [page,setPage]=useState(1);
  const queryKey=JSON.stringify([portal,kind,query,page]);
  const [snapshot,setSnapshot]=useState<{key:string;data:{items:Resource[];total:number}}>();
  const result=snapshot?.key===queryKey?snapshot.data:undefined;
  const [commands,setCommands]=useState<Command[]>([]);
  const [revision,refresh]=useState(0);const [error,setError]=useState("");
  const [selected,setSelected]=useState<Resource|null>(null);const [reason,setReason]=useState("");
  const [review,setReview]=useState(false);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState("");
  const [requestKey,setRequestKey]=useState("");
  useEffect(()=>{let active=true;const timer=setTimeout(()=>{void Promise.all([commandGet<{items:Resource[];total:number}>("inventory",{portal,kind,q:query,page:String(page)}),commandGet<{items:Command[]}>("controls")]).then(([data,history])=>{if(active){setSnapshot({key:queryKey,data});setCommands(history.items.filter(c=>c.portal===portal));setError("");}}).catch(e=>{if(active)setError(e.message);});},200);return()=>{active=false;clearTimeout(timer);};},[portal,kind,query,page,revision,queryKey]);
  return <div className="central-view"><header className="pw-heading"><div><span className="pw-breadcrumb">Dectrocel / Portal administration</span><h1>Access controls</h1><p className="central-description">Review a desired access state and its reason. The result is recorded after the portal worker applies it.</p></div><button onClick={()=>refresh(n=>n+1)}><RefreshCw size={15}/>Refresh</button></header>
    {error&&<div className="pw-alert" role="alert">{error}</div>}{notice&&<div className="pw-alert success" role="status">{notice}</div>}
    <div className="pw-toolbar">{currentWorkspace()==="all"&&<select aria-label="Control portal" value={portal} onChange={e=>{setPortal(e.target.value);setPage(1);}}>{["marengo","goyal","pacs"].map(c=><option key={c} value={c}>{workspaceNames[c]}</option>)}</select>}<select aria-label="Control resource" value={kind} onChange={e=>{setKind(e.target.value as Kind);setPage(1);}}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><label className="pw-search"><Search size={16}/><input aria-label="Search control resources" placeholder="Name or source ID" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label></div>
    <div className="pw-table-scroll"><table className="pw-data-table"><thead><tr><th>{labels[kind]}</th><th>Center</th><th>Observed access</th><th>Source role / service</th><th/></tr></thead><tbody>{result?.items.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.centerName||"Portal-wide"}</td><td>{r.enabled===null?"Not recorded":r.enabled?"Active":"Inactive"}</td><td>{String(r.details.role||r.details.code||r.details.workflow||"-")}</td><td><button disabled={r.enabled===null||r.details.role==="SUPER_ADMIN"} onClick={()=>{setSelected(r);setReason("");setReview(false);setRequestKey(crypto.randomUUID());}}>Review access</button></td></tr>)}{!result?.items.length&&<tr><td colSpan={5}><div className="pw-empty">{result?"No matching source resources.":error?"Resource inventory unavailable.":"Loading resources..."}</div></td></tr>}</tbody></table></div>
    <footer className="pw-footer"><span>{result?.total??"-"} source records</span><div className="pw-pagination"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>{page}</span><button disabled={!result||page*25>=result.total} onClick={()=>setPage(p=>p+1)}>Next</button></div></footer>
    <section className="central-command-history"><h2>Recent control requests</h2><table className="pw-data-table"><thead><tr><th>Request</th><th>Action</th><th>Target</th><th>Desired access</th><th>Result</th></tr></thead><tbody>{commands.filter(c=>c.portal===portal).slice(0,10).map(c=><tr key={c.id}><td>#{c.id}</td><td>{c.action.replaceAll("_"," ")}</td><td>{c.target}</td><td>{c.enabled?"Active":"Inactive"}</td><td>{c.status}{c.result&&<small>{c.result}</small>}</td></tr>)}{!commands.length&&<tr><td colSpan={5}>No recorded requests for this portal.</td></tr>}</tbody></table></section>
    {selected&&<WorkspaceDrawer title={review?"Confirm access request":"Review access"} onClose={()=>{if(!busy)setSelected(null);}}><form className="central-form" onSubmit={async e=>{e.preventDefault();if(!review){setReview(true);return;}setBusy(true);try{const response=await commandPost<{id:number}>(`portals/${portal}/controls`,{action:`${kind}_access`,targetId:selected.id,enabled:!selected.enabled,reason,requestKey});setSelected(null);setNotice(`Request #${response.id} queued. Refresh to check its outcome and observed access.`);refresh(n=>n+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><p><strong>{workspaceNames[portal]}</strong> / {selected.name}</p><p>Access: {selected.enabled?"Active to Inactive":"Inactive to Active"}</p><label>Operational reason<textarea required minLength={8} maxLength={500} value={reason} readOnly={review} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<button className="pw-primary" disabled={busy}><ShieldCheck size={15}/>{busy?"Queuing...":review?"Confirm and queue":"Review request"}</button></form></WorkspaceDrawer>}
  </div>;
}
