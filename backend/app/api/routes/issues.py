import csv
import io
import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import manager_only
from app.api.serializers import history_out, issue_out, report_detail
from app.core.database import get_db
from app.domain.taxonomy import ISSUE_PRIORITIES, subcategory_info
from app.models import Evidence, Issue, IssueHistory, Report, User
from app.schemas import IssueDetail, IssuePage, IssueUpdate
from app.services import issues as issue_service
from app.services.alerts.reverify import notify_reverification

router = APIRouter(prefix="/api/issues", tags=["issues"])

PRIORITY_RANK = {p: i for i, p in enumerate(reversed(ISSUE_PRIORITIES))}  # critical=0


def _query(status_: list[str] | None, priority: list[str] | None, category: list[str] | None,
           assigned: str | None, q: str | None, me: User):
    stmt = (select(Issue).join(Report, Issue.report_id == Report.id)
            .where(Issue.deleted_at.is_(None), Report.deleted_at.is_(None))
            .options(selectinload(Issue.report).selectinload(Report.evidence), selectinload(Issue.assignee)))
    if status_:
        stmt = stmt.where(Issue.status.in_(status_))
    if priority:
        stmt = stmt.where(Issue.priority.in_(priority))
    if category:
        stmt = stmt.where(Report.category.in_(category))
    if assigned == "me":
        stmt = stmt.where(Issue.assigned_to == me.id)
    elif assigned == "unassigned":
        stmt = stmt.where(Issue.assigned_to.is_(None))
    elif assigned:
        stmt = stmt.where(Issue.assigned_to == assigned)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Report.description.ilike(like), Report.address.ilike(like)))
    return stmt


@router.get("", response_model=IssuePage)
def list_issues(
    status_: list[str] | None = Query(default=None, alias="status"),
    priority: list[str] | None = Query(default=None),
    category: list[str] | None = Query(default=None),
    assigned: str | None = None,
    q: str | None = Query(default=None, max_length=100),
    sort: str = Query(default="priority", pattern="^(priority|recent|updated|confidence)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=200),
    user: User = Depends(manager_only),
    db: Session = Depends(get_db),
):
    rows = db.scalars(_query(status_, priority, category, assigned, q, user)).all()
    keyf = {
        "priority": lambda i: (PRIORITY_RANK.get(i.priority, 9), -i.report.confidence_score),
        "recent": lambda i: -i.created_at.timestamp(),
        "updated": lambda i: -i.updated_at.timestamp(),
        "confidence": lambda i: -i.report.confidence_score,
    }[sort]
    rows = sorted(rows, key=keyf)
    return IssuePage(items=[issue_out(i) for i in rows[offset:offset + limit]], total=len(rows))


@router.get("/assignees")
def assignees(_: User = Depends(manager_only), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(User).where(User.role.in_(("infrastructure_manager", "admin")))
                      .order_by(User.display_name)).all()
    return [{"id": u.id, "display_name": u.display_name, "role": u.role} for u in rows]


@router.get("/stats")
def stats(_: User = Depends(manager_only), db: Session = Depends(get_db)) -> dict:
    base = select(Issue.status, func.count()).where(Issue.deleted_at.is_(None)).group_by(Issue.status)
    by_status = dict(db.execute(base).all())
    by_priority = dict(db.execute(
        select(Issue.priority, func.count()).where(Issue.deleted_at.is_(None), Issue.status != "resolved")
        .group_by(Issue.priority)).all())
    return {"by_status": by_status, "open_by_priority": by_priority}


@router.get("/export")
def export(
    fmt: str = Query(default="csv", alias="format", pattern="^(csv|json)$"),
    status_: list[str] | None = Query(default=None, alias="status"),
    user: User = Depends(manager_only),
    db: Session = Depends(get_db),
):
    rows = db.scalars(_query(status_, None, None, None, None, user)).all()
    records = [{
        "issue_id": i.id, "status": i.status, "priority": i.priority,
        "category": i.report.category, "subcategory": i.report.subcategory,
        "label": subcategory_info(i.report.category, i.report.subcategory)["label"],
        "lat": i.report.lat, "lng": i.report.lng, "address": i.report.address or "",
        "severity": i.report.severity_score, "confidence": i.report.confidence_score,
        "assigned_to": i.assignee.display_name if i.assignee else "",
        "reported_at": i.report.reported_at.isoformat(), "updated_at": i.updated_at.isoformat(),
        "resolved_at": i.resolved_at.isoformat() if i.resolved_at else "",
        "description": i.report.description, "resolution_notes": i.resolution_notes or "",
    } for i in rows]
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    if fmt == "json":
        body = json.dumps(records, indent=2)
        return StreamingResponse(iter([body]), media_type="application/json",
                                 headers={"Content-Disposition": f'attachment; filename="accesssignal-issues-{stamp}.json"'})
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(records[0].keys()) if records else ["issue_id"])
    writer.writeheader()
    for rec in records:
        # Neutralise spreadsheet formula injection from user-supplied text.
        writer.writerow({k: (f"'{v}" if isinstance(v, str) and v[:1] in "=+-@" else v) for k, v in rec.items()})
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="accesssignal-issues-{stamp}.csv"'})


def _detail(db: Session, i: Issue) -> IssueDetail:
    base = issue_out(i)
    return IssueDetail(**base.model_dump(), history=[history_out(h) for h in i.history],
                       report_detail=report_detail(db, i.report),
                       allowed_transitions=issue_service.allowed_transitions(i))


@router.get("/{issue_id}", response_model=IssueDetail)
def get_issue(issue_id: str, _: User = Depends(manager_only), db: Session = Depends(get_db)):
    i = db.get(Issue, issue_id)
    if i is None or i.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Issue not found")
    return _detail(db, i)


@router.patch("/{issue_id}", response_model=IssueDetail)
def update_issue(issue_id: str, body: IssueUpdate, user: User = Depends(manager_only), db: Session = Depends(get_db)):
    i = db.get(Issue, issue_id)
    if i is None or i.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Issue not found")

    if body.unassign:
        if i.assigned_to:
            i.history.append(IssueHistory(changed_by=user.id, old_status=i.status, new_status=i.status,
                                          notes="Unassigned"))
        i.assigned_to = None
    elif body.assigned_to is not None and body.assigned_to != i.assigned_to:
        assignee = db.get(User, body.assigned_to)
        if assignee is None or assignee.role not in ("infrastructure_manager", "admin"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Issues can only be assigned to staff accounts")
        i.assigned_to = assignee.id
        i.history.append(IssueHistory(changed_by=user.id, old_status=i.status, new_status=i.status,
                                      notes=f"Assigned to {assignee.display_name}"))
    if body.priority and body.priority != i.priority:
        i.history.append(IssueHistory(changed_by=user.id, old_status=i.status, new_status=i.status,
                                      notes=f"Priority changed from {i.priority} to {body.priority}"))
        i.priority = body.priority
    if body.resolution_evidence_id:
        ev = db.get(Evidence, body.resolution_evidence_id)
        if ev is None or (ev.meta or {}).get("uploader_id") != user.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Resolution evidence not found")
        ev.report_id = i.report_id
        ev.meta = {**(ev.meta or {}), "role": "resolution"}
    if body.status:
        try:
            issue_service.transition(db, i, body.status, user, notes=body.notes,
                                     resolution_notes=body.resolution_notes,
                                     resolution_evidence_id=body.resolution_evidence_id)
        except issue_service.TransitionError as e:
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    elif body.notes:
        i.history.append(IssueHistory(changed_by=user.id, old_status=i.status, new_status=i.status, notes=body.notes))
    if body.resolution_notes and not body.status:
        i.resolution_notes = body.resolution_notes
    if body.status == "resolved":
        notify_reverification(db, i.report)  # nudges only; nothing changes until a reporter confirms
    i.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(i)
    return _detail(db, i)
