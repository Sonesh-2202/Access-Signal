from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.domain.taxonomy import ISSUE_TRANSITIONS, priority_for_severity
from app.models import Issue, IssueHistory, Report, User
from app.services import places as place_service


class TransitionError(ValueError):
    pass


def open_issue_for(db: Session, report: Report, actor: User | None = None) -> Issue:
    issue = Issue(report_id=report.id, status="reported", priority=priority_for_severity(report.severity_score))
    issue.history.append(IssueHistory(changed_by=actor.id if actor else None, old_status=None,
                                      new_status="reported", notes="Created from community report"))
    db.add(issue)
    return issue


def allowed_transitions(issue: Issue) -> list[str]:
    return sorted(ISSUE_TRANSITIONS.get(issue.status, set()))


def transition(db: Session, issue: Issue, new_status: str, actor: User, notes: str | None = None,
               resolution_notes: str | None = None, resolution_evidence_id: str | None = None) -> None:
    if new_status == issue.status:
        return
    if new_status not in ISSUE_TRANSITIONS.get(issue.status, set()):
        raise TransitionError(f"Cannot move an issue from {issue.status} to {new_status}")
    if new_status == "assigned" and not issue.assigned_to:
        raise TransitionError("Assign the issue to someone before marking it assigned")
    if new_status == "resolved":
        text = (resolution_notes or issue.resolution_notes or "").strip()
        if len(text) < 10:
            raise TransitionError("Describe the fix (at least 10 characters) before resolving")
        issue.resolution_notes = text
        if resolution_evidence_id:
            issue.resolution_evidence_id = resolution_evidence_id

    now = datetime.now(UTC)
    old = issue.status
    issue.status = new_status
    issue.updated_at = now
    issue.history.append(IssueHistory(changed_by=actor.id, old_status=old, new_status=new_status, notes=notes))

    report = issue.report
    if new_status == "resolved":
        issue.resolved_at = now
        report.status = "resolved"
        report.resolved_at = now
    elif old in ("resolved", "reverification") and new_status == "confirmed":
        # Reverification failed: barrier is back.
        issue.resolved_at = None
        report.status = "open"
        report.resolved_at = None
    if report.place is not None and new_status in ("resolved", "confirmed"):
        place_service.apply_report(db, report.place, report)
