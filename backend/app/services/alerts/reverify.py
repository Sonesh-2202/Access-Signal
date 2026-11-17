"""Reverification nudge. When a repair is filed, people who reported the same kind of barrier
nearby are asked to check it. This only sends an inbox item and a push. It changes no report,
and the repair is not treated as fixed until a person confirms it."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Report
from app.services.alerts.notify import notify
from app.utils.geo import haversine_m

NEARBY_M = 50.0


def notify_reverification(db: Session, fixed: Report) -> int:
    """Returns how many people were nudged. Call it after a repair is filed."""
    rows = db.scalars(select(Report).where(
        Report.deleted_at.is_(None),
        Report.status == "open",
        Report.subcategory == fixed.subcategory,
        Report.user_id.is_not(None),
        Report.id != fixed.id,
    )).all()
    nudged = 0
    for r in rows:
        if r.user_id == fixed.user_id or haversine_m(fixed.lat, fixed.lng, r.lat, r.lng) > NEARBY_M:
            continue
        item = notify(db, r.user_id, kind="reverify",
                      title="A repair was filed near a barrier you reported",
                      body="Please check it. Open your report and say whether it is fixed. Nothing changes until you confirm.",
                      dedupe_key=f"reverify:{fixed.id}:{r.id}")
        nudged += 1 if item is not None else 0
    return nudged
