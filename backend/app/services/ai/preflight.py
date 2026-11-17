"""Preflight brief (AI-5): one Good / Caution / Blocked status for a place, before someone sets out.

The status comes from rules that anyone can check by hand:
- Blocked: an open report that blocks a wheelchair user (same rule the router uses), or a critical
  feature (step-free entrance, ramp, elevator) recorded as out of service.
- Caution: any other open report, a critical feature that is limited or unknown, or no critical
  feature recorded at all.
- Good: no open reports, and the recorded critical features are available.

Every reason carries the tag of the record it comes from, so the reasons can be checked against the
place page. The AI, when asked, writes a short summary of these same facts. It sees only the
context built for the place and must cite its tags. If no cloud model answers, the rule-based
summary is returned and labelled that way."""

import logging
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.taxonomy import subcategory_info
from app.models import Place, Report
from app.schemas import ChatContext, Citation
from app.services.ai.chat import ChatUnavailableError, ContextBundle, build_context, generate, select_sources
from app.services.ai.providers import Provider

log = logging.getLogger("app.services.ai.preflight")

CRITICAL_FEATURES = {
    "step_free_entrance": "Step-free entrance",
    "ramp": "Ramp",
    "elevator": "Elevator",
}
MIN_BLOCK_SEVERITY = 0.75  # same thresholds as routing's wheelchair barrier rule
MIN_BLOCK_CONFIDENCE = 0.35
LABEL = {"good": "Good", "caution": "Caution", "blocked": "Blocked"}
RULES_NOTE = "Rule-based summary. No cloud AI model answered."
PROMPT = ("Write a preflight summary for this place in two or three short, plain sentences. The status is {label}. "
          "Use only facts from CONTEXT, cite their tags in square brackets, and do not add advice or guesses.")


@dataclass
class Brief:
    place: Place
    status: str
    reasons: list[str]  # each starts with its tag in brackets when one exists, e.g. "[R1] Open report: ..."
    sources: list[Citation]
    bundle: ContextBundle  # kept for the AI summary

    @property
    def label(self) -> str:
        return LABEL[self.status]


def _tagged(tag: str | None, text: str) -> str:
    return f"[{tag}] {text}" if tag else text


def build_brief(db: Session, place: Place) -> Brief:
    bundle = build_context(db, ChatContext(kind="place", id=place.id))
    tag_by_url = {c.url: c.tag for c in bundle.sources}
    place_tag = next((c.tag for c in bundle.sources if c.kind == "place"), None)
    open_reports = db.scalars(select(Report).where(
        Report.place_id == place.id, Report.status == "open", Report.deleted_at.is_(None),
        Report.duplicate_of.is_(None)).order_by(Report.reported_at.desc())).all()
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

    reasons: list[str] = []
    for r in blocking:
        label = subcategory_info(r.category, r.subcategory)["label"]
        reasons.append(_tagged(tag_by_url.get(f"/reports/{r.id}"),
                               f"Open report: {label}, severity {r.severity_score:.2f}. It blocks a wheelchair user."))
    for k in unavailable:
        reasons.append(_tagged(place_tag, f"{CRITICAL_FEATURES[k]} is recorded as out of service."))
    for r in open_reports:
        if r in blocking:
            continue
        label = subcategory_info(r.category, r.subcategory)["label"]
        reasons.append(_tagged(tag_by_url.get(f"/reports/{r.id}"), f"Open report: {label}."))
    for k in weak:
        reasons.append(_tagged(place_tag, f"{CRITICAL_FEATURES[k]} is recorded as limited or unknown."))
    if not known:
        reasons.append(_tagged(place_tag, "No step-free entrance, ramp or elevator is recorded for this place."))
    if status == "good":
        reasons.append(_tagged(place_tag, "No open reports, and the recorded entrance, ramp and elevator are available."))
    return Brief(place=place, status=status, reasons=reasons, sources=bundle.sources, bundle=bundle)


def rules_summary(brief: Brief) -> str:
    """The plain-text summary from the rules. Tags are kept so it can be checked on the place page."""
    shown = " ".join(brief.reasons[:3]) if brief.reasons else "No details are recorded."
    return f"{brief.label}. {shown}"


def screen_reader_text(brief: Brief) -> str:
    """The same status for a screen reader: no bracketed tags, and the place name first."""
    plain = " ".join(re.sub(r"^\[[A-Z]\d+\]\s*", "", r) for r in brief.reasons[:3]) or "No details are recorded."
    return f"{brief.place.name}. Preflight status: {brief.label}. {plain}"


def ai_summary(db: Session, brief: Brief, byok: Provider | None, language: str | None = None) -> tuple[str, str, str | None, list[Citation]]:
    """Returns (summary, source, model, sources). Falls back to the rules when no cloud tier answers."""
    try:
        reply = generate([{"role": "user", "content": PROMPT.format(label=brief.label)}], brief.bundle,
                         byok, language=language)
    except ChatUnavailableError:
        return rules_summary(brief), "rules", None, brief.sources
    return reply.answer, reply.source, reply.model, select_sources(reply.answer, brief.bundle)
