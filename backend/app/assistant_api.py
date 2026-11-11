"""Private conversations and an LLM-backed, read-only operational assistant."""
from datetime import datetime, timedelta, timezone
from threading import BoundedSemaphore
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from app.assistant_model import run_assistant, settings
from app.command_models import AssistantThread, AuditEntry
from app.database import get_db
from app.permissions import require

router=APIRouter(prefix="/api/v1/command/assistant",tags=["AI assistant"])
_capacity=BoundedSemaphore(4)
Workspace=Literal["all","marengo","goyal","pacs","onprem"]


class ThreadInput(BaseModel):
    model_config=ConfigDict(extra="forbid")
    workspace: Workspace="all"


class ChatInput(BaseModel):
    model_config=ConfigDict(extra="forbid")
    threadId: UUID
    requestId: UUID
    message: str=Field(min_length=1,max_length=4000)


def owned(db,user,identity):
    row=db.query(AssistantThread).filter(AssistantThread.id==str(identity),AssistantThread.owner_id==user.id).first()
    if not row:
        raise HTTPException(404,"Conversation not found.")
    return row


def brief(row):
    return {"id":row.id,"title":row.title,"workspace":row.workspace,"updatedAt":row.updated_at,"messageCount":len(row.messages)}


@router.get("/config")
def configuration(response:Response,user=Depends(require("analytics:read"))):
    response.headers["Cache-Control"]="private, no-store"
    cfg=settings()
    return {"provider":"OpenAI","model":cfg["model"],"configured":bool(cfg["key"]) and cfg["enabled"],"userId":user.id,
        "capabilities":["conversations","follow_up_questions","period_and_portal_comparisons","charts","validated_data_tools"],
        "setup":None if cfg["key"] and cfg["enabled"] else "Set OPENAI_API_KEY in backend/.env and restart the backend. ASSISTANT_MODEL selects the model.",
        "dataScope":"Aggregate operational data. Patient records, DICOMs, reports and credentials are not available to the model."}


@router.get("/threads")
def threads(response:Response,workspace:Workspace|None=None,db:Session=Depends(get_db),user=Depends(require("analytics:read"))):
    response.headers["Cache-Control"]="private, no-store"
    query=db.query(AssistantThread).filter(AssistantThread.owner_id==user.id)
    if workspace:
        query=query.filter(AssistantThread.workspace==workspace)
    return {"items":[brief(r) for r in query.order_by(AssistantThread.updated_at.desc(),AssistantThread.id).limit(50)]}


@router.post("/threads")
def create_thread(data:ThreadInput,response:Response,db:Session=Depends(get_db),user=Depends(require("analytics:read"))):
    response.headers["Cache-Control"]="private, no-store"
    row=AssistantThread(id=str(uuid4()),owner_id=user.id,workspace=data.workspace,messages=[],title="New conversation")
    db.add(row);db.commit();db.refresh(row)
    return brief(row)


@router.get("/threads/{identity}")
def get_thread(identity:UUID,response:Response,db:Session=Depends(get_db),user=Depends(require("analytics:read"))):
    response.headers["Cache-Control"]="private, no-store"
    row=owned(db,user,identity)
    return {**brief(row),"messages":row.messages}


@router.delete("/threads/{identity}")
def delete_thread(identity:UUID,db:Session=Depends(get_db),user=Depends(require("analytics:read"))):
    row=owned(db,user,identity)
    if row.busy_until and row.busy_until.replace(tzinfo=timezone.utc)>datetime.now(timezone.utc):
        raise HTTPException(409,"Wait for the current answer before deleting this conversation.")
    db.delete(row);db.commit()
    return {"deleted":True}


@router.post("/chat")
def chat(data:ChatInput,response:Response,db:Session=Depends(get_db),user=Depends(require("analytics:read"))):
    response.headers["Cache-Control"]="private, no-store"
    prompt=data.message.strip()
    if not prompt:
        raise HTTPException(422,"Enter a question or message.")
    row=owned(db,user,data.threadId)
    request_id=str(data.requestId)
    for message in row.messages:
        if message.get("requestId")==request_id and message.get("role")=="assistant":
            original=next((m for m in row.messages if m.get("requestId")==request_id and m.get("role")=="user"),None)
            if original and original.get("content")!=prompt:
                raise HTTPException(409,"This request identifier belongs to a different message. Send the question as a new turn.")
            return {"threadId":row.id,"message":message,"replayed":True}
    cfg=settings()
    if not cfg["key"] or not cfg["enabled"]:
        raise HTTPException(503,"The AI assistant is not configured. Set OPENAI_API_KEY in backend/.env and restart the backend.")
    if len(row.messages)>=40:
        raise HTTPException(422,"This conversation has reached 20 turns. Start a new conversation to keep its context clear.")
    if not _capacity.acquire(blocking=False):
        raise HTTPException(429,"The assistant is serving several requests. Try again shortly.")
    identity,workspace,revision,history,title=row.id,row.workspace,row.revision,list(row.messages),row.title
    now=datetime.now(timezone.utc)
    acquired=False
    try:
        claimed=db.execute(update(AssistantThread).where(AssistantThread.id==identity,AssistantThread.owner_id==user.id,AssistantThread.revision==revision,
            or_(AssistantThread.busy_until.is_(None),AssistantThread.busy_until<now)).values(busy_until=now+timedelta(seconds=150)).execution_options(synchronize_session=False)).rowcount
        db.commit()
        if not claimed:
            raise HTTPException(409,"This conversation is already answering a question. Wait for it to finish, then retry.")
        acquired=True
        result=run_assistant(db,user,workspace,history,prompt)
        stamp=datetime.now(timezone.utc)
        answer={"id":str(uuid4()),"role":"assistant","requestId":request_id,"createdAt":stamp.isoformat(),**result}
        user_message={"id":str(uuid4()),"role":"user","requestId":request_id,"createdAt":now.isoformat(),"content":prompt}
        saved=db.execute(update(AssistantThread).where(AssistantThread.id==identity,AssistantThread.owner_id==user.id,AssistantThread.revision==revision).values(
            messages=history+[user_message,answer],revision=revision+1,busy_until=None,updated_at=stamp,title=prompt[:120] if not history else title).execution_options(synchronize_session=False)).rowcount
        if not saved:
            raise HTTPException(409,"The conversation changed. Reload it before sending another question.")
        db.add(AuditEntry(actor_id=user.id,action="assistant.analysis",target=identity,details={"model":result["model"],"tools":result["tools"],"datasets":len(result["artifacts"]),"durationMs":result["durationMs"],"outputTokens":result["outputTokens"]}))
        db.commit()
        acquired=False
        return jsonable_encoder({"threadId":identity,"message":answer,"replayed":False})
    finally:
        try:
            if acquired:
                db.rollback()
                db.execute(update(AssistantThread).where(AssistantThread.id==identity,AssistantThread.owner_id==user.id,AssistantThread.revision==revision).values(busy_until=None).execution_options(synchronize_session=False))
                db.commit()
        finally:
            _capacity.release()
