import DeferredChart from "./DeferredChart";
import { TrendChart, DonutChart, VerticalBars, HorizontalBars } from "./FastCharts";
import { Activity, ArrowUpRight, BarChart3, Clock3, Layers3, RadioTower } from "lucide-react";
import { selectWorkspace, workspaceNames } from "./transport";

type Metric = { key?: string; name?: string; portal?: string; success: number; pending: number; events: number };
export type VisualAnalysis = { totals: Metric; daily: Metric[]; dailyBucket?: "day" | "month" | "year"; hourly: Metric[]; byPortal: Metric[]; byService: Metric[]; byCenter: Metric[]; peakHour: string | null };
const colors = ["#57c9c4", "#6c9bf4", "#b19ce9", "#e1b76f", "#e28f9a", "#8fc590", "#6bb9da"];
const fmt = (n: number) => n.toLocaleString("en-IN");
const dateLabel = (v: string) => new Date(`${v}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function PanelTitle({ icon, title, subtitle, aside }: { icon: React.ReactNode; title: string; subtitle: string; aside?: React.ReactNode }) {
  return <header className="command-panel-heading"><div className="command-panel-icon">{icon}</div><div><h2>{title}</h2><p>{subtitle}</p></div>{aside && <div className="command-panel-aside">{aside}</div>}</header>;
}
function Empty({ text }: { text: string }) { return <div className="command-chart-empty"><BarChart3 size={25}/><strong>{text}</strong><span>Adjust the date range or scope to explore recorded activity.</span></div>; }

export function CommandVisualsLoading() {
  return <div className="command-visuals command-visuals-loading" role="status" aria-label="Loading operational charts"><span className="sr-only">Loading operational charts</span>{[0,1,2,3].map(n => <div className="command-panel" key={n}><div/><div/><div/></div>)}</div>;
}

export function CommandVisuals({ data, start, end, overview = false }: { data: VisualAnalysis; start: string; end: string; overview?: boolean }) {
  const bucketLabel=(v:string)=>data.dailyBucket&&data.dailyBucket!=="day"?new Date(`${v}T12:00:00Z`).toLocaleDateString("en-IN",data.dailyBucket==="year"?{year:"numeric"}:{month:"short",year:"numeric"}):dateLabel(v);
  const days: { day: string; reported: number; unprocessed: number }[] = [];
  const daily = new Map(data.daily.map(d => [d.key, d]));
  const bucket = data.dailyBucket ?? "day";
  const first = new Date(`${start}T12:00:00Z`), last = new Date(`${end}T12:00:00Z`);
  if(bucket!=="day") { first.setUTCDate(1); last.setUTCDate(1); }
  if(bucket==="year") { first.setUTCMonth(0); last.setUTCMonth(0); }
  for (let d = new Date(first); d <= last;) {
    const key = d.toISOString().slice(0, 10), row = daily.get(key);
    days.push({ day: key, reported: row?.success || 0, unprocessed: row?.pending || 0 });
    if(bucket==="year") d.setUTCFullYear(d.getUTCFullYear()+1);
    else if(bucket==="month") d.setUTCMonth(d.getUTCMonth()+1);
    else d.setUTCDate(d.getUTCDate()+1);
  }

  const services = data.byService.filter(s => s.success > 0).sort((a, b) => b.success-a.success);
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const row = data.hourly.find(h => Number(h.key) === hour);
    return { hour: `${String(hour).padStart(2, "0")}:00`, reported: row?.success || 0 };
  });
  const portals = data.byPortal.map(p => ({ name: workspaceNames[p.key || ""] || p.name || p.key, reported: p.success, unprocessed: p.pending }));
  const peakDay = days.reduce<(typeof days)[number] | null>((best, d) => !best || d.reported > best.reported ? d : best, null);
  const completion = data.totals.events ? Math.round(data.totals.success / data.totals.events * 100) : null;
  return <div className="command-visuals" aria-label="Operational charts">
    <section className="command-panel command-trend">
      <PanelTitle icon={<Activity size={18}/>} title="Study activity" subtitle={`${dateLabel(start)} – ${dateLabel(end)} · IST`} aside={<><strong>{fmt(data.totals.success)}</strong><span>reported studies / AI uses</span></>}/>
      <div className="command-chart-legend"><span><i style={{ background: colors[0] }}/>Reported / AI endpoint uses</span><span><i style={{ background: colors[3] }}/>Not processed</span></div>
      <div className="command-chart command-chart-trend" role="img" aria-label={`Study activity chart: ${fmt(data.totals.success)} reported and ${fmt(data.totals.pending)} not processed`}>
        {data.totals.events ? <DeferredChart><TrendChart data={days.map(d=>({label:bucketLabel(d.day),value:d.reported,secondary:d.unprocessed}))}/></DeferredChart> : <Empty text="No study activity in this period"/>}
      </div>
      <footer className="command-chart-footer"><span>Reports by completion date · unprocessed by received date</span><span>{peakDay?.reported ? <>Peak {bucket} <b>{bucketLabel(peakDay.day)}</b> · {fmt(peakDay.reported)} reports</> : "No reported peak yet"}</span></footer>
    </section>
    <section className="command-panel command-modality">
      <PanelTitle icon={<Layers3 size={18}/>} title="Modality mix" subtitle="Share of successful AI endpoint uses"/>
      {services.length ? <><div className="command-donut" role="img" aria-label={`Modality mix: ${services.map(s => `${s.key} ${s.success}`).join(", ")}`}><DeferredChart><DonutChart data={services.map(d=>({label:d.key||"Other",value:d.success}))}/></DeferredChart><div className="command-donut-label"><strong>{fmt(data.totals.success)}</strong><span>AI endpoint uses</span></div></div><div className="command-modality-legend">{services.map((s, i) => <div key={s.key}><i style={{ background: colors[i % colors.length] }}/><span>{s.key}</span><b>{fmt(s.success)}</b><small>{Math.round(s.success / data.totals.success * 100)}%</small></div>)}</div></> : <Empty text="No reported modality usage"/>}
    </section>
    <section className="command-panel command-hourly">
      <PanelTitle icon={<Clock3 size={18}/>} title="Demand by hour" subtitle="Report completions · Indian Standard Time" aside={data.peakHour != null ? <><span>Peak hour</span><strong>{String(Math.floor(Number(data.peakHour))).padStart(2,"0")}:00</strong></> : undefined}/>
      <div className="command-chart" role="img" aria-label="Hourly report completion chart"><DeferredChart><VerticalBars data={hours.map(d=>({label:d.hour,value:d.reported}))}/></DeferredChart></div>
    </section>
    <section className="command-panel command-comparison">
      <PanelTitle icon={<RadioTower size={18}/>} title={overview ? "Portal performance" : "Study workflow"} subtitle={overview ? "Reported and unprocessed studies by portal" : "Reported studies are successful AI endpoint uses"}/>
      {overview ? <div className="command-chart" role="img" aria-label="Portal usage comparison"><DeferredChart><HorizontalBars data={portals.map(d=>({label:String(d.name||"Portal"),value:d.reported,secondary:d.unprocessed}))}/></DeferredChart></div> : <div className="command-workflow"><div className="command-completion"><strong>{completion == null ? "—" : `${completion}%`}</strong><span>Reported share of studies<br/>in the selected date window</span></div><div className="command-progress"><i style={{ width: `${completion || 0}%` }}/></div><div className="command-workflow-labels"><span><i style={{ background: colors[0] }}/>Reported <b>{fmt(data.totals.success)}</b></span><span><i style={{ background: colors[3] }}/>Not processed <b>{fmt(data.totals.pending)}</b></span></div><p>This compares studies in the selected window. It is not a failure rate or a received-cohort conversion rate.</p></div>}
    </section>
  </div>;
}

export function PortalCards({ portals, data }: { portals: { code: string; name: string; kind: string; configured: boolean; syncError: string | null; lastSyncedAt: string | null; centers: unknown[] }[]; data?: VisualAnalysis }) {
  return <div className="command-portal-cards" aria-label="Portal directory">{portals.map((p, i) => {
    const metric = data?.byPortal.find(m => m.key === p.code);
    return <button key={p.code} className="command-portal-card" onClick={() => selectWorkspace(p.code)}><div className="command-portal-card-top"><span className="command-portal-symbol" style={{ color: colors[i % colors.length] }}><RadioTower size={19}/></span><span className={`command-connection ${p.syncError ? "attention" : p.lastSyncedAt ? "connected" : ""}`}><i/>{p.syncError ? "Sync needs attention" : p.lastSyncedAt ? "Synced" : p.configured ? "Awaiting sync" : "Not connected"}</span><ArrowUpRight size={17}/></div><h2>{p.name}</h2><p>{p.kind === "shared" ? "Shared PACS network" : p.kind === "onprem" ? "Licenses & workstations" : "Dedicated PACS"} · {p.centers.length} centers / accounts</p><div className="command-portal-card-stats"><div><strong>{data ? fmt(metric?.success || 0) : "—"}</strong><span>Reported / AI uses</span></div><div><strong>{data ? fmt(metric?.pending || 0) : "—"}</strong><span>Not processed</span></div></div><footer>{p.lastSyncedAt ? `Synced ${new Date(p.lastSyncedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })} IST` : "No completed snapshot"}<span>Open workspace →</span></footer></button>;
  })}</div>;
}
