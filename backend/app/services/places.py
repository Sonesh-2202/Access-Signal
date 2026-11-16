"""Place accessibility profiles: seeded from OSM tags, then enriched and overridden
by community reports and manager resolutions."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.taxonomy import PLACE_FEATURES, SUBCATEGORY_TO_FEATURE
from app.models import Place, PlaceAccessibility, Report
from app.utils.geo import bbox_around, haversine_m

LINK_RADIUS_M = 40.0
FRESH_DAYS = 120


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def features_from_osm(tags: dict) -> dict[str, tuple[str, str]]:
    """feature_type -> (status, note)"""
    out: dict[str, tuple[str, str]] = {}
    wc = tags.get("wheelchair")
    if wc == "yes":
        out["step_free_entrance"] = ("available", "OSM: wheelchair=yes")
    elif wc == "limited":
        out["step_free_entrance"] = ("limited", "OSM: wheelchair=limited")
    elif wc == "no":
        out["step_free_entrance"] = ("unavailable", "OSM: wheelchair=no")
    tw = tags.get("toilets:wheelchair")
    if tw in ("yes", "no", "limited"):
        out["accessible_restroom"] = ({"yes": "available", "no": "unavailable"}.get(tw, "limited"),
                                      f"OSM: toilets:wheelchair={tw}")
    for key in ("ramp:wheelchair", "ramp"):
        if tags.get(key) in ("yes", "no"):
            out["ramp"] = ("available" if tags[key] == "yes" else "unavailable", f"OSM: {key}={tags[key]}")
            break
    if tags.get("elevator") in ("yes", "no"):
        out["elevator"] = ("available" if tags["elevator"] == "yes" else "unavailable", f"OSM: elevator={tags['elevator']}")
    if tags.get("entrance:automatic_door") == "yes" or tags.get("automatic_door") == "yes":
        out["automatic_door"] = ("available", "OSM: automatic door")
    if tags.get("tactile_paving") in ("yes", "no"):
        out["tactile_paving"] = ("available" if tags["tactile_paving"] == "yes" else "unavailable", "OSM tag")
    if tags.get("hearing_loop") in ("yes", "no"):
        out["hearing_loop"] = ("available" if tags["hearing_loop"] == "yes" else "unavailable", "OSM tag")
    return out


def init_osm_features(place: Place) -> None:
    for ftype, (status, note) in features_from_osm(place.osm_tags or {}).items():
        place.features.append(PlaceAccessibility(feature_type=ftype, status=status, source="osm",
                                                 confidence=0.55, notes=note))


def nearest_place(db: Session, lat: float, lng: float, radius_m: float = LINK_RADIUS_M) -> Place | None:
    min_lat, min_lng, max_lat, max_lng = bbox_around(lat, lng, radius_m)
    rows = db.scalars(select(Place).where(Place.lat.between(min_lat, max_lat), Place.lng.between(min_lng, max_lng))).all()
    rows = [p for p in rows if haversine_m(lat, lng, p.lat, p.lng) <= radius_m]
    return min(rows, key=lambda p: haversine_m(lat, lng, p.lat, p.lng)) if rows else None


def apply_report(db: Session, place: Place, report: Report) -> None:
    """Update the feature the report speaks to. Open reports mark a feature unavailable or
    limited; a resolved report restores it, pending community reverification."""
    mapping = SUBCATEGORY_TO_FEATURE.get(report.subcategory)
    if not mapping:
        return
    ftype, implied = mapping
    feat = next((f for f in place.features if f.feature_type == ftype), None)
    if feat is None:
        feat = PlaceAccessibility(feature_type=ftype, status="unknown")
        place.features.append(feat)
    now = datetime.now(UTC)
    if report.status == "resolved":
        feat.status = "available"
        feat.source = "manager"
        feat.confidence = 0.6
        feat.notes = "Repair reported as complete. Awaiting community reverification."
    elif report.status == "open":
        # Don't let a low-confidence report override a recent high-confidence assessment.
        if feat.source == "report" and feat.confidence > report.confidence_score and feat.status == implied:
            return
        feat.status = implied
        feat.source = "report"
        feat.confidence = max(0.3, report.confidence_score)
        feat.notes = (report.ai_analysis or {}).get("summary") or report.description[:200] or None
    else:
        return
    feat.source_report_id = report.id
    feat.assessed_at = now
    recompute_verification(place)


def recompute_verification(place: Place) -> None:
    now = datetime.now(UTC)
    known = [f for f in place.features if f.status != "unknown"]
    fresh = [f for f in known if (_aware(f.assessed_at) or now) >= now - timedelta(days=FRESH_DAYS)]
    osm_ok = {f.feature_type for f in place.features if f.source == "osm" and f.status == "available"}
    contradicted = any(f.source == "report" and f.status != "available" and f.feature_type in osm_ok for f in known)
    if not known:
        status = "unverified"
    elif contradicted or any(f.source == "report" and f.status == "unavailable" for f in known):
        status = "disputed"
    elif fresh and all(f.confidence >= 0.6 for f in fresh) and len(fresh) >= 2:
        status = "verified"
    else:
        status = "partially_verified"
    place.verification_status = status
    stamps = [_aware(f.assessed_at) for f in known if f.source != "osm"]
    place.last_verified = max(stamps) if stamps else place.last_verified
    place.accessibility_profile = {
        f.feature_type: {"status": f.status, "confidence": round(f.confidence, 2), "source": f.source}
        for f in place.features
    }


def feature_label(ftype: str) -> str:
    return PLACE_FEATURES.get(ftype, ftype.replace("_", " ").capitalize())
