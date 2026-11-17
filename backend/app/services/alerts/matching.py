"""Matching for saved corridors. Pure functions: no database, no network, so the rules are
easy to test. A corridor is a route between two saved points. Something matches it when it
lies within a short distance of the walk's line."""

import hashlib
from collections.abc import Iterable
from datetime import UTC, datetime

from datetime import timedelta

from app.utils.geo import haversine_m, point_to_segment_m

# Alerts near me: how long a shared location is kept.
NEARBY_LOCATION_TTL = timedelta(hours=24)

ROUTE_NEAR_M = 25.0  # a report this close to the walk affects it
OUTAGE_NEAR_M = 50.0  # a place this close to the walk is on the way
# Accessibility features whose outage matters to someone walking the route.
OUTAGE_FEATURES = frozenset({"elevator", "step_free_entrance", "ramp", "accessible_restroom"})
# A report counts as confirmed once staff have confirmed its issue.
CONFIRMED_ISSUE_STATES = frozenset({"confirmed", "assigned", "in_progress"})
FINGERPRINT_STEP_M = 10.0  # route length changes below this are not material


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def is_after(when: datetime | None, since: datetime) -> bool:
    return when is not None and _aware(when) > _aware(since)


def route_fingerprint(distance_m: float, barrier_ids: Iterable[str], streets: Iterable[str]) -> str:
    """A hash of what makes a route the route it is: its length (to 10 m), the barrier reports it
    passes, and its streets in order. The same route gives the same fingerprint, so a change
    means the route changed, even when a detour is the same length."""
    raw = (f"{round(distance_m / FINGERPRINT_STEP_M)}|" + ",".join(sorted(set(barrier_ids)))
           + "|" + ">".join(streets))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:64]


def distance_to_route_m(lat: float, lng: float, coords: list[list[float]]) -> float:
    """Shortest distance from a point to a line. Coordinates are [lng, lat] pairs."""
    if len(coords) == 1:
        a = coords[0]
        return point_to_segment_m(lat, lng, (a[0], a[1]), (a[0], a[1]))
    return min(point_to_segment_m(lat, lng, (a[0], a[1]), (b[0], b[1])) for a, b in zip(coords, coords[1:]))


def near_route(lat: float, lng: float, coords: list[list[float]], radius_m: float) -> bool:
    return distance_to_route_m(lat, lng, coords) <= radius_m


def within_radius(lat: float, lng: float, other_lat: float, other_lng: float, radius_m: float) -> bool:
    """Straight-line distance between two points is at most the radius (haversine, metres)."""
    return haversine_m(lat, lng, other_lat, other_lng) <= radius_m
