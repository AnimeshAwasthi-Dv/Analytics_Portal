import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bot, ChartNoAxesCombined, Check, ChevronDown, Copy, History, LoaderCircle, MessageSquare, Plus, Send, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { WorkspaceDrawer } from "../pacs/WorkspaceDrawer";
import { CommandVisuals, type VisualAnalysis } from "./CommandVisuals";
import { XraySummary, type XrayMetrics } from "./XrayUsage";
import { AssistantText } from "./AssistantText";
import { commandGet, commandPost, currentWorkspace, workspaceNames } from "./transport";
import "./assistant.css";

type Config = { configured: boolean; model: string; provider: string; setup: string | null; userId: number; dataScope: string };
type Source = { id: string; label: string; filters: Record<string,string>; fetchedAt: string; dateBasis: string };
type Dataset = { id: string; source: Source; data: VisualAnalysis & { totals: VisualAnalysis["totals"] & XrayMetrics; note: string; usage: { credits: number }; byClient: { key: string; success: number; pending: number }[]; userActivity: {name:string;portal:string;events:number}[] } };
type Message = { id: string; role: "user" | "assistant"; content: string; requestId: string; createdAt: string; artifacts?: Dataset[]; sources?: Source[]; model?: string; tools?: { tool: string; status: string }[] };
type Thread = { id: string; title: string; workspace: string; updatedAt: string; messageCount: number };
const time = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone:"Asia/Kolkata", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });

export default function AssistantWorkspace() {
  const scope = currentWorkspace(), [config,setConfig] = useState<Config>(), [threads,setThreads] = useState<Thread[]>([]), [thread,setThread] = useState<string | null>(null);
  const [messages,setMessages] = useState<Message[]>([]), [input,setInput] = useState(""), [busy,setBusy] = useState(false), [loading,setLoading] = useState(true), [error,setError] = useState("");
  const [historyOpen,setHistoryOpen] = useState(false), [settingsOpen,setSettingsOpen] = useState(false), [dataset,setDataset] = useState<Dataset | null>(null), [copied,setCopied] = useState("");
  const [retry,setRetry] = useState<{ message:string; requestId:string; threadId:string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null), mounted = useRef(true), inputRef = useRef<HTMLTextAreaElement>(null);
  const evidenceRef = useRef<HTMLElement>(null);
  const storageKey = config ? `central-ai-thread:${config.userId}:${scope}` : "";
  const loadThreads = async () => { const data = await commandGet<{items:Thread[]}>("assistant/threads", {workspace:scope});if(mounted.current)setThreads(data.items); };
  useEffect(() => {
    mounted.current = true;let active = true;
    void (async () => { try {
      const cfg = await commandGet<Config>("assistant/config");
      const list = await commandGet<{items:Thread[]}>("assistant/threads", {workspace:scope});
      if (!active) return;setConfig(cfg);setThreads(list.items);
      const saved = sessionStorage.getItem(`central-ai-thread:${cfg.userId}:${scope}`);
      if (saved && list.items.some(t => t.id === saved)) {
        const data = await commandGet<Thread & {messages:Message[]}>(`assistant/threads/${saved}`);
        if (active) {setThread(saved);setMessages(data.messages);}
      }
    } catch(e) { if(active)setError((e as Error).message); } finally { if(active)setLoading(false); } })();
    return () => {active = false;mounted.current = false;};
  }, [scope]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth", block:"end" }); }, [messages,busy]);
  useEffect(() => {
    if(!dataset)return;
    const previous=document.activeElement as HTMLElement|null,panel=evidenceRef.current;
    panel?.focus();
    const key=(event:KeyboardEvent) => {
      if(event.key==="Escape"){event.preventDefault();setDataset(null);}
      if(event.key!=="Tab"||!panel)return;
      const items=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select,input,textarea,summary,[tabindex="0"]')).filter(el=>el.getClientRects().length>0);
      if(!items.length){event.preventDefault();return;}
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",key);
    return () => {document.removeEventListener("keydown",key);previous?.focus();};
  },[dataset]);

  const openThread = async (id: string) => {
    if(busy)return;setError("");setLoading(true);setHistoryOpen(false);setDataset(null);setRetry(null);
    try { const data = await commandGet<Thread & {messages:Message[]}>(`assistant/threads/${id}`);setThread(id);setMessages(data.messages);sessionStorage.setItem(storageKey,id); }
    catch(e){setError((e as Error).message);}finally{setLoading(false);}
  };
  const newThread = () => { if(busy)return;setThread(null);setMessages([]);setInput("");setError("");setDataset(null);setRetry(null);setHistoryOpen(false);sessionStorage.removeItem(storageKey);inputRef.current?.focus(); };
  const send = async (text=input,retryData=retry) => {
    const question = text.trim();if(!question || busy || !config?.configured)return;
    setBusy(true);setError("");setInput("");setRetry(null);
    let id = retryData?.threadId || thread;const requestId = retryData?.requestId || crypto.randomUUID();
    try {
      if(!id){const created = await commandPost<Thread>("assistant/threads",{workspace:scope});id=created.id;if(!mounted.current)return;setThread(id);sessionStorage.setItem(storageKey,id);}
      if(!retryData)setMessages(previous => [...previous,{id:crypto.randomUUID(),role:"user",content:question,requestId,createdAt:new Date().toISOString()}]);
      const response = await commandPost<{threadId:string;message:Message}>("assistant/chat",{threadId:id,requestId,message:question});
      if(!mounted.current)return;setMessages(previous => previous.some(m => m.id === response.message.id) ? previous : [...previous,response.message]);
      await loadThreads();
    } catch(e){if(mounted.current){setError((e as Error).message);if(id)setRetry({message:question,requestId,threadId:id});else setInput(question);}}
    finally{if(mounted.current){setBusy(false);inputRef.current?.focus();}}
  };
  const deleteThread = async (id: string) => {
    try { await commandPost(`assistant/threads/${id}`,{},"DELETE");if(id===thread)newThread();await loadThreads(); }
    catch(e){setError((e as Error).message);}
  };
  const copy = async (message: Message) => {try {await navigator.clipboard.writeText(message.content);setCopied(message.id);setTimeout(() => {if(mounted.current)setCopied("");},1500);}catch{setError("Copy is unavailable in this browser. You can select the answer text.");}};
  const examples = [
    {icon:<ChartNoAxesCombined size={18}/>,title:"Compare performance",text:"Compare Marengo X-ray usage this week with last week. Show the change and the centers contributing most."},
    {icon:<Sparkles size={18}/>,title:"Understand a change",text:"Which services drove the change in usage over the last 30 days? Explain what the data supports and what needs investigation."},
    {icon:<MessageSquare size={18}/>,title:"Explore X-ray views",text:"Show X-ray views and average views per reported study for Marengo over the last 7 days, with center-wise breakdowns."},
    {icon:<Settings2 size={18}/>,title:"Review the network",text:"Summarize the current source sync status and on-prem license and workstation access counts."},
  ];

  return <div className="central-view ai-workspace">
    <header className="ai-heading"><div className="ai-heading-mark"><Sparkles size={23}/></div><div><div className="pw-breadcrumb">Dectrocel / {workspaceNames[scope]}</div><h1>AI assistant</h1><p>Ask, compare and explore your operations in a conversation.</p></div><div className="ai-heading-actions"><span className={`ai-model-state ${config?.configured?"configured":""}`}><i/>{loading?"Loading":config?.configured?config.model:"Model setup required"}</span><button aria-label="Assistant connection details" title="Connection details" onClick={() => setSettingsOpen(true)}><Settings2 size={16}/></button><button onClick={() => setHistoryOpen(true)} disabled={busy}><History size={15}/><span>History</span></button><button onClick={newThread} disabled={busy}><Plus size={16}/><span>New chat</span></button></div></header>
    {config&&!config.configured&&<div className="ai-setup-notice" role="status"><Bot size={20}/><div><strong>Connect a model to start the conversation</strong><p>Add <code>OPENAI_API_KEY</code> to <code>backend/.env</code> and restart the backend. {config.model} is selected; <code>ASSISTANT_MODEL</code> can change it.</p><span>The key stays on your server. ChatGPT sign-in does not configure an API key for this application.</span></div><button onClick={() => setSettingsOpen(true)}>Setup details <ArrowUpRight size={14}/></button></div>}
    <div className="ai-chat-scroll"><div className="ai-transcript" role="log" aria-label="Assistant conversation" aria-live="polite">
      {loading?<div className="ai-loading"><LoaderCircle className="pw-spinning" size={21}/>Loading your conversation…</div>:!messages.length?<div className="ai-welcome"><div className="ai-welcome-icon"><Sparkles size={31}/></div><span>YOUR OPERATIONS, IN CONTEXT</span><h2>What would you like to understand?</h2><p>Ask in your own words. Compare portals, investigate trends, explore views and turnaround, then keep the conversation going.</p><div className="ai-suggestions">{examples.map(example => <button key={example.title} onClick={() => {setInput(example.text);inputRef.current?.focus();}}>{example.icon}<strong>{example.title}</strong><p>{example.text}</p><ArrowUpRight size={14}/></button>)}</div><div className="ai-context-label"><Check size={13}/>Starts in {workspaceNames[scope]}. Name another portal or period to compare.</div></div>:messages.map(message => <article key={message.id} className={`ai-message ai-message-${message.role}`}><div className="ai-message-avatar">{message.role==="assistant"?<Sparkles size={17}/>:"You"}</div><div className="ai-message-content"><div className="ai-message-author"><strong>{message.role==="assistant"?"Dectrocel AI":"You"}</strong><time>{time(message.createdAt)} IST</time></div><AssistantText text={message.content} onSource={id => {const found=messages.flatMap(m => m.artifacts || []).find(a => a.source.id===id);if(found)setDataset(found);}}/>{!!message.artifacts?.length&&<div className="ai-datasets">{message.artifacts.map(artifact => <button key={artifact.id} onClick={() => setDataset(artifact)}><ChartNoAxesCombined size={16}/><span><strong>{artifact.source.label}</strong><small>{artifact.source.filters.start} → {artifact.source.filters.end} · {workspaceNames[artifact.source.filters.portal || "all"]} {artifact.source.filters.modality?`· ${artifact.source.filters.modality}`:""}</small></span><span className="ai-dataset-id">{artifact.source.id}</span><ArrowUpRight size={14}/></button>)}</div>}{message.role==="assistant"&&<footer className="ai-message-footer"><button onClick={() => void copy(message)} aria-label="Copy answer">{copied===message.id?<Check size={13}/>:<Copy size={13}/>} {copied===message.id?"Copied":"Copy"}</button><span>{message.model}{message.tools?.length?` · ${message.tools.filter(t=>t.status==="complete").length} data tools used`:""}</span></footer>}</div></article>)}
      {busy&&<div className="ai-thinking" role="status"><div className="ai-message-avatar"><Sparkles size={17}/></div><div><strong>Working through your question</strong><span>Reading context, retrieving relevant data and preparing an answer…</span><i/><i/><i/></div></div>}
      {error&&<div className="ai-error" role="alert"><span>{error}</span>{retry&&<button disabled={busy} onClick={() => void send(retry.message,retry)}>Try again</button>}</div>}
      <div ref={endRef}/>
    </div></div>
    <div className="ai-composer-wrap"><form className="ai-composer" onSubmit={e => {e.preventDefault();void send(input,null);}}><textarea ref={inputRef} aria-label="Message AI assistant" placeholder="Ask about usage, compare portals, or follow up on an answer…" value={input} maxLength={4000} rows={2} disabled={busy||loading} onChange={e => setInput(e.target.value)} onKeyDown={e => {if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send(input,null);}}}/><div className="ai-composer-bottom"><span><i/>{workspaceNames[scope]} context <ChevronDown size={11}/></span><span className="ai-keyboard-hint">Shift + Enter for a new line</span><button className="ai-send" type="submit" disabled={!config?.configured||busy||!input.trim()||loading} aria-label="Send message">{busy?<LoaderCircle className="pw-spinning" size={17}/>:<Send size={17}/>}</button></div></form><p className="ai-composer-note">Answers use central source snapshots. Inspect dataset cards for filters, figures and dates.</p></div>
    {historyOpen&&<WorkspaceDrawer title="Your conversations" onClose={() => setHistoryOpen(false)}><div className="ai-history"><button className="pw-primary" onClick={newThread}><Plus size={16}/>New conversation</button>{!threads.length&&<p>No conversations in this workspace yet.</p>}{threads.map(item => <div className={item.id===thread?"active":""} key={item.id}><button onClick={() => void openThread(item.id)}><MessageSquare size={16}/><span><strong>{item.title}</strong><small>{time(item.updatedAt)} IST · {Math.floor(item.messageCount/2)} turns</small></span></button><button title="Delete conversation" aria-label={`Delete conversation ${item.title}`} onClick={() => void deleteThread(item.id)}><Trash2 size={15}/></button></div>)}</div></WorkspaceDrawer>}
    {settingsOpen&&<WorkspaceDrawer title="Assistant connection" onClose={() => setSettingsOpen(false)}><div className="ai-settings"><Bot size={30}/><h2>{config?.provider || "OpenAI"}</h2><p>{config?.configured?"A model API key is configured on the server. Provider access is checked when you send a message.":"The conversational integration is installed. Add a server API key to activate live responses."}</p><dl><dt>Model</dt><dd>{config?.model || "gpt-5.4"}</dd><dt>Workspace</dt><dd>{workspaceNames[scope]}</dd><dt>Capabilities</dt><dd>Conversation, follow-ups, comparisons, explanations, charts and verified data tools</dd></dl><h3>Server configuration</h3><pre>OPENAI_API_KEY=your-server-key{"\n"}ASSISTANT_MODEL=gpt-5.4{"\n"}ASSISTANT_REASONING=low</pre><p>Set these values in <code>backend/.env</code>, restart the backend, then reload this page. Do not put API keys in frontend environment variables.</p><h3>Data access</h3><p>{config?.dataScope}</p><p>Conversation history belongs to your internal account. The assistant retrieves operational summaries through validated tools and follows your team access permissions.</p></div></WorkspaceDrawer>}
    {dataset&&<div className="ai-evidence-overlay" role="dialog" aria-modal="true" aria-label="Analysis evidence"><section className="ai-evidence" ref={evidenceRef} tabIndex={-1}><header><div><span>{dataset.source.id} · MEASURED DATASET</span><h2>{dataset.source.label}</h2><p>{dataset.source.filters.start} → {dataset.source.filters.end} · IST · Retrieved {time(dataset.source.fetchedAt)} IST</p></div><button onClick={() => setDataset(null)} aria-label="Close analysis evidence"><X size={18}/></button></header><div className="ai-evidence-scroll"><div className="ai-evidence-filters">{Object.entries(dataset.source.filters).filter(([key])=>!["start","end"].includes(key)).map(([key,value]) => <span key={key}>{key}: <strong>{workspaceNames[value] || value}</strong></span>)}</div><div className="ai-evidence-totals"><div><span>Reported / AI uses</span><strong>{dataset.data.totals.success.toLocaleString("en-IN")}</strong></div><div><span>Not processed</span><strong>{dataset.data.totals.pending.toLocaleString("en-IN")}</strong></div><div><span>Credits</span><strong>{dataset.data.usage.credits.toLocaleString("en-IN")}</strong></div></div><CommandVisuals data={dataset.data} start={dataset.source.filters.start} end={dataset.source.filters.end} overview={!dataset.source.filters.portal}/>{(!dataset.source.filters.modality||["X-Ray","Special X-Ray"].includes(dataset.source.filters.modality))&&<XraySummary data={dataset.data.totals}/>}{[{title:"Center breakdown",rows:dataset.data.byCenter},{title:"Service breakdown",rows:dataset.data.byService},{title:"Client breakdown",rows:dataset.data.byClient}].map(group => <details className="ai-evidence-breakdown" key={group.title}><summary>{group.title} (top {group.rows.length})</summary><div className="ai-markdown-table"><table><thead><tr><th>{group.title.split(" ")[0]}</th><th>Reported / AI uses</th><th>Not processed</th></tr></thead><tbody>{group.rows.map((row,i)=><tr key={i}><td>{"name" in row?row.name:workspaceNames[row.key||""]||row.key}</td><td>{row.success.toLocaleString("en-IN")}</td><td>{row.pending.toLocaleString("en-IN")}</td></tr>)}</tbody></table></div></details>)}<details className="ai-evidence-breakdown"><summary>Verified user audit activity</summary><div className="ai-markdown-table"><table><thead><tr><th>User</th><th>Portal</th><th>Audit actions</th></tr></thead><tbody>{dataset.data.userActivity.map((row,i)=><tr key={i}><td>{row.name}</td><td>{workspaceNames[row.portal]||row.portal}</td><td>{row.events.toLocaleString("en-IN")}</td></tr>)}</tbody></table></div><p>Audit actions measure activity; they do not establish who submitted or consumed a service.</p></details><details><summary>Exact filters and measurement definitions</summary><pre>{JSON.stringify(dataset.source.filters,null,2)}</pre><p>{dataset.data.note}</p></details></div></section></div>}
  </div>;
}
