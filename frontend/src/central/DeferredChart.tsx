import { useEffect, useRef, useState, type ReactNode } from "react";

// Keep chart geometry stable, but avoid mounting off-screen SVG charts until needed.
export default function DeferredChart({children}:{children:ReactNode}) {
  const node=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    if(!node.current)return;
    if(!("IntersectionObserver" in window)){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}
    },{rootMargin:"100px"});
    observer.observe(node.current);
    return()=>observer.disconnect();
  },[]);
  return <div ref={node} style={{height:"100%",width:"100%",minWidth:0}}>{visible?children:<div aria-hidden="true" style={{height:"100%"}}/>}</div>;
}
