from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Evidence, Issue, Place, Report
from app.schemas import (
    EvidenceOut,
    IssueHistoryOut,
    IssueOut,
    PlaceFeatureOut,
    PlaceSummary,
    ReportDetail,
    ReportSummary,
)
from app.services.places import feature_label


def evidence_out(e: Evidence) -> EvidenceOut:
    out = EvidenceOut.model_validate(e)
    out.url = f"/api/evidence/{e.id}/file" if e.file_path else None
    return out


def report_summary(r: Report) -> ReportSummary:
    s = ReportSummary.model_validate(r)
    s.evidence_count = len(r.evidence)
    s.issue_status = r.issue.status if r.issue else None
    return s


def report_detail(db: Session, r: Report) -> ReportDetail:
    d = ReportDetail.model_validate(r)
    d.evidence_count = len(r.evidence)
    d.issue_status = r.issue.status if r.issue else None
    d.evidence = [evidence_out(e) for e in r.evidence]
    d.reporter = r.user.display_name if r.user else None
    d.place_name = r.place.name if r.place else None
    ids = (r.confidence_breakdown or {}).get("corroborating_ids", [])
    linked = db.scalars(select(Report).where(Report.duplicate_of == r.id, Report.deleted_at.is_(None))).all()
    extra = db.scalars(select(Report).where(Report.id.in_(ids))).all() if ids else []
    seen, corr = set(), []
    for x in [*linked, *extra]:
        if x.id not in seen:
            seen.add(x.id)
            corr.append(report_summary(x))
    d.corroborating = corr
    return d


def issue_out(i: Issue) -> IssueOut:
    o = IssueOut.model_validate({
        **{k: getattr(i, k) for k in ("id", "status", "priority", "assigned_to", "resolution_notes",
                                       "created_at", "updated_at", "resolved_at")},
        "report": report_summary(i.report),
    })
    o.assignee_name = i.assignee.display_name if i.assignee else None
    return o


def history_out(h) -> IssueHistoryOut:
    o = IssueHistoryOut.model_validate(h)
    o.actor_name = h.actor.display_name if h.actor else "System"
    return o


def place_summary(p: Place, open_reports: int = 0) -> PlaceSummary:
    s = PlaceSummary.model_validate(p)
    s.open_reports = open_reports
    s.feature_status = {f.feature_type: f.status for f in p.features}
    return s


def feature_out(f) -> PlaceFeatureOut:
    o = PlaceFeatureOut.model_validate(f)
    o.label = feature_label(f.feature_type)
    return o
