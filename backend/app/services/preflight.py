"""Preflight brief: one Good / Caution / Blocked status for a place, before someone sets out.

Rules only. No model is involved, and anyone can check the status by hand:
- Blocked: an open report that blocks a wheelchair user (the router's rule), or a critical feature
  (step-free entrance, ramp, elevator) recorded as out of service.
- Caution: any other open report, a critical feature that is limited or unknown, or no critical
  feature recorded at all.
- Good: no open reports, and the recorded critical features are available.

Each reason starts with the tag of the record it comes from ([P1] the place, [R1], [R2] ... the open
reports), and each tag is listed in sources with a link to that record."""

import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.taxonomy import subcategory_info
from app.models import Place, Report
from app.schemas import PreflightSource

CRITICAL_FEATURES = {
    "step_free_entrance": "Step-free entrance",
    "ramp": "Ramp",
    "elevator": "Elevator",
}
MIN_BLOCK_SEVERITY = 0.75  # same thresholds as the router's wheelchair barrier rule
MIN_BLOCK_CONFIDENCE = 0.35
LABEL = {"good": "Good", "caution": "Caution", "blocked": "Blocked"}


@dataclass
class Brief:
    place: Place
    status: str
    reasons: list[str]
    sources: list[PreflightSource] = field(default_factory=list)

    @property
    def label(self) -> str:
        return LABEL[self.status]


def _tagged(tag: str | None, text: str) -> str:
    return f"[{tag}] {text}" if tag else text


def build_brief(db: Session, place: Place) -> Brief:
    open_reports = db.scalars(select(Report).where(
        Report.place_id == place.id, Report.status == "open", Report.deleted_at.is_(None),
        Report.duplicate_of.is_(None)).order_by(Report.reported_at.desc())).all()
    report_tags = {r.id: f"R{i}" for i, r in enumerate(open_reports, start=1)}
    features = {f.feature_type: f for f in place.features}
    unavailable = [k for k in CRITICAL_FEATURES if k in features and features[k].status == "unavailable"]
    weak = [k for k in CRITICAL_FEATURES if k in features and features[k].status in ("limited", "unknown")]
    known = [k for k in CRITICAL_FEATURES if k in features and features[k].status in ("available", "limited", "unavailable")]

    blocking = [r for r in open_reports if subcategory_info(r.category, r.subcategory)["blocks_wheelchair"]
                and r.severity_score >= MIN_BLOCK_SEVERITY and r.confidence_score >= MIN_BLOCK_CONFIDENCE]
    if blocking or unavailable:
        status = "blocked"
    elif open_reports or weak or not known:
        status = "caution"
    else:
        status = "good"

    place_tag = "P1"
    reasons: list[str] = []
    for r in blocking:
        label = subcategory_info(r.category, r.subcategory)["label"]
        reasons.append(_tagged(report_tags[r.id],
                               f"Open report: {label}, severity {r.severity_score:.2f}. It blocks a wheelchair user."))
    for k in unavailable:
        reasons.append(_tagged(place_tag, f"{CRITICAL_FEATURES[k]} is recorded as out of service."))
    for r in open_reports:
        if r in blocking:
            continue
        label = subcategory_info(r.category, r.subcategory)["label"]
        reasons.append(_tagged(report_tags[r.id], f"Open report: {label}."))
    for k in weak:
        reasons.append(_tagged(place_tag, f"{CRITICAL_FEATURES[k]} is recorded as limited or unknown."))
    if not known:
        reasons.append(_tagged(place_tag, "No step-free entrance, ramp or elevator is recorded for this place."))
    if status == "good":
        reasons.append(_tagged(place_tag, "No open reports, and the recorded entrance, ramp and elevator are available."))

    sources = [PreflightSource(tag=place_tag, kind="place", label=place.name[:190], url=f"/places/{place.id}")]
    for r in open_reports:
        label = subcategory_info(r.category, r.subcategory)["label"]
        sources.append(PreflightSource(tag=report_tags[r.id], kind="report", label=label[:190],
                                       url=f"/reports/{r.id}"))
    return Brief(place=place, status=status, reasons=reasons, sources=sources)


def rules_summary(brief: Brief) -> str:
    """Status first, then the first reasons, with their tags so they can be checked on the place page."""
    shown = " ".join(brief.reasons[:3]) if brief.reasons else "No details are recorded."
    return f"{brief.label}. {shown}"


def screen_reader_text(brief: Brief) -> str:
    """The same status for a screen reader: no bracketed tags, and the place name first."""
    plain = " ".join(re.sub(r"^\[[A-Z]\d+\]\s*", "", r) for r in brief.reasons[:3]) or "No details are recorded."
    return f"{brief.place.name}. Preflight status: {brief.label}. {plain}"
