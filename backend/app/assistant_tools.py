"""The model chooses tools; application code validates and executes every read.

There is deliberately no generated SQL, clinical-record tool, write tool, shell,
URL fetcher or source-database connection in this module.
"""
from datetime import date, datetime
from typing import Literal
from uuid import uuid4

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import func

from app.command_api import IST, analytics, date_bounds
from app.command_models import Center, Portal, PortalResource

PORTALS = ("marengo", "goyal", "pacs", "onprem")
MODALITIES = ("X-Ray", "Special X-Ray", "CT", "MRI", "Mammography", "USG", "PET-CT")


class UsageQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: date
    end: date
    portal: Literal["all", "marengo", "goyal", "pacs", "onprem"] | None
    client: str | None = Field(max_length=80)
    center: str | None = Field(max_length=160)
    modality: Literal["X-Ray", "Special X-Ray", "CT", "MRI", "Mammography", "USG", "PET-CT"] | None
    service: str | None = Field(max_length=120)
    label: str = Field(min_length=1,max_length=100)


def nullable(**kwargs):
    return {"type":["string","null"], **kwargs}


QUERY_PROPERTIES = {
    "start":{"type":"string","description":"Inclusive start date YYYY-MM-DD, in IST."},
    "end":{"type":"string","description":"Inclusive end date YYYY-MM-DD, in IST. Long ranges use monthly or yearly chart buckets."},
    "portal":nullable(enum=["all",*PORTALS,None],description="null uses the current workspace; all explicitly queries the organization. For Goyal across mapped shared-PACS centers use portal=all and client=goyal."),
    "client":nullable(description="Exact canonical client code from catalog, or null. Never guess a center ID or client code."),
    "center":nullable(description="Exact center source ID from catalog, or null. Include its portal."),
    "modality":nullable(enum=[*MODALITIES,None]),
    "service":nullable(description="Exact service name from retrieved analytics, or null. Usually prefer modality."),
    "label":{"type":"string","description":"Short human-readable title for this measured dataset."},
}
QUERY_SCHEMA = {"type":"object","properties":QUERY_PROPERTIES,"required":list(QUERY_PROPERTIES),"additionalProperties":False}


def function(name,description,parameters):
    return {"type":"function","name":name,"description":description,"strict":True,"parameters":parameters}


TOOLS = [
    function("get_portal_catalog","Discover connected portals and exact registered client/center names and identifiers. Search to resolve misspelled or ambiguous center names before querying usage.",
        {"type":"object","properties":{"portal":nullable(enum=["all",*PORTALS,None]),"search":nullable(description="Optional literal center-name search, or null.")},"required":["portal","search"],"additionalProperties":False}),
    function("analyze_usage","Retrieve real reported study/AI endpoint usage, not-processed inventory, X-ray views and weighted averages, turnaround, credits, daily/hourly activity, and portal/client/center/service rankings. Use before making factual numeric claims. Produces a chart card with verified filters.",QUERY_SCHEMA),
    function("compare_usage","Compare any two portal/client/modality/date scopes, including consecutive periods or different clients. Returns server-calculated absolute and percentage changes and group contributions, plus both chart cards.",
        {"type":"object","properties":{"baseline":QUERY_SCHEMA,"comparison":QUERY_SCHEMA},"required":["baseline","comparison"],"additionalProperties":False}),
    function("get_connection_status","Read source snapshot timestamps and connection configuration. A configured database is not proof of portal runtime health.",
        {"type":"object","properties":{},"required":[],"additionalProperties":False}),
    function("get_inventory_summary","Get aggregated portal control-resource counts, enabled/disabled services, users, centers, subscriptions, on-prem licenses and workstations. No license keys, patient records or credentials are returned.",
        {"type":"object","properties":{"portal":nullable(enum=["all",*PORTALS,None])},"required":["portal"],"additionalProperties":False}),
]


def portal_code(value,workspace):
    if value not in [None,"all",*PORTALS]:
        raise ValueError("Unknown portal; retrieve the portal catalog first.")
    selected = value if value is not None else workspace
    return None if selected == "all" else selected


def catalog(db,portal=None,search=None):
    query=db.query(Center)
    if portal:
        query=query.filter(Center.portal_code==portal)
    if search:
        escaped=search[:100].replace("\\","\\\\").replace("%","\\%").replace("_","\\_")
        query=query.filter(Center.name.ilike(f"%{escaped}%",escape="\\"))
    centers=query.order_by(Center.name,Center.portal_code,Center.source_id).limit(101).all()
    portals=db.query(Portal).order_by(Portal.code).all()
    return jsonable_encoder({"portals":[{"code":p.code,"name":p.name,"clientCode":p.client_code,"lastSyncedAt":p.last_synced_at} for p in portals if not portal or p.code==portal],
        "centers":[{"id":c.source_id,"name":c.name,"portal":c.portal_code,"clientCode":c.client_code,"status":c.source_status} for c in centers[:100]],
        "centersTruncated":len(centers)>100,"hint":"Search for a center name to narrow the directory. A Goyal client scope includes explicitly mapped centers on shared PACS."})


def compact(data):
    """Keep measured summaries/rankings and hourly detail; bound long time series."""
    result={k:v for k,v in data.items() if k not in {"topUsers","unattributedUserEvents"}}
    if len(result.get("daily",[])) > 93:
        # Retain all daily data in the UI artifact; only thin the model context.
        result["daily"]=sorted(result["daily"],key=lambda r:r["success"],reverse=True)[:20]
        result["dailyNote"]="Top 20 days by reported usage; full date series is in the chart. Do not treat this as the whole period."
    for name in ["byCenter","byClient","userActivity"]:
        result[name]=result.get(name,[])[:10]
    # User names are operational actor names from audit records, not inferred submitters.
    result["userActivity"]=[{k:v for k,v in r.items() if k!="id"} for r in result.get("userActivity",[])]
    return result


class AnalyticsTools:
    def __init__(self,db,user,workspace,source_offset=0):
        self.db,self.user,self.workspace=db,user,workspace
        self.source_offset=source_offset
        self.artifacts=[]
        self.sources=[]

    def usage(self,raw):
        query=UsageQuery.model_validate(raw)
        date_bounds(query.start,query.end)
        code=portal_code(query.portal,self.workspace)
        if code and not self.db.get(Portal,code):
            raise ValueError("Portal is not registered. Check the portal catalog.")
        if query.center:
            matches=self.db.query(Center).filter(Center.source_id==query.center)
            if code:
                matches=matches.filter(Center.portal_code==code)
            rows=matches.limit(2).all()
            if len(rows)!=1:
                raise ValueError("Center is missing or ambiguous. Resolve its exact portal and ID in the catalog.")
            code=rows[0].portal_code
            if query.client and query.client!=rows[0].client_code:
                raise ValueError("The requested client does not own this center.")
        if query.client:
            known=self.db.query(Center).filter(Center.client_code==query.client).first() or self.db.query(Portal).filter(Portal.client_code==query.client).first()
            if not known:
                raise ValueError("Client code is not registered. Check the portal catalog.")
        if len(self.artifacts)>=6:
            raise ValueError("Six datasets have been retrieved. Finish this answer, then continue in a follow-up.")
        filters={"start":query.start.isoformat(),"end":query.end.isoformat(),**{k:v for k,v in {"portal":code,"client":query.client,"center":query.center,"service":query.service,"modality":query.modality}.items() if v}}
        data=analytics(start=query.start,end=query.end,portal=code,client=query.client,center=query.center,service=query.service,modality=query.modality,db=self.db,user=self.user)
        # Keep patient-level records and source record IDs outside model context and history.
        data.pop("topUsers",None)
        data["userActivity"]=[{k:v for k,v in r.items() if k!="id"} for r in data.get("userActivity",[])]
        fetched=datetime.now(IST).isoformat()
        source={"id":f"D{self.source_offset+len(self.artifacts)+1}","label":query.label,"filters":filters,"fetchedAt":fetched,"dateBasis":data["dateBasis"]}
        artifact={"id":str(uuid4()),"source":source,"data":jsonable_encoder(data)}
        self.artifacts.append(artifact)
        self.sources.append(source)
        snapshots=self.db.query(Portal).all()
        coverage=[{"portal":p.code,"lastSyncedAt":p.last_synced_at,"syncNeedsAttention":bool(p.sync_error)} for p in snapshots if not code or p.code==code]
        return {"source":source,"coverage":jsonable_encoder(coverage),"analysis":compact(artifact["data"])}

    def execute(self,name,arguments):
        try:
            if not isinstance(arguments,dict):
                raise ValueError("Tool arguments must be an object.")
            if name=="analyze_usage":
                return self.usage(arguments)
            if name=="compare_usage":
                if set(arguments)!={"baseline","comparison"}:
                    raise ValueError("Supply baseline and comparison filters.")
                # Validate both before executing either read.
                UsageQuery.model_validate(arguments["baseline"]);UsageQuery.model_validate(arguments["comparison"])
                left,right=self.usage(arguments["baseline"]),self.usage(arguments["comparison"])
                def changes(a,b):
                    keys=["success","pending","xrayViews","averageXrayViews","averageDurationMs"]
                    return {key:{"baseline":a.get(key),"comparison":b.get(key),"change":round(b[key]-a[key],3) if a.get(key) is not None and b.get(key) is not None else None,
                        "percentChange":round((b[key]-a[key])/a[key]*100,2) if a.get(key) not in {None,0} and b.get(key) is not None else None} for key in keys}
                contributions={}
                for group in ["byPortal","byService","byCenter","byClient"]:
                    a={(r.get("portal"),r["key"]):r for r in left["analysis"][group]}
                    b={(r.get("portal"),r["key"]):r for r in right["analysis"][group]}
                    entries=[]
                    for key in a.keys()|b.keys():
                        # Center/client lists are top rankings, not complete inventories.
                        # Do not turn an unlisted row into an invented zero baseline.
                        missing=group in {"byCenter","byClient"} and (key not in a or key not in b)
                        before=a.get(key,{}).get("success",None if missing else 0)
                        after=b.get(key,{}).get("success",None if missing else 0)
                        entries.append({"key":key[1],"portal":key[0],"name":b.get(key,a.get(key)).get("name",key[1]),"baselineReported":before,"comparisonReported":after,
                            "change":after-before if before is not None and after is not None else None,"rankingIncomplete":missing})
                    contributions[group]=sorted(entries,key=lambda r:abs(r["change"] or 0),reverse=True)[:10]
                return {"baseline":left,"comparison":right,"changes":changes(left["analysis"]["totals"],right["analysis"]["totals"]),"creditChange":right["analysis"]["usage"]["credits"]-left["analysis"]["usage"]["credits"],"topReportedChanges":contributions,"note":"Rankings are bounded; absence from a top list is not proof of zero usage. Differences identify contributors, not proven root causes. Percentage change from a zero baseline is undefined."}
            if name=="get_portal_catalog":
                if set(arguments)!={"portal","search"} or (arguments["search"] is not None and not isinstance(arguments["search"],str)):
                    raise ValueError("Supply portal and search strings, or null.")
                return catalog(self.db,portal_code(arguments["portal"],self.workspace),arguments["search"])
            if name=="get_connection_status":
                if arguments:
                    raise ValueError("This tool takes no arguments.")
                return {"sources":jsonable_encoder([{"portal":p.code,"name":p.name,"lastSyncedAt":p.last_synced_at,"syncNeedsAttention":bool(p.sync_error)} for p in self.db.query(Portal).all()]),"note":"These are central snapshot sync states, not live portal runtime or AI endpoint uptime."}
            if name=="get_inventory_summary":
                if set(arguments)!={"portal"}:
                    raise ValueError("Supply a portal code or null.")
                code=portal_code(arguments["portal"],self.workspace)
                r=PortalResource
                query=self.db.query(r.portal_code,r.resource_type,r.enabled,func.count().label("count"))
                if code:
                    query=query.filter(r.portal_code==code)
                rows=query.group_by(r.portal_code,r.resource_type,r.enabled).all()
                return {"counts":[{"portal":row.portal_code,"kind":row.resource_type,"enabled":row.enabled,"count":row.count} for row in rows],"note":"Observed source access state at the last snapshot. No keys, identities or secrets are included. Offline on-prem AI usage cannot be inferred from license balances."}
            raise ValueError("Unknown tool. Only the declared read-only tools can be called.")
        except (ValidationError,ValueError,HTTPException) as error:
            message=str(error)[:600] if not isinstance(error,HTTPException) else str(error.detail)
            return {"error":message,"recoverable":True,"instruction":"Correct the arguments using the tool schema/catalog or ask the user to clarify. Never silently broaden the scope."}
