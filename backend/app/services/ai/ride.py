"""Accessible ride handoff (AI-3).

When no step-free route exists, the app offers a wheelchair-accessible ride. Two parts:
- A curated list (app/data/accessible_rides.json). Entries are validated on load, and an
  invalid entry is skipped with a log line. Only tel: and https links are ever rendered.
- A dispatcher message draft. A fixed template is always available. A cloud model can
  write a version when asked, but its text must contain the pickup, drop-off and wheelchair
  facts, or the template is used instead.

Nothing here books a ride, calls a ride-hailing API or writes to the database. The draft is
a preview that a person copies or has read aloud."""

import json
import logging
import re
from pathlib import Path

import httpx
from pydantic import ValidationError

from app.core.config import get_settings
from app.schemas import DispatcherDraft, RideOption
from app.services.ai.providers import Provider, ProviderError, strip_reasoning

log = logging.getLogger("app.services.ai.ride")

RIDE_DATA = Path(__file__).resolve().parents[2] / "data" / "accessible_rides.json"
LABEL = "Draft for you to review before sending. Nothing is sent or booked."
MAX_DRAFT_CHARS = 700


def load_rides(path: Path = RIDE_DATA) -> list[RideOption]:
    """The curated list. A missing or unreadable file gives an empty list, not an error."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except (OSError, ValueError):
        log.warning("Accessible ride list could not be read; showing none.")
        return []
    items = raw.get("rides", []) if isinstance(raw, dict) else []
    out: list[RideOption] = []
    for item in items:
        try:
            ride = RideOption.model_validate(item)
        except ValidationError:
            log.warning("Skipping an accessible ride entry that failed validation.")
            continue
        if ride.url and not ride.url.startswith("https://"):
            log.warning("Skipping ride %s: links must be https.", ride.id)
            continue
        if not (ride.phone or ride.url):
            continue
        if ride.phone:
            ride = ride.model_copy(update={"tel": "+1" + re.sub(r"\D", "", ride.phone)})
        out.append(ride)
    return out


def template_draft(pickup: str, dropoff: str, barrier: str, passengers: int, note: str | None = None) -> DispatcherDraft:
    text = (
        "Accessible ride request.\n"
        f"Pickup: {pickup}.\n"
        f"Drop-off: {dropoff}.\n"
        f"Passengers: {passengers}. A passenger uses a wheelchair and needs a ramp or lift at pickup and drop-off.\n"
        f"Reason: the walking route has a barrier, {barrier}.\n"
        "Please confirm the vehicle and the pickup time. Thank you."
    )
    return DispatcherDraft(text=text, source="template", label=LABEL, note=note)


def _facts_present(text: str, pickup: str, dropoff: str) -> bool:
    lower = text.lower()
    return (pickup.lower() in lower and dropoff.lower() in lower and "wheelchair" in lower
            and ("ramp" in lower or "lift" in lower) and len(text) <= MAX_DRAFT_CHARS)


def _ai_text(provider: Provider, pickup: str, dropoff: str, barrier: str, passengers: int) -> str:
    s = get_settings()
    messages = [
        {"role": "system", "content": (
            "You write a short request to an accessible taxi or paratransit dispatcher. Plain text, under 90 words, "
            "no greeting or sign-off beyond thanks. Use only the facts given. Do not add addresses, names or "
            "phone numbers. Mention that a wheelchair user needs a ramp or lift. Reply with the message only.")},
        {"role": "user", "content": (
            f"Pickup: {pickup}\nDrop-off: {dropoff}\nBarrier on the walking route: {barrier}\n"
            f"Passengers: {passengers}")},
    ]
    return strip_reasoning(provider.chat_text(messages, max_tokens=s.chat_max_tokens, temperature=0.2)).strip()


def draft_message(pickup: str, dropoff: str, barrier: str, passengers: int, use_ai: bool,
                  byok: Provider | None = None) -> DispatcherDraft:
    """A preview of a dispatcher message. AI is used only when asked and a tier is available,
    and only if its text keeps the pickup, drop-off and wheelchair facts."""
    if not use_ai:
        return template_draft(pickup, dropoff, barrier, passengers)
    from app.services.ai.chat import _tiers  # local import: chat imports the router, keep ride light

    tiers = _tiers(byok)
    if not tiers:
        return template_draft(pickup, dropoff, barrier, passengers,
                              note="No cloud AI is available, so the standard template was used.")
    for p in tiers:
        try:
            text = _ai_text(p, pickup, dropoff, barrier, passengers)
        except (ProviderError, httpx.HTTPError) as e:
            log.warning("Ride draft via %s failed: %s", p.label, type(e).__name__)
            continue
        if _facts_present(text, pickup, dropoff):
            return DispatcherDraft(text=text, source="ai", model=p.model, label=LABEL)
        log.warning("Ride draft from %s left out required facts; using the template.", p.label)
        break
    return template_draft(pickup, dropoff, barrier, passengers,
                          note="The AI draft did not include every required fact, so the standard template was used.")
