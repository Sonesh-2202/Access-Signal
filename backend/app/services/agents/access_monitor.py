"""Access Monitor: five narrow agents that watch the report stream and do the
triage work a human coordinator would otherwise do by hand.

Each agent only uses the tools registered in TOOLS, returns a typed result, and
runs as a dry run unless `apply=True`. Applied actions are written to the issue
audit trail with the actor "Access Monitor", so every automated change is visible
and reversible by a manager. See docs/ACCESS_MONITOR_AGENT.md."""

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.taxonomy import priority_for_severity, subcategory_info
from app.models import Issue, IssueHistory, Report
from app.services.ai.classifier import ImageInput, classify
from app.services.intelligence.confidence import compute_confidence
from app.services.intelligence.duplicates import find_duplicates
from app.services.intelligence.hotspots import hotspot_label, recalculate_hotspots
from app.services.storage import get_storage

AGENT_NOTE_PREFIX = "Access Monitor: "


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


# ------------------------------------------------------------------ tools

def tool_get_report(db: Session, report_id: str) -> Report | None:
    r = db.get(Report, report_id)
    return r if r and r.deleted_at is None else None


def tool_add_issue_note(db: Session, issue: Issue, note: str) -> None:
    issue.history.append(IssueHistory(changed_by=None, old_status=issue.status, new_status=issue.status,
                                      notes=AGENT_NOTE_PREFIX + note))


def tool_set_issue_status(db: Session, issue: Issue, new_status: str, note: str) -> None:
    old = issue.status
    issue.status = new_status
    issue.updated_at = datetime.now(UTC)
    issue.history.append(IssueHistory(changed_by=None, old_status=old, new_status=new_status,
                                      notes=AGENT_NOTE_PREFIX + note))


TOOLS: dict[str, dict[str, Any]] = {
    "get_report": {
        "description": "Fetch a report with evidence, category, severity and confidence.",
        "parameters": {"type": "object", "properties": {"report_id": {"type": "string"}}, "required": ["report_id"]},
    },
    "find_duplicates": {
        "description": "Find open reports within 50 m and 30 days that likely describe the same barrier.",
        "parameters": {"type": "object", "properties": {
            "lat": {"type": "number"}, "lng": {"type": "number"}, "category": {"type": "string"},
            "subcategory": {"type": "string"}, "description": {"type": "string"}},
            "required": ["lat", "lng", "category", "subcategory"]},
    },
    "compute_confidence": {
        "description": "Score a report 0-1 from evidence, corroboration, recency and reporter credibility.",
        "parameters": {"type": "object", "properties": {"report_id": {"type": "string"}}, "required": ["report_id"]},
    },
    "classify_evidence": {
        "description": "Run the local vision/text model (LM Studio) over a report's photos and text.",
        "parameters": {"type": "object", "properties": {"report_id": {"type": "string"}}, "required": ["report_id"]},
    },
    "recalculate_hotspots": {
        "description": "Re-cluster open reports into hotspots and return them by severity.",
        "parameters": {"type": "object", "properties": {}},
    },
    "list_stale_issues": {
        "description": "Issues with no update for N days, and resolved issues awaiting reverification.",
        "parameters": {"type": "object", "properties": {"days": {"type": "integer", "minimum": 1}}},
    },
    "add_issue_note": {
        "description": "Append a note to an issue's audit trail. Requires apply=true.",
        "parameters": {"type": "object", "properties": {"issue_id": {"type": "string"}, "note": {"type": "string"}},
                       "required": ["issue_id", "note"]},
    },
    "set_issue_status": {
        "description": "Move an issue to a new status (reported->under_review, resolved->reverification only).",
        "parameters": {"type": "object", "properties": {
            "issue_id": {"type": "string"},
            "status": {"type": "string", "enum": ["under_review", "reverification"]},
            "note": {"type": "string"}}, "required": ["issue_id", "status", "note"]},
    },
}


# ------------------------------------------------------------------ output schemas

class Action(BaseModel):
    issue_id: str
    kind: Literal["note", "status"]
    detail: str
    applied: bool


class IntakeResult(BaseModel):
    agent: Literal["intake"] = "intake"
    report_id: str
    completeness: float
    missing: list[str]
    suggested_priority: str
    duplicate_candidates: list[dict]
    confidence: float
    actions: list[Action]


class EvidenceResult(BaseModel):
    agent: Literal["evidence_analysis"] = "evidence_analysis"
    report_id: str
    model_source: str
    model_category: str
    model_subcategory: str
    reporter_subcategory: str
    agrees: bool
    model_summary: str
    detected_features: list[str]
    actions: list[Action]


class DuplicateCluster(BaseModel):
    primary_id: str
    duplicate_ids: list[str]
    label: str
    address: str | None
    best_score: float


class DuplicateResult(BaseModel):
    agent: Literal["duplicate_investigation"] = "duplicate_investigation"
    scanned: int
    clusters: list[DuplicateCluster]
    actions: list[Action]


class HotspotBrief(BaseModel):
    hotspot_id: str
    label: str | None
    report_count: int
    severity_index: float
    dominant_category: str
    trend: str
    recommendation: str


class HotspotResult(BaseModel):
    agent: Literal["hotspot_analysis"] = "hotspot_analysis"
    hotspots: list[HotspotBrief]


class StaleItem(BaseModel):
    issue_id: str
    report_id: str
    status: str
    days_idle: int
    reason: str


class StaleResult(BaseModel):
    agent: Literal["stale_followup"] = "stale_followup"
    threshold_days: int
    items: list[StaleItem]
    actions: list[Action]


# ------------------------------------------------------------------ agents

def run_intake(db: Session, report_id: str, apply: bool = False) -> IntakeResult:
    r = tool_get_report(db, report_id)
    if r is None:
        raise LookupError("Report not found")
    kinds = {e.type for e in r.evidence}
    missing = []
    if "photo" not in kinds:
        missing.append("photo")
    if len((r.description or "").strip()) < 40:
        missing.append("detailed description")
    if not r.address:
        missing.append("street address")
    completeness = round(1 - len(missing) / 3, 2)
    conf, _ = compute_confidence(db, r)
    dups = find_duplicates(db, r.lat, r.lng, r.category, r.subcategory, r.description, exclude_id=r.id)
    suggested = priority_for_severity(r.severity_score * (0.7 + 0.3 * conf))
    actions: list[Action] = []
    if r.issue:
        parts = [f"intake complete ({int(completeness * 100)}% complete)"]
        if missing:
            parts.append("missing " + ", ".join(missing))
        if dups:
            parts.append(f"{len(dups)} possible duplicate(s), best match {dups[0].score:.2f}")
        note = "; ".join(parts) + "."
        actions.append(Action(issue_id=r.issue.id, kind="note", detail=note, applied=apply))
        if r.issue.status == "reported" and conf >= 0.5:
            actions.append(Action(issue_id=r.issue.id, kind="status",
                                  detail=f"reported -> under_review (confidence {conf:.2f})", applied=apply))
        if apply:
            tool_add_issue_note(db, r.issue, note)
            if r.issue.status == "reported" and conf >= 0.5:
                tool_set_issue_status(db, r.issue, "under_review", f"confidence {conf:.2f} meets review threshold")
            db.commit()
    return IntakeResult(
        report_id=r.id, completeness=completeness, missing=missing, suggested_priority=suggested,
        duplicate_candidates=[{"report_id": c.report.id, "score": c.score, "distance_m": c.distance_m} for c in dups],
        confidence=conf, actions=actions,
    )


def run_evidence_analysis(db: Session, report_id: str, apply: bool = False) -> EvidenceResult:
    r = tool_get_report(db, report_id)
    if r is None:
        raise LookupError("Report not found")
    storage = get_storage()
    images = []
    for e in r.evidence:
        if e.type == "photo" and e.file_path:
            try:
                images.append(ImageInput(storage.read(e.file_path), e.mime_type or "image/jpeg"))
            except FileNotFoundError:
                continue
    text = " ".join(filter(None, [r.description, *[e.transcription for e in r.evidence if e.transcription]]))
    c = classify(text, images)
    agrees = c.subcategory == r.subcategory or (c.category == r.category and c.category != "other")
    actions: list[Action] = []
    if r.issue:
        label = subcategory_info(c.category, c.subcategory)["label"]
        note = (f"evidence review ({c.source}) agrees with reporter: {label}." if agrees else
                f"evidence review ({c.source}) suggests '{label}' instead of the reported category. Manager check advised.")
        actions.append(Action(issue_id=r.issue.id, kind="note", detail=note, applied=apply))
        if apply:
            tool_add_issue_note(db, r.issue, note)
            db.commit()
    return EvidenceResult(
        report_id=r.id, model_source=c.source, model_category=c.category, model_subcategory=c.subcategory,
        reporter_subcategory=r.subcategory, agrees=agrees, model_summary=c.summary,
        detected_features=c.detected_features, actions=actions,
    )


def run_duplicate_investigation(db: Session, apply: bool = False) -> DuplicateResult:
    reports = db.scalars(select(Report).where(Report.deleted_at.is_(None), Report.status == "open",
                                              Report.duplicate_of.is_(None))
                         .order_by(Report.reported_at)).all()
    claimed: set[str] = set()
    clusters: list[DuplicateCluster] = []
    actions: list[Action] = []
    for r in reports:
        if r.id in claimed:
            continue
        found = [c for c in find_duplicates(db, r.lat, r.lng, r.category, r.subcategory, r.description,
                                            exclude_id=r.id)
                 if c.report.id not in claimed and c.category_match]
        if not found:
            continue
        ids = [c.report.id for c in found]
        claimed.update(ids + [r.id])
        clusters.append(DuplicateCluster(primary_id=r.id, duplicate_ids=ids,
                                         label=subcategory_info(r.category, r.subcategory)["label"],
                                         address=r.address, best_score=found[0].score))
        if r.issue:
            note = f"{len(ids)} open report(s) look like duplicates of this one. Review and merge if correct."
            actions.append(Action(issue_id=r.issue.id, kind="note", detail=note, applied=apply))
            if apply:
                tool_add_issue_note(db, r.issue, note)
    if apply:
        db.commit()
    return DuplicateResult(scanned=len(reports), clusters=clusters, actions=actions)


_RECOMMEND = {
    "ramp": "Coordinate with building management and NYPD traffic enforcement on ramp obstruction.",
    "elevator": "Escalate to the operator's elevator maintenance desk and publish an outage notice.",
    "transit": "Escalate to MTA accessibility and post alternative accessible entrances.",
    "sidewalk": "Request a DOT sidewalk inspection; check active construction permits nearby.",
    "crossing": "Request a DOT signal and curb ramp survey at this intersection.",
    "entrance": "Contact property owners about entrance access and temporary ramps.",
}


def run_hotspot_analysis(db: Session) -> HotspotResult:
    briefs = []
    for h in recalculate_hotspots(db):
        rec = _RECOMMEND.get(h.dominant_category, "Schedule a site visit to assess the cluster.")
        if h.trend == "rising":
            rec = "Reports are increasing. " + rec
        briefs.append(HotspotBrief(hotspot_id=h.id, label=hotspot_label(db, h), report_count=h.report_count,
                                   severity_index=h.severity_index, dominant_category=h.dominant_category,
                                   trend=h.trend, recommendation=rec))
    return HotspotResult(hotspots=briefs)


def run_stale_followup(db: Session, days: int = 14, apply: bool = False) -> StaleResult:
    now = datetime.now(UTC)
    items: list[StaleItem] = []
    actions: list[Action] = []
    for i in db.scalars(select(Issue).where(Issue.deleted_at.is_(None))):
        idle = (now - _aware(i.updated_at)).days
        if i.status == "resolved" and i.resolved_at and (now - _aware(i.resolved_at)) >= timedelta(days=7):
            items.append(StaleItem(issue_id=i.id, report_id=i.report_id, status=i.status, days_idle=idle,
                                   reason="Resolved over 7 days ago without community reverification"))
            actions.append(Action(issue_id=i.id, kind="status", detail="resolved -> reverification", applied=apply))
            if apply:
                tool_set_issue_status(db, i, "reverification", "requesting community reverification of the fix")
        elif i.status not in ("resolved",) and idle >= days:
            items.append(StaleItem(issue_id=i.id, report_id=i.report_id, status=i.status, days_idle=idle,
                                   reason=f"No update in {idle} days"))
            note = f"no activity for {idle} days. Follow-up requested."
            actions.append(Action(issue_id=i.id, kind="note", detail=note, applied=apply))
            if apply:
                tool_add_issue_note(db, i, note)
    if apply:
        db.commit()
    items.sort(key=lambda x: -x.days_idle)
    return StaleResult(threshold_days=days, items=items, actions=actions)


AGENTS = {
    "intake": {"title": "New report intake", "needs_report": True,
               "tools": ["get_report", "compute_confidence", "find_duplicates", "add_issue_note", "set_issue_status"]},
    "evidence_analysis": {"title": "Evidence analysis", "needs_report": True,
                          "tools": ["get_report", "classify_evidence", "add_issue_note"]},
    "duplicate_investigation": {"title": "Duplicate investigation", "needs_report": False,
                                "tools": ["find_duplicates", "add_issue_note"]},
    "hotspot_analysis": {"title": "Hotspot analysis", "needs_report": False, "tools": ["recalculate_hotspots"]},
    "stale_followup": {"title": "Stale report follow-up", "needs_report": False,
                       "tools": ["list_stale_issues", "add_issue_note", "set_issue_status"]},
}
