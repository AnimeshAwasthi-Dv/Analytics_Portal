import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type DesktopLicense } from "../services/api";
import { GeoLocationMap, isValidCoordinate } from "../Components/GeoLocationMap";
import "./desktop.css";

type Usage = "Unused" | "Low usage" | "Medium usage" | "High usage";
const usageFor = (license: DesktopLicense): Usage => {
  if (license.creditsTotal <= 0) return license.creditsRemaining === 0 ? "High usage" : "Unused";
  const used = Math.max(0, license.creditsTotal - license.creditsRemaining) / license.creditsTotal;
  if (used === 0) return "Unused";
  if (used < 0.25) return "Low usage";
  if (used < 0.75) return "Medium usage";
  return "High usage";
};
const countRows = (items: DesktopLicense[], label: (x: DesktopLicense) => string) => {
  const counts = new Map<string, number>();
  items.forEach(item => { const key = label(item) || "Unassigned"; counts.set(key, (counts.get(key) ?? 0) + 1); });
  return [...counts].map(([name,count]) => ({name,count})).sort((a,b) => b.count-a.count);
};

export function LicenseAnalyticsPage() {
  const navigate = useNavigate();
  const [service,setService]=useState("XRAY");
  const [items,setItems]=useState<DesktopLicense[]>([]);
  const [error,setError]=useState("");
  const [search,setSearch]=useState("");
  const [organisation,setOrganisation]=useState("ALL");
  const [platform,setPlatform]=useState("ALL");
  const [status,setStatus]=useState("ALL");
  const [usage,setUsage]=useState("ALL");
  const [planFilter,setPlanFilter]=useState("ALL");
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{let alive=true;setError("");api.getDesktopLicenses(service).then(rows=>{if(alive)setItems(rows);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:"Unable to fetch license analytics. Check the backend and database migration.");});return()=>{alive=false;};},[service,refresh]);
  const visible=useMemo(()=>items.filter(x=>{
    const term=search.trim().toLowerCase();
    return (!term||[x.licenseKey,x.fullName,x.username,x.mobile,x.vendor,x.location].some(v=>v?.toLowerCase().includes(term))) &&
      (organisation==="ALL"||(x.vendor||"Unassigned")===organisation) && (platform==="ALL"||x.platform===platform) &&
      (status==="ALL"||x.status===status) && (planFilter==="ALL"||String(x.planId)===planFilter) &&
      (usage==="ALL"||usageFor(x)===usage);
  }),[items,search,organisation,platform,status,usage,planFilter]);
  const platformRows=countRows(visible,x=>x.platform);
  const statusRows=countRows(visible,x=>x.status);
  const organisationRows=countRows(visible,x=>x.vendor||"Unassigned").slice(0,10);
  const planRows=countRows(visible,x=>x.planName).slice(0,10);
  const usageRows=["Unused","Low usage","Medium usage","High usage"].map(name=>({name,count:visible.filter(x=>usageFor(x)===name).length}));
  const totalCredits=visible.reduce((sum,x)=>sum+x.creditsTotal,0);
  const remaining=visible.reduce((sum,x)=>sum+x.creditsRemaining,0);
  const creditsUsed=Math.max(0,totalCredits-remaining);
  const active=visible.filter(x=>x.status==="In Use").length;
  const available=visible.filter(x=>x.status==="Available").length;
  const blocked=visible.filter(x=>["Blocked","Revoked"].includes(x.status)).length;
  const validationCount=visible.reduce((sum,x)=>sum+x.successfulValidationCount,0);
  const maxByDate=new Map<string,number>();visible.forEach(x=>{const dates=[x.createdAt,...(x.activationCount?[x.startsAt]:[]),x.lastValidationAt,x.lastSync];dates.forEach(value=>{if(value){const day=value.slice(0,10);maxByDate.set(day,(maxByDate.get(day)??0)+1);}});});
  const timeline=[...maxByDate].sort(([a],[b])=>a.localeCompare(b)).slice(-14);
  const maxTimeline=Math.max(1,...timeline.map(([,n])=>n));
  const mapped=visible.filter(x=>isValidCoordinate(x.latitude,x.longitude));
  const bar=(rows:Array<{name:string;count:number}>)=><div className="license-bars">{rows.map(r=><div className="license-bar-row" key={r.name}><div><span>{r.name}</span><strong>{r.count}</strong></div><i><b style={{width:`${Math.max(1,100*r.count/Math.max(1,...rows.map(x=>x.count)))}%`}}/></i></div>)}{!rows.length&&<p className="license-empty">No matching records.</p>}</div>;
  const clear=()=>{setSearch("");setOrganisation("ALL");setPlatform("ALL");setStatus("ALL");setUsage("ALL");setPlanFilter("ALL");};
  return <main className="license-page"><header className="license-header"><div><h1>Analytics</h1><p>Complete license activity, usage, organisation, platform, and location intelligence</p></div><button className="secondary" onClick={()=>setRefresh(x=>x+1)}>Refresh</button></header>
    <section className="license-filter-panel"><strong>Filters</strong><div className="license-filter-grid"><input aria-label="Search licenses" placeholder="Search license, user, mobile…" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Organisation" value={organisation} onChange={e=>setOrganisation(e.target.value)}><option value="ALL">All organisations</option>{[...new Set(items.map(x=>x.vendor||"Unassigned"))].sort().map(x=><option key={x}>{x}</option>)}</select><select aria-label="Platform" value={platform} onChange={e=>setPlatform(e.target.value)}><option value="ALL">All platforms</option>{[...new Set(items.map(x=>x.platform))].sort().map(x=><option key={x}>{x}</option>)}</select><select aria-label="Status" value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">All statuses</option>{[...new Set(items.map(x=>x.status))].sort().map(x=><option key={x}>{x}</option>)}</select><select aria-label="Usage level" value={usage} onChange={e=>setUsage(e.target.value)}><option value="ALL">All usage levels</option>{usageRows.map(x=><option key={x.name}>{x.name}</option>)}</select><select aria-label="Plan" value={planFilter} onChange={e=>setPlanFilter(e.target.value)}><option value="ALL">All plans</option>{[...new Map(items.map(x=>[x.planId,x.planName])).entries()].map(([id,name])=><option value={id} key={id}>{name}</option>)}</select><button className="text-button" onClick={clear}>Clear filters</button></div></section>
    <div className="license-toolbar"><div className="license-tabs">{[["XRAY","X-ray"],["CT","CT"]].map(([v,l])=><button key={v} className={service===v?"selected":""} onClick={()=>{setService(v);clear();}}>{l}</button>)}</div></div>
    {error&&<p className="license-message license-error">{error} If the license tables were just added, run <code>alembic upgrade head</code> from the backend directory and restart the API.</p>}
    {!error&&<><section className="license-kpis"><article><span>Visible keys</span><strong>{visible.length.toLocaleString()}</strong><small>{items.length.toLocaleString()} total for this service</small></article><article><span>Active / in use</span><strong>{active.toLocaleString()}</strong><small>{visible.length?Math.round(active*100/visible.length):0}% of filtered keys</small></article><article><span>Credits used</span><strong>{creditsUsed.toLocaleString()}</strong><small>{totalCredits?Math.round(creditsUsed*100/totalCredits):0}% of allocated credits</small></article><article><span>Validation activity</span><strong>{validationCount.toLocaleString()}</strong><small>{available} available, {blocked} blocked</small></article></section>
      <section className="license-analytics-grid license-analytics-three"><article className="license-panel"><h2>Platform mix</h2>{bar(platformRows)}</article><article className="license-panel"><h2>License status</h2>{bar(statusRows)}</article><article className="license-panel"><h2>Usage levels</h2>{bar(usageRows)}</article></section>
      <section className="license-analytics-grid"><article className="license-panel"><h2>Organisation wise usage</h2>{bar(organisationRows)}</article><article className="license-panel"><h2>Plan distribution</h2>{bar(planRows)}</article></section>
      <section className="license-panel license-timeline"><h2>Recent activity timeline</h2><div className="license-timeline-chart">{timeline.map(([day,count])=><div key={day} title={`${day}: ${count} events`}><i style={{height:`${Math.max(8,count*100/maxTimeline)}%`}}/><span>{new Date(`${day}T00:00:00`).toLocaleDateString(undefined,{month:"2-digit",day:"2-digit"})}</span></div>)}{!timeline.length&&<p className="license-empty">No dated license activity in this filter.</p>}</div><small>Bars combine license creation, activation, validation, and sync timestamps. Filtered view: {visible.length} licenses.</small></section>
      <section className="license-panel license-geo"><div className="license-section-title"><h2>Geo location map</h2><span>{mapped.length} mapped licenses in current filters</span></div><GeoLocationMap licenses={mapped}/></section>
      <div className="license-table-wrap"><div className="license-section-title"><h2>Detailed license activity</h2><span>{visible.length} rows</span></div><table><thead><tr><th>License</th><th>Organisation</th><th>Platform</th><th>Status</th><th>Credits left</th><th>Usage</th><th>Last sync</th><th>Actions</th></tr></thead><tbody>{visible.map(x=>{const used=Math.max(0,x.creditsTotal-x.creditsRemaining);const percent=x.creditsTotal?Math.round(used*100/x.creditsTotal):0;return <tr key={x.id}><td className="license-key">{x.licenseKey}</td><td>{x.vendor||"Unassigned"}</td><td>{x.platform}</td><td>{x.status}</td><td>{x.creditsRemaining}</td><td>{percent}%</td><td>{x.lastSync?new Date(x.lastSync).toLocaleString():"Never"}</td><td><button className="secondary" onClick={()=>navigate(`/desktop/key-analytics?licenseId=${x.id}`)}>Key analytics</button></td></tr>})}{!visible.length&&<tr><td colSpan={8} className="license-empty">No licenses match these filters.</td></tr>}</tbody></table></div>
    </>}
  </main>;
}
