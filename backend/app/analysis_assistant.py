"""A constrained natural-language interface to existing, authorized analytics filters.

This first interpreter uses explicit language rules, not an external LLM. It never
generates SQL, changes portal state, or sends operational data to a third party.
"""
import re
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.command_api import IST, date_bounds
from app.command_models import Center, Portal
from app.database import get_db
from app.permissions import require

router = APIRouter(prefix="/api/v1/command/assistant", tags=["Legacy filter interpreter"])
SERVICE_ALIASES = {
    "Special X-Ray": ("special x ray", "special xray"),
    "X-Ray": ("x ray", "xray", "xrays", "x rays", "xr"),
    "PET-CT": ("pet ct", "pet"),
    "CT": ("ct", "computed tomography"),
    "MRI": ("mri", "magnetic resonance"),
    "Mammography": ("mammography", "mammogram", "mammo"),
    "USG": ("ultrasound", "usg", "sonography"),
}
PORTAL_ALIASES = {"marengo": ("marengo",), "goyal": ("goyal mri", "goyal"),
                  "pacs": ("common pacs", "shared pacs", "pacs"),
                  "onprem": ("on prem", "onprem", "desktop", "on premise", "on premises")}


def clean(text):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text.casefold())).strip()


def phrase_pattern(phrase):
    return r"(?<!\w)" + re.escape(phrase) + r"(?!\w)"


def extract_phrases(text, aliases):
    """Longest overlapping names win: 'Goyal MRI' must not imply MRI service."""
    candidates = [(m.start(), m.end(), key) for key, names in aliases.items() for name in names
                  for m in re.finditer(phrase_pattern(name), text)]
    chosen = []
    for start, end, key in sorted(candidates, key=lambda x: -(x[1]-x[0])):
        if not any(start < b and end > a for a, b, _ in chosen):
            chosen.append((start, end, key))
    remaining = list(text)
    for start, end, _ in chosen:
        remaining[start:end] = " " * (end-start)
    return {key for _, _, key in chosen}, "".join(remaining)


def clarification(message):
    return {"status": "clarification", "message": message, "engine": "supported-language-rules", "filters": None,
            "assumptions": [], "warnings": []}


def interpret_request(prompt, portals, centers, today=None):
    today = today or datetime.now(IST).date()
    assumptions, warnings = [], []
    remaining = prompt.casefold()
    start, end = None, today
    explicit = re.findall(r"\b\d{4}-\d{2}-\d{2}\b", remaining)
    relative = re.search(r"\b(?:last|past|previous)\s+(\d+)\s+(days?|weeks?)\b", remaining)
    calendar = re.search(r"\b(today|yesterday|this week|last week|this month|last month)\b", remaining)
    if sum(bool(v) for v in (explicit, relative, calendar)) > 1:
        return clarification("Please specify one date range per request.")
    try:
        if explicit:
            if len(explicit) != 2:
                return clarification("For custom dates, provide a start and end date as YYYY-MM-DD.")
            start, end = map(date.fromisoformat, explicit)
            for value in explicit:
                remaining = remaining.replace(value, " ")
        elif relative:
            days = int(relative[1]) * (7 if relative[2].startswith("week") else 1)
            if days < 1:
                return clarification("Choose a period of at least one day.")
            start = end - timedelta(days=days-1)
            remaining = remaining[:relative.start()] + " " + remaining[relative.end():]
            assumptions.append("The period includes today, using India Standard Time (IST).")
        elif calendar:
            phrase = calendar[0]
            if phrase == "today": start = end
            elif phrase == "yesterday": start = end = today - timedelta(days=1)
            elif phrase == "this week": start = today - timedelta(days=today.weekday())
            elif phrase == "last week":
                end = today - timedelta(days=today.weekday()+1)
                start = end - timedelta(days=6)
            elif phrase == "this month": start = today.replace(day=1)
            else:
                end = today.replace(day=1) - timedelta(days=1)
                start = end.replace(day=1)
            remaining = remaining[:calendar.start()] + " " + remaining[calendar.end():]
        else:
            start = end - timedelta(days=6)
            assumptions.append("No dates specified: using the last 7 days, including today, in IST.")
        date_bounds(start, end)
    except (ValueError, OverflowError):
        return clarification("The date range is invalid. Use real calendar dates in chronological order.")
    except HTTPException as error:
        return clarification(error.detail)

    text = clean(remaining)
    # Center names are resolved against the registry, never guessed from source IDs.
    center_aliases = {str(i): (clean(c["name"]),) for i, c in enumerate(centers) if clean(c["name"])}
    center_matches, without_centers = extract_phrases(text, center_aliases)
    portal_matches, without_portals = extract_phrases(without_centers, PORTAL_ALIASES)
    if len(portal_matches) > 1:
        return clarification("Choose one portal/client, or ask for all portals. Multi-client comparisons can be explored from the overall dashboard.")
    portal_code = next(iter(portal_matches), None)
    # Duplicate center names must be narrowed by an explicitly named portal.
    matched_names = {clean(centers[int(i)]["name"]) for i in center_matches}
    matched_centers = [c for c in centers if clean(c["name"]) in matched_names]
    if portal_code:
        matched_centers = [c for c in matched_centers if c["portal"] == portal_code]
    if center_matches and len(matched_centers) != 1:
        return clarification("That center name is ambiguous or does not belong to the selected portal. Include its exact name and portal.")
    center = matched_centers[0] if matched_centers else None
    if center:
        portal_code = center["portal"]
    families, remainder = extract_phrases(without_portals, SERVICE_ALIASES)
    if len(families) > 1:
        return clarification("Choose one service group per request, such as X-ray, CT or MRI; use all services for an overall report.")
    family = next(iter(families), None)
    filler = {"please", "provide", "me", "the", "usage", "of", "for", "show", "analysis", "analytics", "in", "on", "at", "all",
              "portals", "portal", "overall", "client", "clients", "center", "centre", "centers", "centres", "services", "service",
              "i", "want", "to", "see", "can", "you", "give", "a", "an", "report", "and", "from", "between", "through", "until",
              "how", "many", "executions", "jobs", "studies", "used", "was", "were", "what", "is", "are", "detailed", "total",
              "credits", "consumed", "consumption", "peak", "hour", "hours", "busiest", "time", "turnaround", "duration", "successful", "failed", "failures", "success", "rate",
              "view","views","average","additional","per","study","reported","reporting","processed","not","unprocessed","ai","endpoint","endpoints"}
    unknown = set(remainder.split()) - filler
    if unknown:
        return clarification("I could not map part of this request to supported filters. Try: 'Show X-ray usage for Marengo for the last 7 days', or include an exact registered center name.")
    views_requested=bool(re.search(r"\bviews?\b",clean(prompt)))
    if views_requested and family and family!="X-Ray":
        return clarification("Per-view usage and average views are available for X-ray. Other modality images are not counted as X-ray views.")
    if views_requested and not family:
        family="X-Ray"
        assumptions.append("View counts refer to X-ray studies.")
    if not re.search(r"\b(usage|analysis|analytics|report|executions|jobs|studies|credits|consumption|peak|busiest|turnaround|duration|failures|failed|success|used|views?|reported|unprocessed|endpoints?)\b", clean(prompt)):
        return clarification("Ask for an analysis, such as usage, credits, peak hours, failures or turnaround.")
    filters = {"start": start.isoformat(), "end": end.isoformat(), "portal": portal_code or "", "client": "",
               "center": center["id"] if center else "", "service": "", "modality": family or ""}
    # Goyal's client view includes explicitly mapped centers on shared PACS.
    if portal_code == "goyal" and not center and not re.search(r"\bportal\b", clean(prompt)):
        filters.update(portal="", client="goyal")
        assumptions.append("Goyal includes its dedicated portal and explicitly mapped PACS centers.")
    if not portal_code:
        assumptions.append("No portal specified: including all synced portals.")
    scoped = [p for p in portals if not filters["portal"] or p["code"] == filters["portal"]]
    missing = [p["name"] for p in scoped if not p.get("lastSyncedAt") and (not filters["client"] or p["code"] in {"goyal", "pacs"})]
    if missing:
        warnings.append("No synced source data yet for: " + ", ".join(missing) + ". Totals include available data only.")
    warnings.append("One reported AI or teleradiology study counts once as a successful modality endpoint use. Available/reporting studies are not processed, not failed images. Credits remain separate source debit records.")
    label = center["name"] if center else ("Goyal (all mapped portals)" if filters["client"] else next((p["name"] for p in portals if p["code"] == portal_code), "All portals"))
    return {"status": "ready", "engine": "supported-language-rules", "filters": filters,
            "message": f"Showing {family or 'all service'} analysis for {label}, {start.isoformat()} to {end.isoformat()} (IST).",
            "assumptions": assumptions, "warnings": warnings}


class AnalysisRequest(BaseModel):
    prompt: str = Field(min_length=5, max_length=1000)


@router.post("/interpret",deprecated=True)
def interpret(data: AnalysisRequest, db: Session = Depends(get_db), user=Depends(require("analytics:read"))):
    registry = [{"code": p.code, "name": p.name, "lastSyncedAt": p.last_synced_at} for p in db.query(Portal).all()]
    centers = [{"portal": c.portal_code, "id": c.source_id, "name": c.name} for c in db.query(Center).limit(2000)]
    return interpret_request(data.prompt, registry, centers)
