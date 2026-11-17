"""Recheck saved corridors. Run by the scheduled script (scripts/check_corridors.py), not by a
web request. For each corridor it asks the router for the current route, then compares it with
the last check. Events that are new since the last check go to the inbox and to push.

Route changes are judged on the saved profile's route. Reports and outages are judged on the
shortest walk, because that is where a barrier would affect the person, even when the saved
profile routes around it.

Nothing is written to report, place or issue tables. Only the corridor's own check state and
the user's inbox change."""

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Issue, Place, PlaceAccessibility, Report, SavedCorridor
from app.models.entities import utcnow
from app.services.alerts.matching import (
    CONFIRMED_ISSUE_STATES,
    OUTAGE_FEATURES,
    OUTAGE_NEAR_M,
    ROUTE_NEAR_M,
    is_after,
    near_route,
    route_fingerprint,
)
from app.services.alerts.notify import notify
from app.services.routing.engine import Router, RoutingError

log = logging.getLogger("app.services.alerts.check")


def _since(c: SavedCorridor) -> datetime:
    return c.last_checked_at or c.created_at


def check_corridor(db: Session, c: SavedCorridor, now: datetime | None = None) -> dict:
    """Returns counts for logging: alerts sent, and whether a route could be planned."""
    now = now or utcnow()
    since = _since(c)
    origin, destination = (c.origin_lat, c.origin_lng), (c.destination_lat, c.destination_lng)
    router = Router(db, now=now)
    try:
        plan = router.route(origin, destination, c.profile, False, alternatives=0)
    except RoutingError:
        c.last_checked_at = now
        return {"sent": 0, "route": False}
    route = plan["routes"][0]
    barrier_ids = [b["report_id"] for seg in route["segments"] for b in seg["barriers"]]
    streets = [seg["name"] for seg in route["segments"]]
    fingerprint = route_fingerprint(route["distance_m"], barrier_ids, streets)
    walk = router.shortest_walk_coords(origin, destination) or route["geometry"]["coordinates"]

    events: list[tuple[str, str, str, str]] = []  # (kind, key, title, body)
    if c.fingerprint and c.fingerprint != fingerprint and c.notify_route_changes:
        events.append(("route_change", f"route:{fingerprint[:16]}", "A saved walk has changed",
                       "A report or a map change altered a route you are watching. Open the route planner to see it."))
    if c.notify_reports:
        rows = db.execute(
            select(Report, Issue.status).join(Issue, Issue.report_id == Report.id).where(
                Report.deleted_at.is_(None), Report.status == "open", Report.duplicate_of.is_(None))
        ).all()
        for report, issue_status in rows:
            if issue_status not in CONFIRMED_ISSUE_STATES or not is_after(report.reported_at, since):
                continue
            if near_route(report.lat, report.lng, walk, ROUTE_NEAR_M):
                events.append(("report", f"report:{report.id}",
                               "A confirmed barrier was reported near a saved walk",
                               "Open the route planner to see how it affects your route."))
    if c.notify_outages:
        rows = db.execute(
            select(PlaceAccessibility, Place).join(Place, PlaceAccessibility.place_id == Place.id).where(
                PlaceAccessibility.feature_type.in_(OUTAGE_FEATURES),
                PlaceAccessibility.status == "unavailable")
        ).all()
        for feature, place in rows:
            if not is_after(feature.assessed_at, since):
                continue
            if near_route(place.lat, place.lng, walk, OUTAGE_NEAR_M):
                events.append(("outage", f"outage:{feature.id}",
                               "An accessibility feature near a saved walk is out of service",
                               "Check the place page before you set out."))
    sent = 0
    for kind, key, title, body in events:
        if notify(db, c.user_id, kind=kind, title=title, body=body, dedupe_key=f"{c.id}:{key}",
                  corridor_id=c.id) is not None:
            sent += 1
    c.fingerprint = fingerprint
    c.last_checked_at = now
    return {"sent": sent, "route": True}


def check_all(db: Session, now: datetime | None = None) -> dict:
    corridors = db.scalars(select(SavedCorridor).where(SavedCorridor.deleted_at.is_(None))).all()
    totals = {"corridors": 0, "events": 0, "no_route": 0}
    for c in corridors:
        result = check_corridor(db, c, now)
        totals["corridors"] += 1
        totals["events"] += result["sent"]
        totals["no_route"] += 0 if result["route"] else 1
    db.commit()
    return totals
