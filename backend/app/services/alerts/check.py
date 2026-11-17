"""Alert checks, run by the scheduled script (scripts/check_corridors.py), not by a web request.

Saved routes: for each corridor it asks the router for the current route, then compares it with
the last check. Events that are new since the last check go to the inbox and to push.

Alerts near me: open barriers and out-of-service features near a shared location, from plain
distance on stored records. No AI is involved.

Route changes are judged on the saved profile's route. Reports and outages are judged on the
shortest walk, because that is where a barrier would affect the person, even when the saved
profile routes around it.

Nothing is written to report, place or issue tables. Only the corridor's own check state and
the user's inbox change."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.taxonomy import subcategory_info
from app.models import Issue, Place, PlaceAccessibility, Report, SavedCorridor, User
from app.models.entities import utcnow
from app.services.alerts.matching import (
    CONFIRMED_ISSUE_STATES,
    NEARBY_LOCATION_TTL,
    OUTAGE_FEATURES,
    OUTAGE_NEAR_M,
    ROUTE_NEAR_M,
    is_after,
    near_route,
    route_fingerprint,
    within_radius,
)
from app.services.alerts.notify import notify
from app.services.places import feature_label
from app.services.routing.engine import Router, RoutingError
from app.utils.geo import bbox_around, haversine_m

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


# ------------------------------------------------------------------ alerts near me
@dataclass
class NearbyFound:
    """Open barriers and out-of-service features within a radius, nearest first. Read-only."""
    barriers: list[tuple[Report, float]]
    outages: list[tuple[PlaceAccessibility, Place, float]]


def find_nearby(db: Session, lat: float, lng: float, radius_m: float) -> NearbyFound:
    """A bounding box narrows the rows first; exact straight-line distance then decides. Deleted,
    resolved and duplicate reports never count, and only unavailable critical features count."""
    min_lat, min_lng, max_lat, max_lng = bbox_around(lat, lng, radius_m)
    reports = db.scalars(select(Report).where(
        Report.lat.between(min_lat, max_lat), Report.lng.between(min_lng, max_lng),
        Report.status == "open", Report.deleted_at.is_(None), Report.duplicate_of.is_(None))).all()
    barriers = []
    for r in reports:
        if within_radius(lat, lng, r.lat, r.lng, radius_m):
            barriers.append((r, _metres(lat, lng, r.lat, r.lng)))
    barriers.sort(key=lambda item: item[1])

    rows = db.execute(
        select(PlaceAccessibility, Place).join(Place, PlaceAccessibility.place_id == Place.id).where(
            Place.lat.between(min_lat, max_lat), Place.lng.between(min_lng, max_lng),
            PlaceAccessibility.feature_type.in_(OUTAGE_FEATURES), PlaceAccessibility.status == "unavailable")
    ).all()
    outages = []
    for feature, place in rows:
        if within_radius(lat, lng, place.lat, place.lng, radius_m):
            outages.append((feature, place, _metres(lat, lng, place.lat, place.lng)))
    outages.sort(key=lambda item: item[2])
    return NearbyFound(barriers=barriers, outages=outages)


def _metres(lat: float, lng: float, other_lat: float, other_lng: float) -> float:
    return haversine_m(lat, lng, other_lat, other_lng)


def barrier_label(report: Report) -> str:
    return subcategory_info(report.category, report.subcategory)["label"]


def outage_label(feature: PlaceAccessibility) -> str:
    return f"{feature_label(feature.feature_type)} out of service"


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def fresh_location(user: User, now: datetime) -> tuple[float, float] | None:
    """The user's shared location, if alerts near me are on and the location is under 24 hours old."""
    if not user.nearby_alerts or user.nearby_lat is None or user.nearby_lng is None or user.nearby_location_at is None:
        return None
    if _aware(user.nearby_location_at) < _aware(now) - NEARBY_LOCATION_TTL:
        return None
    return user.nearby_lat, user.nearby_lng


def check_nearby(db: Session, user: User, now: datetime | None = None) -> int:
    """Alert the user about open barriers and out-of-service features near their shared location.
    Each record alerts a person once (dedupe key). Pushes carry generic text and a link only, never
    an address, a place name or report text. Returns how many alerts were new."""
    now = now or utcnow()
    loc = fresh_location(user, now)
    if loc is None:
        return 0
    found = find_nearby(db, loc[0], loc[1], user.nearby_radius_m)
    sent = 0
    for report, _distance in found.barriers:
        if notify(db, user.id, kind="nearby_report", title="A barrier was reported near you",
                  body="Open Nearby in AccessSignal to see it. Alerts contain no addresses or names.",
                  dedupe_key=f"nearby:report:{report.id}", url="#nearby") is not None:
            sent += 1
    for feature, _place, _distance in found.outages:
        if notify(db, user.id, kind="nearby_outage", title="An accessibility feature near you is out of service",
                  body="Open Nearby in AccessSignal to see which one. Check before you set out.",
                  dedupe_key=f"nearby:outage:{feature.id}", url="#nearby") is not None:
            sent += 1
    return sent


def purge_stale_locations(db: Session, now: datetime | None = None) -> int:
    """Forget shared locations older than 24 hours. Returns how many were cleared."""
    now = now or utcnow()
    cutoff = _aware(now) - NEARBY_LOCATION_TTL
    stale = [u for u in db.scalars(select(User).where(User.nearby_location_at.is_not(None))).all()
             if _aware(u.nearby_location_at) < cutoff]
    for u in stale:
        u.nearby_lat = u.nearby_lng = u.nearby_location_at = None
    return len(stale)


def check_nearby_all(db: Session, now: datetime | None = None) -> dict:
    """The scheduled run for alerts near me: forget stale locations, then check everyone who still
    has a fresh location and alerts switched on."""
    now = now or utcnow()
    totals = {"purged": purge_stale_locations(db, now), "users": 0, "events": 0}
    for user in db.scalars(select(User).where(User.nearby_alerts.is_(True))).all():
        if fresh_location(user, now) is None:
            continue
        totals["users"] += 1
        totals["events"] += check_nearby(db, user, now)
    db.commit()
    return totals
