"""Duplicate detection: a candidate must be close in space and time; the score then
blends proximity, category agreement and description similarity."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Report
from app.services.intelligence.text import cosine_similarity
from app.utils.geo import bbox_around, haversine_m

RADIUS_M = 50.0
WINDOW_DAYS = 30
THRESHOLD = 0.5

W_PROXIMITY, W_CATEGORY, W_TEXT = 0.4, 0.4, 0.2


@dataclass
class Candidate:
    report: Report
    distance_m: float
    text_similarity: float
    category_match: bool
    score: float


def score_pair(distance_m: float, same_category: bool, same_subcategory: bool, text_sim: float,
               radius_m: float = RADIUS_M) -> float:
    proximity = max(0.0, 1.0 - distance_m / radius_m)
    category = 1.0 if same_subcategory else (0.5 if same_category else 0.0)
    return round(W_PROXIMITY * proximity + W_CATEGORY * category + W_TEXT * text_sim, 3)


def find_duplicates(
    db: Session,
    lat: float,
    lng: float,
    category: str,
    subcategory: str,
    description: str,
    exclude_id: str | None = None,
    radius_m: float = RADIUS_M,
    now: datetime | None = None,
) -> list[Candidate]:
    now = now or datetime.now(UTC)
    min_lat, min_lng, max_lat, max_lng = bbox_around(lat, lng, radius_m)
    q = select(Report).where(
        Report.deleted_at.is_(None),
        Report.status.in_(("open",)),
        Report.duplicate_of.is_(None),
        Report.lat.between(min_lat, max_lat),
        Report.lng.between(min_lng, max_lng),
        Report.reported_at >= now - timedelta(days=WINDOW_DAYS),
    )
    out: list[Candidate] = []
    for r in db.scalars(q):
        if r.id == exclude_id:
            continue
        d = haversine_m(lat, lng, r.lat, r.lng)
        if d > radius_m:
            continue
        sim = cosine_similarity(description, r.description or "")
        same_cat = r.category == category
        same_sub = same_cat and r.subcategory == subcategory
        s = score_pair(d, same_cat, same_sub, sim, radius_m)
        if s >= THRESHOLD:
            out.append(Candidate(r, round(d, 1), round(sim, 3), same_cat, s))
    out.sort(key=lambda c: c.score, reverse=True)
    return out[:5]
