from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.serializers import place_detail, place_summary
from app.core.database import get_db
from app.models import Place, Report
from app.schemas import PlaceDetail, PlaceSummary, PreflightOut
from app.services.preflight import build_brief, rules_summary, screen_reader_text

router = APIRouter(prefix="/api/places", tags=["places"])


def _open_counts(db: Session, ids: list[str]) -> dict[str, int]:
    if not ids:
        return {}
    rows = db.execute(select(Report.place_id, func.count()).where(
        Report.place_id.in_(ids), Report.status == "open", Report.deleted_at.is_(None),
        Report.duplicate_of.is_(None)).group_by(Report.place_id)).all()
    return dict(rows)


@router.get("", response_model=list[PlaceSummary])
def list_places(
    q: str | None = Query(default=None, max_length=100),
    place_type: list[str] | None = Query(default=None, alias="type"),
    verification: list[str] | None = Query(default=None),
    feature: str | None = Query(default=None, description="only places where this feature is available"),
    bbox: str | None = None,
    with_issues: bool = False,
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    stmt = select(Place).options(selectinload(Place.features))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Place.name.ilike(like), Place.address.ilike(like)))
    if place_type:
        stmt = stmt.where(Place.place_type.in_(place_type))
    if verification:
        stmt = stmt.where(Place.verification_status.in_(verification))
    if bbox:
        try:
            a, b, c, d = (float(x) for x in bbox.split(","))
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "bbox must be minLng,minLat,maxLng,maxLat") from None
        stmt = stmt.where(Place.lng.between(a, c), Place.lat.between(b, d))
    # Places with community data first, then alphabetical.
    order = {"verified": 0, "disputed": 1, "partially_verified": 2, "unverified": 3}
    rows = db.scalars(stmt.limit(2000)).all()
    if feature:
        rows = [p for p in rows if any(f.feature_type == feature and f.status == "available" for f in p.features)]
    counts = _open_counts(db, [p.id for p in rows])
    if with_issues:
        rows = [p for p in rows if counts.get(p.id)]
    rows.sort(key=lambda p: (order.get(p.verification_status, 4), -counts.get(p.id, 0), p.name))
    return [place_summary(p, counts.get(p.id, 0)) for p in rows[:limit]]


@router.get("/types")
def place_types(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(Place.place_type, func.count()).group_by(Place.place_type)
                      .order_by(func.count().desc())).all()
    return [{"type": t, "count": c} for t, c in rows]


@router.get("/{place_id}", response_model=PlaceDetail)
def get_place(place_id: str, db: Session = Depends(get_db)):
    p = db.get(Place, place_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Place not found")
    return place_detail(db, p)


def _place_or_404(db: Session, place_id: str) -> Place:
    p = db.get(Place, place_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Place not found")
    return p


@router.get("/{place_id}/preflight", response_model=PreflightOut)
def preflight(place_id: str, db: Session = Depends(get_db)) -> PreflightOut:
    """The Good / Caution / Blocked status and its reasons, from rules only. Public, free and read-only."""
    brief = build_brief(db, _place_or_404(db, place_id))
    return PreflightOut(place_id=brief.place.id, place_name=brief.place.name, status=brief.status,
                        status_label=brief.label, reasons=brief.reasons, summary=rules_summary(brief),
                        sources=brief.sources, screen_reader=screen_reader_text(brief))
