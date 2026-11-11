import { Suspense, lazy, useState } from "react";
import LoginView from "./LoginView";
import { CENTRAL_SESSION_KEY } from "./transport";
import "./login.css";

const App=lazy(()=>import("./WorkspaceEntry"));
const ViewerPage=lazy(()=>import("../pacs/features/viewer/ViewerPage"));

export default function Root() {
  const [signedIn,setSignedIn]=useState(()=>Boolean(localStorage.getItem(CENTRAL_SESSION_KEY)));
  const publicRoute=location.pathname==="/viewer"||location.pathname.startsWith("/shared/");
  if(!signedIn&&!publicRoute)return <LoginView onLogin={()=>setSignedIn(true)}/>;
  return <Suspense fallback={<div className="central-boot" role="status">Opening Dectrocel operations...</div>}>{location.pathname==="/viewer"?<ViewerPage/>:<App/>}</Suspense>;
}
