import { useEffect, useState, type ReactNode } from "react";
import { api, type MarengoAnalytics } from "../services/api";
import "./desktop.css";
import "./marengo-analytics.css";

const number = (value: number) => new Intl.NumberFormat().format(value);
const statusClass = (status: string) => status.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function TableCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <section className="marengo-detail-card">
    <header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></header>
    {children}
  </section>;
}

export function MarengoAnalyticsPage() {
  const [data, setData] = useState<MarengoAnalytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try { setData(await api.getMarengoAnalytics()); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load Marengo analytics"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  const maxStudies = Math.max(1, ...((data?.studies.byModality ?? []).map(row => row.total)));
  const processingJobs = data?.jobs.byStatus.find(row => row.status === "PROCESSING")?.count ?? 0;

  return <main className="license-page marengo-page">
    <header className="marengo-header">
      <div><span className="marengo-eyebrow">SOURCE OVERVIEW</span><h1>Marengo analytics</h1><p>Track study intake, processing progress, report review, and usage.</p></div>
      <button className="secondary marengo-refresh" onClick={() => void refresh()} disabled={loading} aria-label="Refresh Marengo analytics">
        {loading ? "Refreshing..." : "Refresh data"}
      </button>
    </header>

    {error && <p className="license-message license-error">{error} Run the Marengo source sync and apply database migrations if this is a new setup.</p>}
    {loading && !data ? <p className="license-message">Loading Marengo analytics...</p> : data && <>
      <section className="marengo-kpis" aria-label="Marengo summary">
        <article className="marengo-kpi marengo-kpi-blue"><span>Studies</span><strong>{number(data.studies.total)}</strong><small><b>{number(data.studies.success)}</b> successful / {number(data.studies.failed)} failed</small></article>
        <article className="marengo-kpi marengo-kpi-violet"><span>Jobs in queue</span><strong>{number(processingJobs)}</strong><small>Currently processing</small></article>
        <article className="marengo-kpi marengo-kpi-amber"><span>Retry attempts</span><strong>{number(data.jobs.retryAttempts)}</strong><small>Average processing latency <b>{number(Math.round(data.jobs.averageLatencyMs))} ms</b></small></article>
        <article className="marengo-kpi marengo-kpi-green"><span>Credits recorded</span><strong>{number(data.usage.creditsUsed)}</strong><small>Across {number(data.usage.entries)} usage records</small></article>
      </section>

      <section className="marengo-overview-grid" aria-label="Processing overview">
        <article className="marengo-card marengo-modality-card">
          <div className="marengo-card-heading"><div><span className="marengo-eyebrow">INTAKE</span><h2>Studies by modality</h2></div><span className="marengo-total-chip">{number(data.studies.total)} total</span></div>
          {data.studies.byModality.length ? <div className="marengo-modality-list">{data.studies.byModality.map(row => <div className="marengo-modality-row" key={row.modality}>
            <div className="marengo-modality-label"><strong>{row.modality}</strong><span>{number(row.total)} studies</span></div>
            <div className="marengo-track" aria-label={`${row.modality}: ${row.total} studies`}><i style={{ width: `${Math.max(3, row.total / maxStudies * 100)}%` }} /></div>
            <div className="marengo-modality-stats"><span className="marengo-dot marengo-dot-success" />{number(row.success)} success <span className="marengo-dot marengo-dot-failed" />{number(row.failed)} failed</div>
          </div>)}</div> : <p className="marengo-empty">No study data synced yet.</p>}
        </article>

        <article className="marengo-card marengo-workflow-card">
          <div className="marengo-card-heading"><div><span className="marengo-eyebrow">REPORTS</span><h2>Report review status</h2></div><span className="marengo-total-chip">{number(data.reviews.total)} reports</span></div>
          {data.reviews.byStatus.length ? <div className="marengo-status-list">{data.reviews.byStatus.map(row => <div className="marengo-status-row" key={row.status}>
            <span className={`marengo-status-icon marengo-status-${statusClass(row.status)}`} aria-hidden="true">{statusClass(row.status).includes("success") ? "OK" : statusClass(row.status).includes("fail") ? "!" : "..."}</span>
            <div className="marengo-status-copy"><strong>{row.status}</strong><span>Reports</span></div>
            <b>{number(row.count)}</b>
          </div>)}</div> : <p className="marengo-empty">No report review data synced yet.</p>}
          <div className="marengo-review-summary"><span>Credits successful</span><strong>{number(data.usage.successful)}</strong><span>Credits failed</span><strong>{number(data.usage.failed)}</strong><span>Reports pushed</span><strong>{number(data.reviews.pushed)}</strong></div>
        </article>
      </section>

      <div className="marengo-section-title"><div><span className="marengo-eyebrow">DETAILS</span><h2>Processing and review breakdown</h2></div><p>Counts grouped by modality and current status.</p></div>
      <section className="marengo-detail-grid">
        <TableCard title="Jobs by study modality" subtitle="Processing volume and errors">
          <div className="marengo-table-scroll"><table><thead><tr><th>Modality</th><th>Status</th><th>Jobs</th><th>Errors</th></tr></thead><tbody>{data.jobs.byModalityStatus.map((row, index) => <tr key={`${row.modality}-${row.status}-${index}`}><td><strong>{row.modality}</strong></td><td><span className={`marengo-pill marengo-pill-${statusClass(row.status)}`}>{row.status}</span></td><td>{number(row.count)}</td><td>{number(row.errors)}</td></tr>)}{!data.jobs.byModalityStatus.length && <tr><td colSpan={4} className="license-empty">No linked job data synced.</td></tr>}</tbody></table></div>
        </TableCard>
        <TableCard title="Report review status" subtitle="Review outcomes grouped by modality">
          <div className="marengo-table-scroll"><table><thead><tr><th>Modality</th><th>Status</th><th>Reports</th></tr></thead><tbody>{data.reviews.byModalityStatus.map((row, index) => <tr key={`${row.modality}-${row.status}-${index}`}><td><strong>{row.modality}</strong></td><td><span className={`marengo-pill marengo-pill-${statusClass(row.status)}`}>{row.status}</span></td><td>{number(row.count)}</td></tr>)}{!data.reviews.byModalityStatus.length && <tr><td colSpan={3} className="license-empty">No report reviews synced.</td></tr>}</tbody></table></div>
        </TableCard>
      </section>
      <footer className="marengo-footnote">Analytics reflect the latest records synchronized from the Marengo source.</footer>
    </>}
  </main>;
}
