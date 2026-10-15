import { useEffect, useState } from "react";
import { api, type DesktopLicense, type LicensePlan } from "../services/api";
import "./desktop.css";

export function DesktopLicensesPage() {
  const [service, setService] = useState("XRAY");
  const [items, setItems] = useState<DesktopLicense[]>([]);
  const [plans, setPlans] = useState<LicensePlan[]>([]);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<""|"single"|"bulk">("");
  const [editing, setEditing] = useState<DesktopLicense|null>(null);
  const [viewing, setViewing] = useState<DesktopLicense|null>(null);
  const [planId, setPlanId] = useState("");
  const [platform, setPlatform] = useState("DXP");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const load = async () => {
    setRefreshing(true);
    try {
      const [result, available] = await Promise.all([api.getDesktopLicensesPage(service, search, page, pageSize), api.getLicensePlans(service)]);
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setItems(result.items); setTotal(result.total); setPlans(available);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to load licenses"); }
    finally { setRefreshing(false); }
  };
  useEffect(() => { void load(); }, [service, page]);
  const create = async (form: FormData) => {
    const common = { service, planId:Number(planId), platform };
    try {
      if (mode === "bulk") {
        const result = await api.bulkCreateDesktopLicenses({...common, count:Number(form.get("count")), vendor:form.get("vendor"), location:form.get("location")});
        setMessage(`${result.created} licenses created.`);
      } else {
        const payload = {...common, fullName:form.get("fullName"), username:form.get("username"), mobile:form.get("mobile"), vendor:form.get("vendor"), location:form.get("location"), latitude:form.get("latitude") ? Number(form.get("latitude")) : null, longitude:form.get("longitude") ? Number(form.get("longitude")) : null};
        if(editing) await api.updateDesktopLicense(editing.id, payload); else await api.createDesktopLicense(payload);
        setMessage(editing?"License updated.":"License created.");
      }
      setMode(""); setEditing(null); await load();
    } catch(e) { setMessage(e instanceof Error ? e.message : "Could not create license"); }
  };
  return <main className="license-page"><header className="license-header"><div><h1>Desktop EXE · Licenses</h1><p>Generate and manage X-ray and CT license keys.</p></div><div className="license-actions"><button onClick={()=>setMode("single")}>Create license</button><button onClick={()=>setMode("bulk")}>Bulk generate</button></div></header>
    <div className="license-toolbar"><div className="license-tabs">{[["XRAY","X-ray"],["CT","CT"]].map(([value,label])=><button className={service===value?"selected":""} key={value} onClick={()=>{setService(value);setPage(1);}}>{label}</button>)}</div><input placeholder="Search key, name, mobile…" value={search} onChange={e=>setSearch(e.target.value)}/><button className="secondary" onClick={()=>{if(page===1)void load();else setPage(1);}}>Search</button><button className="secondary" onClick={()=>void load()} disabled={refreshing} aria-label="Refresh licenses and plans">{refreshing?"Refreshing...":"Refresh"}</button></div>
    {message && <p className="license-message">{message}</p>}
    <div className="license-table-wrap"><table><thead><tr><th>License key</th><th>Status</th><th>Plan</th><th>Platform</th><th>Credits left</th><th>Vendor</th><th>Username</th><th>Start date</th><th>End date</th><th>Actions</th></tr></thead><tbody>{items.map(x=><tr key={x.id}><td className="license-key">{x.licenseKey}</td><td><span className="license-status">{x.status}</span></td><td>{x.planName}</td><td>{x.platform}</td><td>{x.creditsRemaining}</td><td>{x.vendor||"—"}</td><td>{x.username||"—"}</td><td>{x.startsAt?new Date(x.startsAt).toLocaleDateString():"—"}</td><td>{x.endsAt?new Date(x.endsAt).toLocaleDateString():"—"}</td><td><div className="license-row-actions"><button className="secondary" onClick={()=>setViewing(x)}>View</button><button className="secondary" onClick={()=>{setEditing(x);setMode("single");setPlanId(String(x.planId));setPlatform(x.platform);}}>Edit</button><button className="danger" onClick={async()=>{if(!window.confirm(`Delete license ${x.licenseKey}?`))return;try{await api.deleteDesktopLicense(x.id);setMessage("License deleted.");await load();}catch(error){setMessage(error instanceof Error?error.message:"Could not delete license");}}}>Delete</button></div></td></tr>)}{items.length===0&&<tr><td colSpan={10} className="license-empty">No licenses yet. Create a plan, then generate a license.</td></tr>}</tbody></table></div>
    <div className="license-pagination"><span>{total ? `Showing ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, total)} of ${total}` : "0 licenses"}</span><div><button className="secondary" disabled={page <= 1 || refreshing} onClick={() => setPage(current => current - 1)}>Previous</button><span>Page {page} of {totalPages}</span><button className="secondary" disabled={page >= totalPages || refreshing} onClick={() => setPage(current => current + 1)}>Next</button></div></div>
    {viewing&&<div className="license-overlay" onClick={()=>setViewing(null)}><section className="license-modal" onClick={e=>e.stopPropagation()}><header><h2>License details</h2><button type="button" className="text-button" onClick={()=>setViewing(null)}>Close</button></header><div className="license-detail-list">{[["License key",viewing.licenseKey],["Status",viewing.status],["Plan",viewing.planName],["Credits remaining",viewing.creditsRemaining],["Platform",viewing.platform],["Full name",viewing.fullName],["Username",viewing.username],["Mobile",viewing.mobile],["Vendor",viewing.vendor],["Location",viewing.location],["Latitude",viewing.latitude],["Longitude",viewing.longitude],["Activation date",viewing.startsAt?new Date(viewing.startsAt).toLocaleString():null],["Expiry date",viewing.endsAt?new Date(viewing.endsAt).toLocaleString():null]].map(([label,value])=><div key={String(label)}><strong>{label}</strong><span>{value??"—"}</span></div>)}</div></section></div>}
    {mode && <div className="license-overlay"><form className="license-modal" onSubmit={e=>{e.preventDefault(); void create(new FormData(e.currentTarget));}}><header><h2>{mode==="bulk"?`Bulk ${service==="XRAY"?"X-ray":"CT"} license generation`:editing?"Edit license":`Create ${service==="XRAY"?"X-ray":"CT"} license`}</h2><button type="button" className="text-button" onClick={()=>{setMode("");setEditing(null);}}>Close</button></header>
      {mode==="bulk"&&<label>Number of licenses<input name="count" type="number" min="1" max="1000" required placeholder="50"/></label>}
      <label>Select plan<select required value={planId} onChange={e=>setPlanId(e.target.value)}><option value="">Choose a plan</option>{plans.map(p=><option value={p.id} key={p.id}>{p.name} · {p.credits} credits</option>)}</select>{!plans.length&&<small>Create a {service==="XRAY"?"X-ray":"CT"} plan first.</small>}</label>
      <label>Platform<select value={platform} onChange={e=>setPlatform(e.target.value)}>{["DXP","DCP","CXR"].map(p=><option key={p}>{p}</option>)}</select></label>
      {mode==="single"?<div className="license-form-grid"><label>Full name<input name="fullName" defaultValue={editing?.fullName??""} placeholder="Hospital / Doctor"/></label><label>Username<input name="username" defaultValue={editing?.username??""} placeholder="Username"/></label><label>Mobile<input name="mobile" defaultValue={editing?.mobile??""} placeholder="10-digit mobile"/></label><label>Vendor<input name="vendor" defaultValue={editing?.vendor??""} placeholder="Vendor / distributor"/></label><label>Location<input name="location" defaultValue={editing?.location??""} placeholder="City / site"/></label><label>Latitude<input name="latitude" type="number" step="any" defaultValue={editing?.latitude??""} placeholder="28.6139"/></label><label>Longitude<input name="longitude" type="number" step="any" defaultValue={editing?.longitude??""} placeholder="77.2090"/></label></div>:<div className="license-form-grid"><label>Vendor<input name="vendor" placeholder="Applied to all"/></label><label>Location<input name="location" placeholder="Applied to all"/></label></div>}
      <footer><button type="button" className="secondary" onClick={()=>{setMode("");setEditing(null);}}>Cancel</button><button disabled={!planId}>{mode==="bulk"?"Generate licenses":editing?"Save changes":"Generate license"}</button></footer></form></div>}
  </main>;
}
