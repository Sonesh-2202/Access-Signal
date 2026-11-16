import statistics
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import manager_only
from app.core.database import get_db
from app.domain.taxonomy import CATEGORIES
from app.models import Hotspot, Issue, Place, Report, User
from app.schemas import HotspotOut
from app.services.intelligence.hotspots import hotspot_label, recalculate_hotspots
from app.services.routing.engine import load_graph
from app.utils.geo import SERVICE_AREA

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _reports(db: Session, since: datetime | None = None) -> list[Report]:
    stmt = select(Report).where(Report.deleted_at.is_(None), Report.duplicate_of.is_(None))
    if since:
        stmt = stmt.where(Report.reported_at >= since)
    return list(db.scalars(stmt))


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    now = datetime.now(UTC)
    reports = _reports(db)
    issues = list(db.scalars(select(Issue).where(Issue.deleted_at.is_(None))))
    open_r = [r for r in reports if r.status == "open"]
    resolved = [i for i in issues if i.resolved_at]
    hours = [(_aware(i.resolved_at) - _aware(i.report.reported_at)).total_seconds() / 3600 for i in resolved]
    last30 = [r for r in reports if _aware(r.reported_at) >= now - timedelta(days=30)]
    prev30 = [r for r in reports if now - timedelta(days=60) <= _aware(r.reported_at) < now - timedelta(days=30)]
    places = list(db.scalars(select(Place)))
    return {
        "open_reports": len(open_r),
        "critical_open": sum(1 for i in issues if i.priority == "critical" and i.status != "resolved"),
        "resolved_total": len(resolved),
        "reports_last_30d": len(last30),
        "reports_prev_30d": len(prev30),
        "median_resolution_hours": round(statistics.median(hours), 1) if hours else None,
        "places_total": len(places),
        "places_with_data": sum(1 for p in places if p.verification_status != "unverified"),
        "high_confidence_open": sum(1 for r in open_r if r.confidence_score >= 0.6),
        "contributors": len({r.user_id for r in reports if r.user_id}),
    }


@router.get("/trends")
def trends(weeks: int = Query(default=12, ge=4, le=52), db: Session = Depends(get_db)) -> dict:
    now = datetime.now(UTC)
    start = (now - timedelta(weeks=weeks)).replace(hour=0, minute=0, second=0, microsecond=0)
    start -= timedelta(days=start.weekday())
    buckets = [start + timedelta(weeks=i) for i in range(weeks + 1)]

    def idx(dt: datetime) -> int | None:
        dt = _aware(dt)
        if dt < start:
            return None
        return min(len(buckets) - 1, int((dt - start).days // 7))

    reported = [0] * len(buckets)
    resolved = [0] * len(buckets)
    by_cat: dict[str, list[int]] = defaultdict(lambda: [0] * len(buckets))
    for r in _reports(db, start):
        i = idx(r.reported_at)
        if i is not None:
            reported[i] += 1
            by_cat[r.category][i] += 1
    for iss in db.scalars(select(Issue).where(Issue.resolved_at.is_not(None), Issue.deleted_at.is_(None))):
        i = idx(iss.resolved_at)
        if i is not None:
            resolved[i] += 1
    return {
        "weeks": [b.date().isoformat() for b in buckets],
        "reported": reported,
        "resolved": resolved,
        "by_category": dict(by_cat),
    }


@router.get("/categories")
def categories(db: Session = Depends(get_db)) -> list[dict]:
    rows = _reports(db)
    total = Counter(r.category for r in rows)
    open_ = Counter(r.category for r in rows if r.status == "open")
    sev = defaultdict(list)
    for r in rows:
        sev[r.category].append(r.severity_score)
    return sorted([
        {"category": c, "label": CATEGORIES.get(c, {}).get("label", c), "total": n, "open": open_.get(c, 0),
         "mean_severity": round(statistics.mean(sev[c]), 2)}
        for c, n in total.items()
    ], key=lambda x: -x["total"])


@router.get("/resolution")
def resolution(db: Session = Depends(get_db)) -> dict:
    per: dict[str, list[float]] = defaultdict(list)
    for i in db.scalars(select(Issue).where(Issue.resolved_at.is_not(None), Issue.deleted_at.is_(None))):
        per[i.report.category].append((_aware(i.resolved_at) - _aware(i.report.reported_at)).total_seconds() / 3600)
    allh = [h for v in per.values() for h in v]
    return {
        "overall_median_hours": round(statistics.median(allh), 1) if allh else None,
        "overall_p90_hours": round(sorted(allh)[int(0.9 * (len(allh) - 1))], 1) if allh else None,
        "by_category": sorted([
            {"category": c, "label": CATEGORIES.get(c, {}).get("label", c), "count": len(v),
             "median_hours": round(statistics.median(v), 1)}
            for c, v in per.items()
        ], key=lambda x: x["median_hours"]),
    }


@router.get("/heat")
def heat(db: Session = Depends(get_db)) -> dict:
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [r.lng, r.lat]},
              "properties": {"weight": round(r.severity_score * (0.5 + 0.5 * r.confidence_score), 3)}}
             for r in _reports(db) if r.status == "open"]
    return {"type": "FeatureCollection", "features": feats}


@router.get("/coverage")
def coverage(db: Session = Depends(get_db)) -> dict:
    """Grid cells (~250 m) over the walkable network, scored by how much accessibility
    data exists. Cells with paths but no data are where we need contributors."""
    a = SERVICE_AREA
    dlat, dlng = 0.00225, 0.003
    counts: dict[tuple[int, int], dict] = defaultdict(lambda: {"paths": 0, "reports": 0, "places_known": 0})

    def key(lat: float, lng: float) -> tuple[int, int]:
        return int((lat - a["min_lat"]) // dlat), int((lng - a["min_lng"]) // dlng)

    for lng, lat in load_graph(db).nodes.values():
        counts[key(lat, lng)]["paths"] += 1
    since = datetime.now(UTC) - timedelta(days=180)
    for r in _reports(db, since):
        counts[key(r.lat, r.lng)]["reports"] += 1
    for p in db.scalars(select(Place)):
        if p.verification_status != "unverified":
            counts[key(p.lat, p.lng)]["places_known"] += 1

    feats = []
    gaps = 0
    for (i, j), c in counts.items():
        if c["paths"] < 3:
            continue
        data_points = c["reports"] + c["places_known"]
        level = "none" if data_points == 0 else ("low" if data_points < 3 else "good")
        gaps += level == "none"
        lat0, lng0 = a["min_lat"] + i * dlat, a["min_lng"] + j * dlng
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [[
                [lng0, lat0], [lng0 + dlng, lat0], [lng0 + dlng, lat0 + dlat], [lng0, lat0 + dlat], [lng0, lat0]]]},
            "properties": {**c, "data_points": data_points, "level": level},
        })
    return {"type": "FeatureCollection", "features": feats,
            "summary": {"cells": len(feats), "cells_without_data": gaps}}


@router.get("/hotspots", response_model=list[HotspotOut])
def hotspots(db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Hotspot).order_by(Hotspot.severity_index.desc())))
    if not rows:
        rows = recalculate_hotspots(db)
    out = []
    for h in rows:
        o = HotspotOut.model_validate(h)
        o.label = hotspot_label(db, h)
        out.append(o)
    return out


@router.post("/hotspots/recalculate", response_model=list[HotspotOut])
def recalc(_: User = Depends(manager_only), db: Session = Depends(get_db)):
    out = []
    for h in recalculate_hotspots(db):
        o = HotspotOut.model_validate(h)
        o.label = hotspot_label(db, h)
        out.append(o)
    return out
