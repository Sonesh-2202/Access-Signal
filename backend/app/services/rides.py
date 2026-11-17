"""Accessible ride handoff (rules only).

When no step-free route exists, the app lists local wheelchair-accessible ride services and offers
a dispatcher message to review. Both come from fixed data and a fixed template. No AI is involved.

- The curated list (app/data/accessible_rides.json). Entries are validated on load; an invalid entry
  is skipped with a log line. Only tel: and https links are ever rendered.
- The message template. The app never books a ride, calls a ride-hailing API, or sends the message.
"""

import json
import logging
import re
from pathlib import Path

from pydantic import ValidationError

from app.schemas import DispatcherDraft, RideOption

log = logging.getLogger("app.services.rides")

RIDE_DATA = Path(__file__).resolve().parents[1] / "data" / "accessible_rides.json"
LABEL = "Draft for you to review before sending. Nothing is sent or booked."


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


def dispatcher_draft(pickup: str, dropoff: str, barrier: str, passengers: int) -> DispatcherDraft:
    """The fixed message. The person reviews it, then copies it or has it read aloud."""
    text = (
        "Accessible ride request.\n"
        f"Pickup: {pickup}.\n"
        f"Drop-off: {dropoff}.\n"
        f"Passengers: {passengers}. A passenger uses a wheelchair and needs a ramp or lift at pickup and drop-off.\n"
        f"Reason: the walking route has a barrier, {barrier}.\n"
        "Please confirm the vehicle and the pickup time. Thank you."
    )
    return DispatcherDraft(text=text, label=LABEL)
