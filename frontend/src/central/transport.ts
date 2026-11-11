// Vite proxies API requests in development so session cookies stay on the UI's origin.
const apiBase = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const nativeFetch = globalThis.fetch.bind(globalThis);
export const CENTRAL_SESSION_KEY = "dectrocel_central_pacs_session";
export const workspaceNames: Record<string, string> = {all:"All portals",marengo:"Marengo",goyal:"Goyal MRI",pacs:"Common PACS",onprem:"On-prem applications"};
export function currentWorkspace() {
  const path = /^\/portal\/([^/]+)/.exec(location.pathname)?.[1];
  const viewer = location.pathname === "/viewer" ? new URLSearchParams(location.search).get("portal") || sessionStorage.getItem("central-viewer-portal") : null;
  return path && workspaceNames[path] ? path : viewer && workspaceNames[viewer] ? viewer : "all";
}
export const sectionSlug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
export function selectWorkspace(code: string) {
  if(!workspaceNames[code])return;
  history.pushState({},"",code === "all" ? "/command" : `/portal/${code}/dashboard`);
  sessionStorage.setItem("central-viewer-portal",code);
  window.dispatchEvent(new Event("central-workspace-change"));
}
export function saveSection(label: string) {
  const code = currentWorkspace();
  history.pushState({},"",code === "all" ? `/command/${sectionSlug(label)}` : `/portal/${code}/${sectionSlug(label)}`);
}
export async function commandGet<T>(path: string, params: Record<string,string> = {}): Promise<T> {
  const query = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,value])=>value!=="")));
  const response = await nativeFetch(`${apiBase}/api/v1/command/${path}${query.size?`?${query}`:""}`,{credentials:"include"});
  const body = await response.json();
  if(!response.ok) throw new Error(body.detail || "Unable to load central operations.");
  return body;
}
export async function commandPost<T>(path: string, data: unknown, method="POST"): Promise<T> {
  const response=await nativeFetch(`${apiBase}/api/v1/command/${path}`,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const body=await response.json();if(!response.ok)throw new Error(typeof body.detail==="string"?body.detail:"The change could not be completed.");return body;
}
export async function centralLogout() {
  try {await nativeFetch(`${apiBase}/auth/logout`,{method:"POST",credentials:"include"});}
  finally {localStorage.removeItem(CENTRAL_SESSION_KEY);location.assign("/login");}
}
export async function centralFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if(typeof input!=="string" || !input.startsWith("/api/")) return nativeFetch(input,init);
  if (input.startsWith("/api/pacs/") || input.startsWith("/api/public/")) return nativeFetch(`${apiBase}${input}`, {...init, credentials:"include"});
  if(input === "/api/auth/login") {
    const original = JSON.parse(String(init.body || "{}"));
    const response=await nativeFetch(`${apiBase}/auth/login`,{...init,credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:original.userId,password:original.password})});
    const body=await response.json().catch(()=>null);
    if(!response.ok)return new Response(JSON.stringify({message:typeof body?.detail==="string"?body.detail:"Sign in failed."}),{status:response.status,headers:{"Content-Type":"application/json"}});
    const me=await nativeFetch(`${apiBase}/api/pacs/all/me`,{credentials:"include"});
    if(!me.ok)return me;
    return new Response(JSON.stringify({token:"central-cookie-session",user:await me.json()}),{status:200,headers:{"Content-Type":"application/json"}});
  }
  const headers=new Headers(init.headers);
  headers.delete("Authorization"); // The copied UI's marker is not an authentication credential.
  const response=await nativeFetch(`${apiBase}/api/pacs/${currentWorkspace()}/${input.slice(5)}`,{...init,headers,credentials:"include"});
  if(!response.ok && response.headers.get("content-type")?.includes("application/json")) {
    const body=await response.clone().json().catch(()=>null);
    if(body?.detail && !body.message) return new Response(JSON.stringify({...body,message:typeof body.detail==="string"?body.detail:"This request is not valid."}),{status:response.status,headers:{"Content-Type":"application/json"}});
  }
  return response;
}
