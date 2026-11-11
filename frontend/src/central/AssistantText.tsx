import { Fragment, type ReactNode } from "react";

/** Render model text as React elements. HTML, scripts and remote images stay text. */
export function AssistantText({ text, onSource }: { text: string; onSource: (id: string) => void }) {
  const inline = (value: string): ReactNode => value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[D\d+\])/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2,-2)}</strong> :
    part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1,-1)}</code> :
    /^\[D\d+\]$/.test(part) ? <button className="ai-citation" key={i} onClick={() => onSource(part.slice(1,-1))}>{part}</button> : <Fragment key={i}>{part}</Fragment>);
  const lines = text.split("\n"), nodes: ReactNode[] = [];
  const cells = (line: string) => line.trim().replace(/^\|/,"").replace(/\|$/,"").split("|").map(c => c.trim());
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;nodes.push(<pre key={i}><code>{code.join("\n")}</code></pre>);continue;
    }
    if (i+1 < lines.length && line.includes("|") && /^\|?[\s:|-]+\|?$/.test(lines[i+1].trim()) && lines[i+1].includes("-")) {
      const header = cells(line), rows: string[][] = [];i+=2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      nodes.push(<div className="ai-markdown-table" key={i}><table><thead><tr>{header.map((c,j) => <th key={j}>{inline(c)}</th>)}</tr></thead><tbody>{rows.map((row,k) => <tr key={k}>{header.map((_,j) => <td key={j}>{inline(row[j] || "")}</td>)}</tr>)}</tbody></table></div>);continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) { nodes.push(<h3 key={i}>{inline(heading[1])}</h3>);i++;continue; }
    if (/^\s*([-*]|\d+[.)])\s/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line), items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s/.test(lines[i])) items.push(<li key={i}>{inline(lines[i++].replace(/^\s*([-*]|\d+[.)])\s+/,""))}</li>);
      nodes.push(ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>);continue;
    }
    const paragraph = [line];i++;
    while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+[.)]|#{1,6}|```)/.test(lines[i]) && !(i+1<lines.length && lines[i].includes("|") && /^[\s:|-]+$/.test(lines[i+1]))) paragraph.push(lines[i++]);
    nodes.push(<p key={i}>{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="ai-markdown">{nodes}</div>;
}
