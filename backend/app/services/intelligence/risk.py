"""Corridor risk for reliable routing (AI-2). Deterministic. No model is involved in the score.

For each walkable edge:
  density     = 1 - exp(-hotspots)           hotspots whose area reaches the edge (within 40 m)
  issues      = 1 - exp(-open_issues / 2)    open barrier reports snapped to the edge
  base        = 0.5 * density + 0.5 * issues
  confidence  = 0.5 + 0.5 * mean report confidence (0.5 when there are no reports)
  risk        = clamp(base * confidence * time_multiplier, 0, 1)

time_multiplier comes from when reports were filed. Over the reports in the database, it
compares the share filed within two hours (either side) of the current New York hour with
the share a uniform spread would give. It rises to 1.5 when that window is busiest. With
fewer than 30 reports it stays 1.0, because there is too little to learn from.

Risk is added to edge cost by costs.apply_risk, which keeps cost at or above length."""

import math
from collections import Counter
from collections.abc import Iterable
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Hotspot, Report

NYC = ZoneInfo("America/New_York")
HOTSPOT_BUFFER_M = 40.0
HIGH_RISK = 0.5
MIN_TIME_SAMPLES = 30
TIME_WINDOW_H = 2
MAX_TIME_LIFT = 0.5

FORMULA = (
    "Corridor risk is 0 to 1 for each street segment. It combines the hotspots that reach the segment and the open "
    "barrier reports on it, scaled by how confident those reports are, and by the time of day when reports cluster. "
    "Routes add a penalty for risk. The penalty never reduces the walking distance."
)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def time_multiplier(report_times: Iterable[datetime], now: datetime) -> float:
    """1.0 with too few reports. Otherwise up to 1.5 when reports cluster near the current hour."""
    times = [_aware(t).astimezone(NYC).hour for t in report_times]
    if len(times) < MIN_TIME_SAMPLES:
        return 1.0
    hour = _aware(now).astimezone(NYC).hour

    def near(h: int) -> bool:
        d = abs(h - hour) % 24
        return min(d, 24 - d) <= TIME_WINDOW_H

    share = sum(near(h) for h in times) / len(times)
    expected = (2 * TIME_WINDOW_H + 1) / 24
    lift = min(1.0, max(0.0, share / expected - 1))
    return 1 + MAX_TIME_LIFT * lift


def edge_risk(hotspots: int, open_issues: int, mean_confidence: float, multiplier: float) -> tuple[float, dict]:
    """The score for one edge and the numbers behind it, so the UI can show the breakdown."""
    density = 1 - math.exp(-hotspots)
    issues = 1 - math.exp(-open_issues / 2)
    base = 0.5 * density + 0.5 * issues
    conf = min(1.0, max(0.0, mean_confidence))
    factor = 0.5 + 0.5 * conf
    risk = min(1.0, max(0.0, base * factor * multiplier))
    breakdown = {
        "hotspots": hotspots,
        "open_issues": open_issues,
        "mean_confidence": round(conf, 2),
        "time_multiplier": round(multiplier, 3),
        "risk": round(risk, 3),
    }
    return round(risk, 3), breakdown


def corridor_risk(db: Session, graph, barriers: dict[str, list], now: datetime) -> dict[str, dict]:
    """Risk for every edge that has a hotspot or an open report. Edges with no risk are left out."""
    hits: Counter[str] = Counter()
    for h in db.scalars(select(Hotspot)).all():
        for eid, _d in graph.edges_near(h.lat, h.lng, h.radius_m + HOTSPOT_BUFFER_M):
            hits[eid] += 1
    times = db.scalars(select(Report.reported_at).where(Report.deleted_at.is_(None))).all()
    mult = time_multiplier(times, now)
    out: dict[str, dict] = {}
    for eid in set(hits) | set(barriers):
        bs = barriers.get(eid, [])
        mean_conf = sum(b.confidence for b in bs) / len(bs) if bs else 0.5
        risk, breakdown = edge_risk(hits.get(eid, 0), len(bs), mean_conf, mult)
        if risk > 0:
            out[eid] = {"risk": risk, "breakdown": breakdown}
    return out
