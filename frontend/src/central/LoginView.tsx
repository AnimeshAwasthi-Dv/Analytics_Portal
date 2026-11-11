import { useState, type FormEvent } from "react";
import { ArrowRight, Building2, Eye, EyeOff, LoaderCircle, Network, ShieldCheck } from "lucide-react";
import { api } from "../pacs/lib/api";
import type { User } from "../pacs/types/portal";
import logo from "../pacs/assets/dectrocel-logo.webp";
import { CENTRAL_SESSION_KEY } from "./transport";

export default function LoginView({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await api<{token:string;user:User}>("/api/auth/login", undefined, {method:"POST",body:JSON.stringify({userId:email.trim(),password})});
      localStorage.setItem(CENTRAL_SESSION_KEY, result.token);
      onLogin(result.token,result.user);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="command-login">
    <section className="command-login-story" aria-label="Dectrocel organization command">
      <a href="/" className="command-login-brand"><img src={logo} alt="Dectrocel" width={48} height={48}/><span>Dectrocel<strong>COMMAND</strong></span></a>
      <div className="command-login-intro"><span className="command-eyebrow">ORGANIZATION OPERATIONS</span><h1>Every portal.<br/>One command.</h1><p>Your worklists, reporting operations and service intelligence, connected across the Dectrocel network.</p>
        <div className="command-network"><div className="command-network-hub"><Network size={22}/><span>Dectrocel Command</span></div><div className="command-network-portals">{["Marengo","Goyal MRI","Common PACS","On-prem"].map(name=><div key={name}><Building2 size={17}/><span>{name}</span></div>)}</div></div>
      </div>
      <footer><ShieldCheck size={16}/>Internal team access across your organization</footer>
    </section>
    <section className="command-login-auth"><div className="command-login-form"><span className="command-eyebrow">WELCOME TO YOUR WORKSPACE</span><h2>Sign in to Command</h2><p>Use your Dectrocel internal team account.</p>
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor="command-email">Work email</label><input id="command-email" type="email" autoComplete="username" autoCapitalize="none" autoFocus required value={email} placeholder="name@dectrocel.com" onChange={e=>setEmail(e.target.value)} aria-invalid={!!error} aria-describedby={error?"command-login-error":undefined}/>
        <label htmlFor="command-password">Password</label><div className="command-password"><input id="command-password" type={visible?"text":"password"} autoComplete="current-password" required value={password} placeholder="Enter your password" onChange={e=>setPassword(e.target.value)} aria-invalid={!!error} aria-describedby={error?"command-login-error":undefined}/><button type="button" aria-label={visible?"Hide password":"Show password"} onClick={()=>setVisible(v=>!v)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
        {error&&<p id="command-login-error" className="command-login-error" role="alert">{error}</p>}
        <button className="command-login-submit" disabled={busy}>{busy?<><LoaderCircle className="animate-spin" size={18}/>Signing in...</>:<>Open workspace<ArrowRight size={18}/></>}</button>
      </form><div className="command-login-help"><ShieldCheck size={16}/><span>Your role determines the portals, records and actions you can access.</span></div>
    </div><footer>Dectrocel technology operations</footer></section>
  </main>;
}
