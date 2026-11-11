// These fixed dashboard plots use native SVG, avoiding a chart framework at startup.
const palette=["#57c9c4","#6c9bf4","#b19ce9","#e1b76f","#e28f9a","#8fc590","#6bb9da"];
const format=(value:number)=>value.toLocaleString("en-IN");
type Point={label:string;value:number;secondary?:number};
const text={fill:"#a7bdd5",fontSize:11};

export function TrendChart({data}:{data:Point[]}) {
  const max=Math.max(1,...data.flatMap(d=>[d.value,d.secondary||0]));
  const x=(i:number)=>42+i*420/Math.max(1,data.length-1),y=(value:number)=>182-value/max*158;
  const points=(secondary=false)=>data.map((d,i)=>`${x(i)},${y(secondary?d.secondary||0:d.value)}`).join(" ");
  const ticks=[...new Set([0,Math.floor((data.length-1)/4),Math.floor((data.length-1)/2),Math.floor((data.length-1)*3/4),data.length-1])].filter(i=>i>=0);
  return <svg className="fast-chart" viewBox="0 0 480 220" width="100%" height="100%" aria-label="Reported and unprocessed study activity" role="img">
    {[0,1,2,3].map(i=><g key={i}><line x1={42} x2={462} y1={y(max*i/3)} y2={y(max*i/3)} stroke="#344150" strokeDasharray="3 5"/><text {...text} x={36} y={y(max*i/3)+4} textAnchor="end">{format(Math.round(max*i/3))}</text></g>)}
    {!!data.length&&<polygon points={`42,182 ${points()} ${x(data.length-1)},182`} fill="#57c9c4" opacity={0.12}/>}
    <polyline points={points()} fill="none" stroke={palette[0]} strokeWidth={2.5}/><polyline points={points(true)} fill="none" stroke={palette[3]} strokeWidth={1.5} strokeDasharray="4 4"/>
    {data.map((d,i)=><circle key={i} cx={x(i)} cy={y(d.value)} r={6} fill="transparent" tabIndex={0} aria-label={`${d.label}: ${format(d.value)} reported, ${format(d.secondary||0)} not processed`}><title>{`${d.label}: ${format(d.value)} reported; ${format(d.secondary||0)} not processed`}</title></circle>)}
    {ticks.map(i=><text key={i} {...text} x={x(i)} y={207} textAnchor={i===0?"start":i===data.length-1?"end":"middle"}>{data[i]?.label}</text>)}
  </svg>;
}

export function DonutChart({data}:{data:{label:string;value:number}[]}) {
  const total=data.reduce((sum,d)=>sum+d.value,0);let offset=0;
  return <svg className="fast-chart" viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label={data.map(d=>`${d.label}: ${format(d.value)}`).join(", ")}>
    <circle cx={50} cy={50} r={38} stroke="#344150" strokeWidth={15} fill="none"/>
    {data.map((d,i)=>{const fraction=total?100*d.value/total:0;const start=offset;offset+=fraction;return fraction>0?<circle key={i} cx={50} cy={50} r={38} fill="none" stroke={palette[i%palette.length]} strokeWidth={15} pathLength={100} strokeDasharray={`${Math.max(0,fraction-0.6)} ${100-Math.max(0,fraction-0.6)}`} strokeDashoffset={-start} transform="rotate(-90 50 50)" tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`}><title>{`${d.label}: ${format(d.value)} (${Math.round(fraction)}%)`}</title></circle>:null;})}
  </svg>;
}

export function VerticalBars({data}:{data:Point[]}) {
  const max=Math.max(1,...data.map(d=>d.value));const step=420/Math.max(1,data.length);
  return <svg className="fast-chart" viewBox="0 0 480 220" width="100%" height="100%" role="img" aria-label="Hourly report completions">
    {[0,1,2,3].map(i=><g key={i}><line x1={42} x2={462} y1={182-158*i/3} y2={182-158*i/3} stroke="#344150" strokeDasharray="3 5"/><text {...text} x={36} y={186-158*i/3} textAnchor="end">{format(Math.round(max*i/3))}</text></g>)}
    {data.map((d,i)=><g key={i}><rect x={42+i*step+2} y={182-d.value/max*158} width={Math.max(1,step-4)} height={d.value/max*158} rx={2} fill={d.value===max?palette[0]:"#527caa"} tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`}><title>{`${d.label}: ${format(d.value)} reported`}</title></rect>{i%4===0&&<text {...text} x={42+i*step+step/2} y={207} textAnchor="middle">{d.label}</text>}</g>)}
  </svg>;
}

export function HorizontalBars({data,unit="reported"}:{data:Point[];unit?:string}) {
  const max=Math.max(1,...data.map(d=>d.value+(d.secondary||0))),height=Math.max(220,data.length*34+35),step=(height-40)/Math.max(1,data.length);
  return <svg className="fast-chart" viewBox={`0 0 480 ${height}`} width="100%" height="100%" role="img" aria-label={`Usage by client or portal, ${unit}`}>
    {data.map((d,i)=><g key={i}><text {...text} x={132} y={22+i*step+4} textAnchor="end"><title>{d.label}</title>{d.label.length>21?d.label.slice(0,20)+"…":d.label}</text><rect x={142} y={14+i*step} width={d.value/max*300} height={18} rx={2} fill={palette[0]} tabIndex={0} aria-label={`${d.label}: ${format(d.value)} ${unit}`}><title>{`${d.label}: ${format(d.value)} ${unit}`}</title></rect>{!!d.secondary&&<rect x={142+d.value/max*300} y={14+i*step} width={d.secondary/max*300} height={18} fill={palette[3]}><title>{`${d.label}: ${format(d.secondary)} not processed`}</title></rect>}</g>)}
    {[0,1,2,3].map(i=><text key={i} {...text} x={142+100*i} y={height-4} textAnchor="middle">{format(Math.round(max*i/3))}</text>)}
  </svg>;
}
