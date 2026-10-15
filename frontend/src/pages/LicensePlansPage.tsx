import { useEffect, useState } from "react";
import { api, type LicensePlan } from "../services/api";
import "./desktop.css";

export function LicensePlansPage() {
  const [service, setService] = useState("XRAY");
  const [items, setItems] = useState<LicensePlan[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LicensePlan | null>(null);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const load = () => api.getLicensePlansPage(service, page, pageSize)
    .then(result => { const lastPage = Math.max(1, Math.ceil(result.total / pageSize)); if (page > lastPage) { setPage(lastPage); return; } setItems(result.items); setTotal(result.total); })
    .catch(e => setMessage(e instanceof Error ? e.message : "Unable to load plans"));
  useEffect(() => { void load(); }, [service, page]);
  const openForm = (plan: LicensePlan | null = null) => { setEditing(plan); setOpen(true); };
  return <main className="license-page"><header className="license-header"><div><h1>Plans</h1><p>Create credit plans used by X-ray and CT desktop licenses.</p></div><button onClick={() => openForm()}>New plan</button></header>
    <div className="license-toolbar"><div className="license-tabs">{[["XRAY", "X-ray plans"], ["CT", "CT plans"]].map(([value, label]) => <button key={value} className={service === value ? "selected" : ""} onClick={() => { setService(value); setPage(1); }}>{label}</button>)}</div></div>
    {message && <p className="license-message">{message}</p>}
    <div className="license-table-wrap"><table><thead><tr><th>Plan name</th><th>Credits</th><th>Validity</th><th>Cost</th><th>Actions</th></tr></thead><tbody>{items.map(plan => <tr key={plan.id}><td><strong>{plan.name}</strong></td><td>{plan.credits.toLocaleString()}</td><td>{plan.validityDays ? `${plan.validityDays} days` : "No expiry"}</td><td>{plan.cost ? `₹${plan.cost.toLocaleString()}` : "—"}</td><td><div className="license-row-actions"><button className="secondary" onClick={() => openForm(plan)}>Edit</button><button className="danger" onClick={async () => { if (!window.confirm(`Delete plan “${plan.name}”?`)) return; try { await api.deleteLicensePlan(plan.id); setMessage("Plan deleted."); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not delete plan"); } }}>Delete</button></div></td></tr>)}{!items.length && <tr><td colSpan={5} className="license-empty">No plans for this service yet.</td></tr>}</tbody></table></div>
    <div className="license-pagination"><span>{total ? `Showing ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, total)} of ${total}` : "0 plans"}</span><div><button className="secondary" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</button><span>Page {page} of {totalPages}</span><button className="secondary" disabled={page >= totalPages} onClick={() => setPage(current => current + 1)}>Next</button></div></div>
    {open && <div className="license-overlay"><form className="license-modal" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const payload = { name: String(form.get("name")), service, credits: Number(form.get("credits")), validityDays: Number(form.get("validityDays")), cost: Number(form.get("cost") || 0) }; try { if (editing) await api.updateLicensePlan(editing.id, payload); else await api.createLicensePlan(payload); setOpen(false); setMessage(editing ? "Plan updated." : "Plan created."); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save plan"); } }}>
      <header><h2>{editing ? "Edit" : "New"} {service === "XRAY" ? "X-ray" : "CT"} plan</h2><button type="button" className="text-button" onClick={() => setOpen(false)}>Close</button></header>
      <label>Plan name<input name="name" maxLength={255} required defaultValue={editing?.name ?? ""} placeholder="Standard 500 Credits" /></label>
      <div className="license-form-grid"><label>Credits<input name="credits" type="number" min="0" required defaultValue={editing?.credits ?? 100} /></label><label>Validity (days)<input name="validityDays" type="number" min="0" required defaultValue={editing?.validityDays ?? 30} /></label></div>
      <label>Plan cost (₹)<input name="cost" type="number" min="0" step="0.01" defaultValue={editing?.cost ?? 0} /><small>For reporting; use 0 for internal or free plans.</small></label>
      <footer><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button><button>{editing ? "Save changes" : "Create plan"}</button></footer>
    </form></div>}
  </main>;
}
