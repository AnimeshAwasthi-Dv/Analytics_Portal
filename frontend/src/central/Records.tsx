import { useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { api } from "../pacs/lib/api";
import { WorkspaceDrawer } from "../pacs/WorkspaceDrawer";
import { currentWorkspace, workspaceNames } from "./transport";

type Row = Record<string,unknown> & {id:string;client?:{name?:string}};
type Result = {items:Row[];total:number;pageSize:number};
const kinds = {studies:"Studies",reports:"Reports",processing:"Processing jobs",jobs:"Job logs",usage:"Usage logs",billing:"Study billing",audit:"Audit logs"};
const timestamp=(row:Row)=>String(row.createdAt||row.generatedAt||row.updatedAt||"");
const displayTime=(value:string)=>value?new Date(value).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}):"—";
export default function Records() {
  const scope=currentWorkspace();
  const [portal,setPortal]=useState(["marengo","goyal","pacs"].includes(scope)?scope:"");
  const [kind,setKind]=useState("studies"),[page,setPage]=useState(1),[query,setQuery]=useState(""),[search,setSearch]=useState("");
  const [revision,setRevision]=useState(0),[selected,setSelected]=useState<Row|null>(null);
  const [result,setResult]=useState<{key:string;data?:Result;error?:string}>();
  const key=JSON.stringify([portal,kind,page,search,revision]);
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(query);setPage(1);},300);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>{
    if(!portal)return;
    const controller=new AbortController();
    const params=new URLSearchParams({kind,page:String(page),q:search});
    void api<Result>(`/api/pacs/${portal}/records?${params}`,undefined,{signal:controller.signal,cache:"no-store"})
      .then(data=>setResult({key,data})).catch(error=>{if(!controller.signal.aborted)setResult({key,error:error.message});});
    return()=>controller.abort();
  },[key]);
  const data=result?.key===key?result.data:undefined,error=result?.key===key?result.error:undefined;
  return <div className="central-view"><header className="pw-heading"><div><div className="pw-breadcrumb">Dectrocel / {workspaceNames[portal]||"Organization"}</div><h1>Records</h1><p className="central-description">Browse all source studies, reports and operational logs. No date filter is applied.</p></div><button onClick={()=>setRevision(n=>n+1)}><RefreshCw size={15}/>Refresh</button></header>
    <div className="pw-toolbar"><select aria-label="Records portal" value={portal} onChange={e=>{setPortal(e.target.value);setPage(1);setSelected(null);}}><option value="">Choose a portal</option>{["marengo","goyal","pacs"].map(code=><option value={code} key={code}>{workspaceNames[code]}</option>)}</select><select aria-label="Record type" value={kind} onChange={e=>{setKind(e.target.value);setPage(1);setSelected(null);}}>{Object.entries(kinds).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><label className="pw-search"><Search size={16}/><input aria-label="Search records" placeholder="Patient, study UID, record ID or log text..." value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
    {error&&<div className="pw-alert" role="alert">{error}</div>}
    {!portal?<p>Select the portal whose records you want to browse.</p>:!data&&!error?<p role="status">Loading records...</p>:data&&<><div className="pw-table-scroll"><table className="pw-data-table"><thead><tr><th>Time (IST)</th><th>Record</th><th>Center</th><th>Patient / service</th><th>Status / log</th><th/></tr></thead><tbody>{data.items.map(row=><tr key={row.id}><td>{displayTime(timestamp(row))}</td><td style={{maxWidth:220,overflowWrap:"anywhere"}}>{row.id}</td><td>{row.client?.name||"—"}</td><td>{String(row.patientName||row.serviceName||row.serviceType||row.patientId||"—")}</td><td style={{maxWidth:400,whiteSpace:"normal",overflowWrap:"anywhere"}}>{String(row.action||row.message||row.error||row.workflowStatus||row.status||"—").slice(0,200)}</td><td><button onClick={()=>setSelected(row)}>Inspect</button></td></tr>)}{!data.items.length&&<tr><td colSpan={6}>No matching records.</td></tr>}</tbody></table></div><footer className="pw-footer"><span>{data.total?((page-1)*data.pageSize+1).toLocaleString("en-IN"):0}–{Math.min(page*data.pageSize,data.total).toLocaleString("en-IN")} of {data.total.toLocaleString("en-IN")} records</span><div className="pw-pagination"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page}</span><button disabled={page*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>Next</button></div></footer></>}
    {selected&&<WorkspaceDrawer title="Record details" onClose={()=>setSelected(null)}>{kind==="reports"&&<a href={`/api/pacs/${portal}/reports/${encodeURIComponent(selected.id)}/pdf`} target="_blank" rel="noopener noreferrer">Open report PDF</a>}<pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(selected,null,2)}</pre></WorkspaceDrawer>}
  </div>;
}
