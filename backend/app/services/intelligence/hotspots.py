"""Hotspot detection with a small DBSCAN over open reports (haversine metric).

Hand-rolled instead of scikit-learn: report counts are in the thousands at most and
avoiding the dependency keeps installs fast on every platform."""

import math
from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Hotspot, Place, Report
from app.utils.geo import bbox_around, circle_polygon, haversine_m

EPS_M = 120.0
MIN_POINTS = 2


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def dbscan(points: list[tuple[float, float]], eps_m: float = EPS_M, min_pts: int = MIN_POINTS) -> list[int]:
    """Returns a cluster label per point; -1 is noise."""
    n = len(points)
    labels = [-2] * n  # -2 unvisited

    def neighbours(i: int) -> list[int]:
        la, lo = points[i]
        return [j for j in range(n) if haversine_m(la, lo, points[j][0], points[j][1]) <= eps_m]

    cluster = -1
    for i in range(n):
        if labels[i] != -2:
            continue
        nb = neighbours(i)
        if len(nb) < min_pts:
            labels[i] = -1
            continue
        cluster += 1
        labels[i] = cluster
        queue = [j for j in nb if j != i]
        while queue:
            j = queue.pop()
            if labels[j] == -1:
                labels[j] = cluster
            if labels[j] != -2:
                continue
            labels[j] = cluster
            nb_j = neighbours(j)
            if len(nb_j) >= min_pts:
                queue.extend(k for k in nb_j if labels[k] in (-2, -1))
    return labels


def severity_index(reports: list[Report]) -> float:
    """Mean confidence-weighted severity, scaled up by how many reports agree.
    Saturates towards 1.0; a single report can't reach above ~0.3."""
    if not reports:
        return 0.0
    weighted = sum(r.severity_score * (0.5 + 0.5 * r.confidence_score) for r in reports) / len(reports)
    volume = 1.0 - math.exp(-len(reports) / 3.0)
    return round(weighted * volume, 3)


def trend(reports: list[Report], now: datetime) -> str:
    recent = sum(1 for r in reports if _aware(r.reported_at) >= now - timedelta(days=14))
    prior = sum(1 for r in reports if now - timedelta(days=28) <= _aware(r.reported_at) < now - timedelta(days=14))
    if recent > prior:
        return "rising"
    if recent < prior:
        return "falling"
    return "stable"


def _label(db: Session, lat: float, lng: float, reports: list[Report]) -> str | None:
    min_lat, min_lng, max_lat, max_lng = bbox_around(lat, lng, 150)
    places = db.scalars(select(Place).where(Place.lat.between(min_lat, max_lat),
                                            Place.lng.between(min_lng, max_lng))).all()
    if places:
        return min(places, key=lambda p: haversine_m(lat, lng, p.lat, p.lng)).name
    addrs = Counter(r.address for r in reports if r.address)
    return addrs.most_common(1)[0][0] if addrs else None


def recalculate_hotspots(db: Session, now: datetime | None = None) -> list[Hotspot]:
    now = now or datetime.now(UTC)
    reports = db.scalars(
        select(Report).where(Report.deleted_at.is_(None), Report.status.in_(("open", "duplicate")),
                             Report.reported_at >= now - timedelta(days=90))
    ).all()
    labels = dbscan([(r.lat, r.lng) for r in reports])
    clusters: dict[int, list[Report]] = {}
    for r, lab in zip(reports, labels, strict=True):
        if lab >= 0:
            clusters.setdefault(lab, []).append(r)

    db.execute(delete(Hotspot))
    out = []
    for members in clusters.values():
        lat = sum(r.lat for r in members) / len(members)
        lng = sum(r.lng for r in members) / len(members)
        radius = max(haversine_m(lat, lng, r.lat, r.lng) for r in members) + 30
        dominant = Counter(r.category for r in members).most_common(1)[0][0]
        h = Hotspot(
            lat=lat, lng=lng, radius_m=round(radius, 1), area=circle_polygon(lat, lng, radius),
            severity_index=severity_index(members), report_count=len(members),
            dominant_category=dominant, trend=trend(members, now),
            report_ids=[r.id for r in members], calculated_at=now,
        )
        db.add(h)
        out.append(h)
    db.commit()
    out.sort(key=lambda h: h.severity_index, reverse=True)
    return out


def hotspot_label(db: Session, h: Hotspot) -> str | None:
    reports = db.scalars(select(Report).where(Report.id.in_(h.report_ids))).all()
    return _label(db, h.lat, h.lng, reports)
