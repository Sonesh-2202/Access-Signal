from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import current_user, optional_user
from app.api.serializers import report_detail, report_summary
from app.core.database import get_db
from app.domain.taxonomy import is_valid_category, subcategory_info
from app.models import Evidence, IssueHistory, Place, Report, User
from app.schemas import (
    Classification,
    ClassifyIn,
    DuplicateCandidate,
    DuplicateCheckIn,
    ReportCreate,
    ReportDetail,
    ReportPage,
)
from app.services import issues as issue_service
from app.services import places as place_service
from app.services.ai.classifier import ImageInput, classify
from app.services.intelligence.confidence import refresh_confidence
from app.services.intelligence.duplicates import find_duplicates
from app.services.storage import get_storage
from app.utils.geo import bbox_around, haversine_m, in_service_area

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    if not bbox:
        return None
    try:
        min_lng, min_lat, max_lng, max_lat = (float(x) for x in bbox.split(","))
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "bbox must be minLng,minLat,maxLng,maxLat") from None
    return min_lng, min_lat, max_lng, max_lat


def _base_query():
    return (select(Report).where(Report.deleted_at.is_(None))
            .options(selectinload(Report.evidence), selectinload(Report.issue)))


def _owned_unattached_evidence(db: Session, ids: list[str], user: User) -> list[Evidence]:
    if not ids:
        return []
    rows = db.scalars(select(Evidence).where(Evidence.id.in_(ids))).all()
    valid = [e for e in rows if e.report_id is None and (e.meta or {}).get("uploader_id") == user.id]
    if len(valid) != len(set(ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "One or more evidence files are missing or already used")
    return valid


@router.post("/classify", response_model=Classification)
def classify_report(body: ClassifyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    evidence = _owned_unattached_evidence(db, body.evidence_ids, user)
    storage = get_storage()
    images = [ImageInput(storage.read(e.file_path), e.mime_type) for e in evidence if e.type == "photo"]
    transcripts = " ".join(e.transcription for e in evidence if e.transcription)
    text = " ".join(filter(None, [body.description, transcripts]))
    if not text.strip() and not images:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add a description, voice note or photo first")
    try:
        return classify(text, images)
    except RuntimeError as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from None


@router.post("/duplicates", response_model=list[DuplicateCandidate])
def check_duplicates(body: DuplicateCheckIn, db: Session = Depends(get_db)):
    found = find_duplicates(db, body.lat, body.lng, body.category, body.subcategory, body.description)
    return [DuplicateCandidate(report=report_summary(c.report), distance_m=c.distance_m,
                               text_similarity=c.text_similarity, category_match=c.category_match, score=c.score)
            for c in found]


@router.post("", response_model=ReportDetail, status_code=status.HTTP_201_CREATED)
def create_report(body: ReportCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not is_valid_category(body.category, body.subcategory):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown category or subcategory")
    if not in_service_area(body.lat, body.lng):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "AccessSignal currently covers Midtown and Lower Manhattan only")
    evidence = _owned_unattached_evidence(db, body.evidence_ids, user)
    if not body.description.strip() and not evidence:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Describe the barrier or attach evidence")

    base = subcategory_info(body.category, body.subcategory)["severity"]
    ai = body.ai_analysis
    if ai and body.user_confirmed and ai.subcategory == body.subcategory:
        severity = round(0.5 * base + 0.5 * ai.severity, 2)
    else:
        severity = base

    place = db.get(Place, body.place_id) if body.place_id else place_service.nearest_place(db, body.lat, body.lng)

    original = None
    if body.duplicate_of:
        original = db.get(Report, body.duplicate_of)
        if original is None or original.deleted_at is not None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "The report you matched no longer exists")

    report = Report(
        user_id=user.id, place_id=place.id if place else None, lat=body.lat, lng=body.lng,
        address=body.address, category=body.category, subcategory=body.subcategory,
        description=body.description.strip(), severity_score=severity,
        ai_analysis=ai.model_dump() if ai else None, user_confirmed=body.user_confirmed,
        status="duplicate" if original else "open", duplicate_of=original.id if original else None,
    )
    db.add(report)
    db.flush()
    for e in evidence:
        e.report_id = report.id
    db.flush()
    db.refresh(report)
    refresh_confidence(db, report)

    if original:
        refresh_confidence(db, original)
        if original.issue:
            original.issue.history.append(IssueHistory(changed_by=user.id, old_status=original.issue.status,
                                                       new_status=original.issue.status,
                                                       notes="Corroborated by a new community report"))
    else:
        issue_service.open_issue_for(db, report, user)
        if place:
            place_service.apply_report(db, place, report)
    db.commit()
    db.refresh(report)
    return report_detail(db, report)


@router.get("", response_model=ReportPage)
def list_reports(
    bbox: str | None = Query(default=None, description="minLng,minLat,maxLng,maxLat"),
    category: list[str] | None = Query(default=None),
    status_: list[str] | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=100),
    sort: str = Query(default="recent", pattern="^(recent|severity|confidence)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    stmt = _base_query()
    box = _parse_bbox(bbox)
    if box:
        stmt = stmt.where(Report.lng.between(box[0], box[2]), Report.lat.between(box[1], box[3]))
    if category:
        stmt = stmt.where(Report.category.in_(category))
    stmt = stmt.where(Report.status.in_(status_)) if status_ else stmt.where(Report.status != "duplicate")
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Report.description.ilike(like), Report.address.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {"recent": Report.reported_at.desc(), "severity": Report.severity_score.desc(),
             "confidence": Report.confidence_score.desc()}[sort]
    rows = db.scalars(stmt.order_by(order, Report.id).offset(offset).limit(limit)).all()
    nxt = offset + limit if offset + limit < total else None
    return ReportPage(items=[report_summary(r) for r in rows], total=total, next_offset=nxt)


@router.get("/geojson")
def reports_geojson(
    bbox: str | None = None,
    category: list[str] | None = Query(default=None),
    include_resolved: bool = False,
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(Report).where(Report.deleted_at.is_(None), Report.duplicate_of.is_(None))
    stmt = stmt.where(Report.status.in_(("open", "resolved") if include_resolved else ("open",)))
    box = _parse_bbox(bbox)
    if box:
        stmt = stmt.where(Report.lng.between(box[0], box[2]), Report.lat.between(box[1], box[3]))
    if category:
        stmt = stmt.where(Report.category.in_(category))
    features = [{
        "type": "Feature",
        "id": r.id,
        "geometry": {"type": "Point", "coordinates": [r.lng, r.lat]},
        "properties": {"id": r.id, "category": r.category, "subcategory": r.subcategory,
                       "label": subcategory_info(r.category, r.subcategory)["label"],
                       "status": r.status, "severity": r.severity_score, "confidence": r.confidence_score,
                       "address": r.address, "reported_at": r.reported_at.isoformat()},
    } for r in db.scalars(stmt.limit(2000))]
    return {"type": "FeatureCollection", "features": features}


@router.get("/nearby", response_model=list[dict])
def nearby(lat: float, lng: float, radius: float = Query(default=200, le=2000), db: Session = Depends(get_db)):
    min_lat, min_lng, max_lat, max_lng = bbox_around(lat, lng, radius)
    rows = db.scalars(_base_query().where(Report.status == "open", Report.lat.between(min_lat, max_lat),
                                          Report.lng.between(min_lng, max_lng))).all()
    out = []
    for r in rows:
        d = haversine_m(lat, lng, r.lat, r.lng)
        if d <= radius:
            out.append({"distance_m": round(d, 1), "report": report_summary(r).model_dump(mode="json")})
    return sorted(out, key=lambda x: x["distance_m"])


@router.get("/{report_id}", response_model=ReportDetail)
def get_report(report_id: str, db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if r is None or r.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    return report_detail(db, r)


class VerifyIn(BaseModel):
    still_present: bool
    note: str | None = Field(default=None, max_length=500)


@router.post("/{report_id}/verify", response_model=ReportDetail)
def verify_report(report_id: str, body: VerifyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Community check-in: 'I was there and the barrier is / isn't still present'."""
    r = db.get(Report, report_id)
    if r is None or r.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    note = (body.note or "").strip()
    issue = r.issue
    if body.still_present:
        if r.user_id != user.id:
            db.add(Report(user_id=user.id, place_id=r.place_id, lat=r.lat, lng=r.lng, address=r.address,
                          category=r.category, subcategory=r.subcategory, severity_score=r.severity_score,
                          description=note or "Confirmed still present", status="duplicate",
                          duplicate_of=r.id, user_confirmed=True))
            db.flush()
        if issue and issue.status == "resolved":
            issue_service.transition(db, issue, "reverification", user, notes=f"Community: still present. {note}".strip())
        elif issue:
            issue.history.append(IssueHistory(changed_by=user.id, old_status=issue.status, new_status=issue.status,
                                              notes=f"Community confirmed still present. {note}".strip()))
    elif issue:
        issue.history.append(IssueHistory(changed_by=user.id, old_status=issue.status, new_status=issue.status,
                                          notes=f"Community reports barrier cleared. {note}".strip()))
    db.flush()
    refresh_confidence(db, r)
    db.commit()
    return report_detail(db, r)


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(report_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if r is None or r.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    if r.user_id != user.id and user.role not in ("admin", "infrastructure_manager"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only remove your own reports")
    now = datetime.now(UTC)
    r.deleted_at = now
    if r.issue:
        r.issue.deleted_at = now
    db.commit()
