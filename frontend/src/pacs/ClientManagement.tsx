import { useState, type FormEvent } from 'react';
import { Building2, Plus, RefreshCw, Search, Settings2 } from 'lucide-react';
import { api } from './lib/api';
import { useLiveRefresh } from './useLiveRefresh';
import { WorkspaceDrawer } from './WorkspaceDrawer';
import { modalityCodes, modalityLabel } from './modalities';
import './organization.css';

type Account = { id: string; name: string; email: string; userId: string | null; active: boolean; portalRole?: string };
export type OrganizationRecord = {
  id: string; code: string; name: string; kind: 'GROUP' | 'CENTER'; parentClientId: string | null;
  hospitalSlug: string | null; facilityType: string; primaryContact: string; email: string; location: string | null;
  status: 'ACTIVE' | 'BLOCKED'; studySyncEnabled: boolean; autoReportingModalities: string[]; users: Account[];
  _count: { childClients: number; availableBridgeStudies: number; reportReviews: number };
};
type Editor = { kind: 'GROUP' | 'CENTER'; record?: OrganizationRecord };
type Credentials = { user: Account; temporaryPassword: string };
const blank = () => ({ name: '', facilityType: 'Hospital', primaryContact: '', email: '', hospitalSlug: '', parentClientId: '', location: '' });

export default function ClientManagement({ token, notice, reload, mode = 'clients', onConfigure }: {
  token: string; notice: (text: string) => void; reload: () => Promise<void>; mode?: 'clients' | 'centers'; onConfigure?: (id: string) => void;
}) {
  const [records, setRecords] = useState<OrganizationRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [form, setForm] = useState(blank);
  const [studySync, setStudySync] = useState(true);
  const [modalities, setModalities] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [userForm, setUserForm] = useState({ name: '', email: '', portalRole: 'FRONT_DESK' });
  const groups = records.filter(r => r.kind === 'GROUP');
  const centers = records.filter(r => r.kind === 'CENTER');
  const isCenters = mode === 'centers';
  async function load(signal?: AbortSignal) {
    const data = await api<{ records: OrganizationRecord[] }>('/api/admin/organization', token, { signal, cache: 'no-store' });
    if (!signal?.aborted) { setRecords(data.records); setLoaded(true); setError(''); }
  }
  useLiveRefresh(async signal => { try { await load(signal); } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load organization'); throw e; } }, { refreshKey: `${mode}:${refresh}`, intervalMs: 30000 });
  function open(kind: 'GROUP' | 'CENTER', record?: OrganizationRecord, parentId = '') {
    setForm(record ? { name: record.name, facilityType: record.facilityType, primaryContact: record.primaryContact, email: record.email, hospitalSlug: record.hospitalSlug ?? '', parentClientId: record.parentClientId ?? '', location: record.location ?? '' } : { ...blank(), parentClientId: parentId });
    setStudySync(record?.studySyncEnabled ?? true); setModalities(record?.autoReportingModalities ?? []);
    setFormError(''); setCredentials(null); setUserForm({ name: '', email: '', portalRole: 'FRONT_DESK' }); setEditor({ kind, record });
  }
  async function changed(message: string) {
    notice(message); setRefresh(n => n + 1);
    try { await load(); } catch { setError('Changes saved. Refresh to load the latest records.'); }
    void reload().catch(() => setError('Changes saved. Some workspace data could not refresh.'));
  }
  async function save(e: FormEvent) {
    e.preventDefault(); if (!editor || busy) return; setBusy(true); setFormError('');
    try {
      if (editor.record) {
        const id = editor.record.id;
        await api(`/api/admin/organization/${id}`, token, { method: 'PATCH', body: JSON.stringify({ name: form.name, facilityType: form.facilityType, primaryContact: form.primaryContact, email: form.email, location: form.location || null, ...(editor.kind === 'CENTER' ? { parentClientId: form.parentClientId || null } : { hospitalSlug: form.hospitalSlug }) }) });
        if (editor.kind === 'CENTER') {
          if (studySync !== editor.record.studySyncEnabled) await api(`/api/admin/clients/${id}/study-sync`, token, { method: 'PATCH', body: JSON.stringify({ studySyncEnabled: studySync }) });
          if ([...modalities].sort().join() !== [...editor.record.autoReportingModalities].sort().join()) await api(`/api/admin/clients/${id}/auto-reporting`, token, { method: 'PATCH', body: JSON.stringify({ modalities }) });
        }
      } else {
        const data = await api<Credentials>('/api/admin/clients', token, { method: 'POST', body: JSON.stringify({ name: form.name, facilityType: form.facilityType, primaryContact: form.primaryContact, email: form.email, kind: editor.kind, ...(editor.kind === 'CENTER' ? { parentClientId: form.parentClientId } : { hospitalSlug: form.hospitalSlug }) }) });
        setCredentials(data);
      }
      setEditor(null); await changed(editor.record ? 'Organization settings saved.' : editor.kind === 'GROUP' ? 'Client and group administrator created.' : 'Center and administrator created.');
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Unable to save changes'); } finally { setBusy(false); }
  }
  async function status(record: OrganizationRecord) {
    if (!window.confirm(`${record.status === 'ACTIVE' ? 'Block' : 'Activate'} ${record.name}?`)) return;
    setBusy(true); setError('');
    try { await api(`/api/admin/clients/${record.id}/status`, token, { method: 'PATCH', body: JSON.stringify({ status: record.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE' }) }); await changed('Account status updated.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to change status'); } finally { setBusy(false); }
  }
  async function reset(record: OrganizationRecord, user: Account) {
    if (!window.confirm(`Generate a new password for ${user.email}? Their existing password will stop working.`)) return;
    setBusy(true); setFormError('');
    try { setCredentials(await api<Credentials>(`/api/admin/clients/${record.id}/reset-password`, token, { method: 'POST', body: JSON.stringify({ userId: user.id }) })); notice('New one-time password generated.'); }
    catch (e) { setFormError(e instanceof Error ? e.message : 'Unable to reset password'); } finally { setBusy(false); }
  }
  async function addUser(e: FormEvent) {
    e.preventDefault(); if (!editor?.record || busy) return; setBusy(true); setFormError('');
    try {
      const data = await api<Credentials>(editor.kind === 'GROUP' ? '/api/admin/group-admins' : `/api/admin/clients/${editor.record.id}/users`, token, { method: 'POST', body: JSON.stringify({ ...userForm, clientId: editor.record.id }) });
      setCredentials(data); setUserForm({ name: '', email: '', portalRole: 'FRONT_DESK' }); await changed('Login created.');
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Unable to create login'); } finally { setBusy(false); }
  }
  const filtered = (isCenters ? centers : groups).filter(r => (!clientFilter || (clientFilter === 'unassigned' ? !r.parentClientId : r.parentClientId === clientFilter)) && [r.name, r.code, r.email, r.primaryContact, groups.find(g => g.id === r.parentClientId)?.name].join(' ').toLowerCase().includes(search.toLowerCase()));
  const current = editor?.record ? records.find(r => r.id === editor.record?.id) ?? editor.record : null;
  const credentialCard = credentials && <section className="org-credentials" role="status"><strong>One-time login credentials</strong><p>Save these before closing this message.</p><dl><dt>User ID</dt><dd>{credentials.user.userId || credentials.user.email}</dd><dt>Email</dt><dd>{credentials.user.email}</dd><dt>Password</dt><dd><code>{credentials.temporaryPassword}</code></dd></dl><button type="button" onClick={() => setCredentials(null)}>Dismiss credentials</button></section>;
  return <section className="org-page" aria-label={isCenters ? 'Center management' : 'Client management'}>
    <div className="org-intro"><div><h2>{isCenters ? 'Hospital centers' : 'Hospital clients'}</h2><p>{isCenters ? 'Manage center access, reporting settings, and client assignments.' : 'Create hospital clients with a dedicated slug, group administrators, and centers.'}</p></div><div className="org-actions"><button title="Refresh directory" aria-label="Refresh directory" onClick={() => setRefresh(n => n + 1)}><RefreshCw size={15}/></button><button className="pw-primary" disabled={!loaded || (isCenters && !groups.some(g => g.status === 'ACTIVE'))} onClick={() => open(isCenters ? 'CENTER' : 'GROUP')}><Plus size={16}/>{isCenters ? 'Add center' : 'Add client'}</button></div></div>
    <div className="org-summary"><div><Building2 size={18}/><strong>{groups.length}</strong><span>Clients</span></div><div><strong>{centers.length}</strong><span>Centers</span></div><div><strong>{groups.reduce((n, r) => n + r.users.filter(u => u.active).length, 0)}</strong><span>Group admins</span></div><div><strong>{centers.filter(r => !r.parentClientId).length}</strong><span>Unassigned centers</span></div></div>
    {error && <div className="pw-alert" role="alert">{error}<button onClick={() => setRefresh(n => n + 1)}>Retry</button></div>}{!editor && credentialCard}
    {isCenters && centers.some(c => !c.parentClientId) && <p className="org-info">Existing centers without a client are marked Unassigned. Use Manage to assign them; studies and reports stay with the center.</p>}
    {isCenters && loaded && !groups.length && <p className="org-info">Create a hospital client in the Clients tab before adding or assigning centers.</p>}
    <div className="org-filters"><label className="org-search"><Search size={16}/><input aria-label="Search organization" placeholder="Search names, codes or contacts..." value={search} onChange={e => setSearch(e.target.value)}/></label>{isCenters && <select aria-label="Filter centers by client" value={clientFilter} onChange={e => setClientFilter(e.target.value)}><option value="">All clients</option><option value="unassigned">Unassigned centers</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}</div>
    <div className="org-table-wrap"><table className="org-table"><thead><tr><th>{isCenters ? 'Center' : 'Client'}</th><th>{isCenters ? 'Hospital client / slug' : 'Client slug'}</th><th>Contact</th><th>{isCenters ? 'Studies / reports' : 'Centers / admins'}</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filtered.map(record => { const parent = groups.find(g => g.id === record.parentClientId); return <tr key={record.id}><td><strong>{record.name}</strong><small>{record.code} · {record.facilityType}</small></td><td>{isCenters ? <>{parent?.name ?? 'Unassigned'}<small>{parent?.hospitalSlug ?? record.hospitalSlug ?? 'No slug configured'}</small></> : <code>{record.hospitalSlug ?? 'Not configured'}</code>}</td><td>{record.primaryContact}<small>{record.email}</small></td><td>{isCenters ? `${record._count.availableBridgeStudies} / ${record._count.reportReviews}` : `${record._count.childClients} / ${record.users.length}`}</td><td><span className={`pw-status ${record.status === 'ACTIVE' ? 'reported' : 'failed'}`}>{record.status === 'ACTIVE' ? 'Active' : 'Blocked'}</span></td><td><div className="org-actions"><button onClick={() => open(record.kind, record)}><Settings2 size={14}/>Manage</button>{!isCenters && <button disabled={record.status !== 'ACTIVE'} onClick={() => open('CENTER', undefined, record.id)}><Plus size={14}/>Center</button>}<button disabled={busy} onClick={() => void status(record)}>{record.status === 'ACTIVE' ? 'Block' : 'Activate'}</button></div></td></tr>; })}{!filtered.length && <tr><td colSpan={6}><div className="org-empty">{!loaded ? 'Loading directory...' : search || clientFilter ? 'No matching records.' : isCenters ? 'No centers added yet.' : 'No clients yet. Add your first hospital client to get started.'}</div></td></tr>}</tbody></table></div>
    {editor && <WorkspaceDrawer wide title={`${editor.record ? 'Manage' : 'Add'} ${editor.kind === 'GROUP' ? 'client' : 'center'}${editor.record ? ` · ${editor.record.name}` : ''}`} onClose={() => { if (!busy) { setEditor(null); setCredentials(null); } }}>
      <div className="org-editor">{formError && <div className="pw-alert" role="alert">{formError}</div>}{credentialCard}<form onSubmit={save}><div className="org-form-grid">
        <label className="pw-field">{editor.kind === 'GROUP' ? 'Client name' : 'Center name'}<input autoFocus required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
        <label className="pw-field">Facility type<input required minLength={2} value={form.facilityType} onChange={e => setForm({ ...form, facilityType: e.target.value })}/></label>
        {editor.kind === 'GROUP' ? <label className="pw-field org-full">Client slug<input required minLength={2} maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="e.g. hospital-network" value={form.hospitalSlug} onChange={e => setForm({ ...form, hospitalSlug: e.target.value.toLowerCase() })}/><small>Unique identifier sent to Renewist for every center under this client. Use lowercase letters, digits, and hyphens.</small></label> : <label className="pw-field org-full">Hospital client<select required={!editor.record} value={form.parentClientId} onChange={e => setForm({ ...form, parentClientId: e.target.value })}><option value="">{editor.record ? 'Unassigned' : 'Select client'}</option>{groups.filter(g => g.status === 'ACTIVE' || g.id === form.parentClientId).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select><small>{editor.record ? 'Changing the client changes which group administrators can access this center.' : 'The center inherits its client hospital slug for Renewist.'}</small></label>}
        <label className="pw-field">{editor.record ? 'Contact name' : 'Administrator name'}<input required minLength={2} value={form.primaryContact} onChange={e => setForm({ ...form, primaryContact: e.target.value })}/></label>
        <label className="pw-field">{editor.record ? 'Contact email' : 'Administrator email'}<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></label>
        {editor.record && <label className="pw-field org-full">Location (internal)<input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}/><small>For internal reference. Never sent to Renewist.</small></label>}
      </div>{editor.kind === 'CENTER' && editor.record && <section className="org-section"><h3>Study routing</h3><label className="org-check"><input type="checkbox" checked={studySync} onChange={e => setStudySync(e.target.checked)}/>Enable study sync</label><h4>Automatically submit these modalities</h4><div className="org-checkboxes">{modalityCodes.map(code => <label className="org-check" key={code}><input type="checkbox" checked={modalities.includes(code)} onChange={e => setModalities(previous => e.target.checked ? [...previous, code] : previous.filter(v => v !== code))}/>{modalityLabel(code)}</label>)}</div><p>Leave all modalities off to submit studies manually.</p>{onConfigure && <button type="button" disabled={busy} onClick={() => onConfigure(editor.record!.id)}>PACS and service settings</button>}</section>}<div className="org-form-actions"><button type="submit" className="pw-primary" disabled={busy}>{busy ? 'Saving...' : editor.record ? 'Save changes' : 'Create and generate login'}</button><button type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button></div></form>
      {current && <section className="org-section"><h3>{current.kind === 'GROUP' ? 'Group administrators' : 'Center users'}</h3><div className="org-user-list">{current.users.map(user => <div key={user.id}><div><strong>{user.name}</strong><small>{user.userId || user.email} · {user.active ? 'Active' : 'Inactive'}</small></div><button disabled={busy} onClick={() => void reset(current, user)}>Reset password</button></div>)}</div><form onSubmit={addUser}><h4>Add {current.kind === 'GROUP' ? 'group admin' : 'center user'}</h4><div className="org-form-grid"><label className="pw-field">Full name<input required minLength={2} value={userForm.name} onChange={e => setUserForm({ ...userForm, name: e.target.value })}/></label><label className="pw-field">Email<input required type="email" value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })}/></label>{current.kind === 'CENTER' && <label className="pw-field">Role<select value={userForm.portalRole} onChange={e => setUserForm({ ...userForm, portalRole: e.target.value })}><option value="FRONT_DESK">Front desk</option><option value="TECHNICIAN">Technician</option><option value="MANAGER">Manager</option><option value="IT_TEAM">IT administrator</option></select></label>}</div><button disabled={busy} type="submit">Create login</button></form></section>}
      </div>
    </WorkspaceDrawer>}
  </section>;
}
