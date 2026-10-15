import { useEffect, useState } from "react";
import { api, type MarengoAnalytics } from "../services/api";
import "./desktop.css";

const number = (value: number) => new Intl.NumberFormat().format(value);

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

  return <main className="license-page">
    <header className="license-header"><div><h1>Marengo Analytics</h1><p>Study processing, report review, and usage from the Marengo source.</p></div><button className="secondary" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button></header>
    {error && <p className="license-message license-error">{error} Run the Marengo source sync and apply database migrations if this is a new setup.</p>}
    {loading && !data ? <p className="license-message">Loading Marengo analytics…</p> : data && <>
      <section className="license-kpis">
        <article><span>Studies</span><strong>{number(data.studies.total)}</strong><small>{number(data.studies.success)} successful · {number(data.studies.failed)} failed</small></article>
        <article><span>Jobs</span><strong>{number(data.jobs.total)}</strong><small>{number(data.jobs.processingErrors)} with errors</small></article>
        <article><span>Retry attempts</span><strong>{number(data.jobs.retryAttempts)}</strong><small>Average latency {number(Math.round(data.jobs.averageLatencyMs))} ms</small></article>
        <article><span>Credits used</span><strong>{number(data.usage.creditsUsed)}</strong><small>{number(data.usage.entries)} usage records</small></article>
      </section>
      <section className="license-analytics-grid">
        <div className="license-table-wrap"><h2>Studies by modality</h2><table><thead><tr><th>Modality</th><th>Studies</th><th>Success</th><th>Failed</th></tr></thead><tbody>{data.studies.byModality.map(row => <tr key={row.modality}><td>{row.modality}</td><td>{number(row.total)}</td><td>{number(row.success)}</td><td>{number(row.failed)}</td></tr>)}{!data.studies.byModality.length && <tr><td colSpan={4} className="license-empty">No study data synced.</td></tr>}</tbody></table></div>
        <div className="license-table-wrap"><h2>Jobs by status</h2><table><thead><tr><th>Status</th><th>Jobs</th><th>With errors</th></tr></thead><tbody>{data.jobs.byStatus.map(row => <tr key={row.status}><td>{row.status}</td><td>{number(row.count)}</td><td>{number(row.errors)}</td></tr>)}{!data.jobs.byStatus.length && <tr><td colSpan={3} className="license-empty">No job data synced.</td></tr>}</tbody></table></div>
        <div className="license-table-wrap"><h2>Jobs by study modality</h2><table><thead><tr><th>Modality</th><th>Status</th><th>Jobs</th><th>Errors</th></tr></thead><tbody>{data.jobs.byModalityStatus.map((row, index) => <tr key={`${row.modality}-${row.status}-${index}`}><td>{row.modality}</td><td>{row.status}</td><td>{number(row.count)}</td><td>{number(row.errors)}</td></tr>)}{!data.jobs.byModalityStatus.length && <tr><td colSpan={4} className="license-empty">No linked job data synced.</td></tr>}</tbody></table></div>
        <div className="license-table-wrap"><h2>Report review status</h2><table><thead><tr><th>Modality</th><th>Status</th><th>Reports</th></tr></thead><tbody>{data.reviews.byModalityStatus.map((row, index) => <tr key={`${row.modality}-${row.status}-${index}`}><td>{row.modality}</td><td>{row.status}</td><td>{number(row.count)}</td></tr>)}{!data.reviews.byModalityStatus.length && <tr><td colSpan={3} className="license-empty">No report reviews synced.</td></tr>}</tbody></table></div>
        <div className="license-table-wrap"><h2>Usage credits</h2><table><thead><tr><th>Successful</th><th>Failed</th><th>Credits</th><th>Reports pushed</th></tr></thead><tbody><tr><td>{number(data.usage.successful)}</td><td>{number(data.usage.failed)}</td><td>{number(data.usage.creditsUsed)}</td><td>{number(data.reviews.pushed)}</td></tr></tbody></table></div>
      </section>
    </>}
  </main>;
}
