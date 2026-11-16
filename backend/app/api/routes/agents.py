from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.dependencies import manager_only
from app.core.database import get_db
from app.models import User
from app.services.agents import access_monitor as am

router = APIRouter(prefix="/api/agents", tags=["agents"])


class RunIn(BaseModel):
    report_id: str | None = None
    apply: bool = False
    days: int = Field(default=14, ge=1, le=365)


@router.get("")
def list_agents(_: User = Depends(manager_only)) -> dict:
    return {"agents": am.AGENTS, "tools": am.TOOLS}


@router.post("/{agent}/run")
def run_agent(agent: str, body: RunIn, _: User = Depends(manager_only), db: Session = Depends(get_db)):
    spec = am.AGENTS.get(agent)
    if spec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown agent")
    if spec["needs_report"] and not body.report_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This agent needs a report_id")
    try:
        if agent == "intake":
            return am.run_intake(db, body.report_id, body.apply)
        if agent == "evidence_analysis":
            return am.run_evidence_analysis(db, body.report_id, body.apply)
        if agent == "duplicate_investigation":
            return am.run_duplicate_investigation(db, body.apply)
        if agent == "hotspot_analysis":
            return am.run_hotspot_analysis(db)
        return am.run_stale_followup(db, body.days, body.apply)
    except LookupError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from None
