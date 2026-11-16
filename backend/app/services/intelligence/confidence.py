"""Report confidence: how sure are we that this barrier exists right now?

score = 0.35 * evidence + 0.30 * corroboration + 0.15 * recency + 0.20 * credibility

Every factor is in 0..1 and comes with a plain-language reason so the UI can show
people *why* a report is trusted, not just a number."""

import math
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Issue, Report, User
from app.utils.geo import bbox_around, haversine_m

WEIGHTS = {"evidence": 0.35, "corroboration": 0.30, "recency": 0.15, "credibility": 0.20}
RECENCY_HALF_LIFE_DAYS = 14.0
CORROBORATION_RADIUS_M = 50.0


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def evidence_quality(report: Report) -> tuple[float, str]:
    kinds = {e.type for e in report.evidence}
    score, parts = 0.0, []
    if "photo" in kinds:
        score += 0.45
        parts.append("photo")
    if "voice" in kinds:
        score += 0.2
        parts.append("voice note")
    if len((report.description or "").strip()) >= 40:
        score += 0.15
        parts.append("detailed description")
    ai = report.ai_analysis or {}
    if ai and ai.get("subcategory") == report.subcategory:
        # Any model tier counts more than the keyword rules.
        score += 0.2 if ai.get("source") not in (None, "heuristic") else 0.1
        parts.append("AI classification agrees")
    score = min(1.0, score)
    reason = ("Evidence: " + ", ".join(parts)) if parts else "No photo or voice evidence yet"
    return score, reason


def corroborating_reports(db: Session, report: Report) -> list[Report]:
    """Independent reports (different reporter) of the same category nearby, including
    reports explicitly linked as duplicates of this one."""
    min_lat, min_lng, max_lat, max_lng = bbox_around(report.lat, report.lng, CORROBORATION_RADIUS_M)
    since = _aware(report.reported_at) - timedelta(days=30)
    rows = db.scalars(
        select(Report).where(
            Report.id != report.id,
            Report.deleted_at.is_(None),
            Report.category == report.category,
            Report.lat.between(min_lat, max_lat),
            Report.lng.between(min_lng, max_lng),
            Report.reported_at >= since,
            Report.status.in_(("open", "duplicate")),
        )
    ).all()
    seen_users = {report.user_id}
    out = []
    for r in rows:
        if haversine_m(report.lat, report.lng, r.lat, r.lng) > CORROBORATION_RADIUS_M:
            continue
        if r.user_id in seen_users and r.user_id is not None:
            continue
        seen_users.add(r.user_id)
        out.append(r)
    return out


def corroboration_score(n: int) -> tuple[float, str]:
    score = 1.0 - 0.5**n
    if n == 0:
        return 0.0, "No independent reports yet"
    return score, f"{n} independent report{'s' if n != 1 else ''} within 50 m"


def recency_score(reported_at: datetime, now: datetime) -> tuple[float, str]:
    age_days = max(0.0, (now - _aware(reported_at)).total_seconds() / 86400)
    score = math.pow(0.5, age_days / RECENCY_HALF_LIFE_DAYS)
    if age_days < 1:
        label = "Reported in the last 24 hours"
    else:
        label = f"Reported {int(age_days)} day{'s' if int(age_days) != 1 else ''} ago"
    return score, label


def credibility_score(db: Session, user: User | None) -> tuple[float, str]:
    if user is None:
        return 0.3, "Anonymous reporter"
    if user.role in ("infrastructure_manager", "admin"):
        return 0.9, "Reported by verified staff"
    total = db.scalar(select(func.count()).select_from(Report).where(Report.user_id == user.id,
                                                                      Report.deleted_at.is_(None))) or 0
    confirmed = db.scalar(
        select(func.count()).select_from(Issue).join(Report, Issue.report_id == Report.id).where(
            Report.user_id == user.id,
            Issue.status.in_(("confirmed", "assigned", "in_progress", "resolved", "reverification")),
        )
    ) or 0
    # Beta(1,1) prior: new reporters start at 0.5 and move with their track record.
    score = (confirmed + 1) / (total + 2)
    return score, f"Reporter has {confirmed} of {total} reports confirmed"


def compute_confidence(db: Session, report: Report, now: datetime | None = None) -> tuple[float, dict]:
    now = now or datetime.now(UTC)
    ev, ev_r = evidence_quality(report)
    corr_reports = corroborating_reports(db, report)
    co, co_r = corroboration_score(len(corr_reports))
    re_, re_r = recency_score(report.reported_at, now)
    cr, cr_r = credibility_score(db, report.user)
    factors = {"evidence": ev, "corroboration": co, "recency": re_, "credibility": cr}
    score = sum(WEIGHTS[k] * v for k, v in factors.items())
    breakdown = {
        "score": round(score, 3),
        "factors": {k: {"value": round(v, 3), "weight": WEIGHTS[k]} for k, v in factors.items()},
        "explanation": [ev_r, co_r, re_r, cr_r],
        "corroborating_ids": [r.id for r in corr_reports],
        "computed_at": now.isoformat(),
    }
    return round(score, 3), breakdown


def refresh_confidence(db: Session, report: Report, now: datetime | None = None) -> None:
    report.confidence_score, report.confidence_breakdown = compute_confidence(db, report, now)
