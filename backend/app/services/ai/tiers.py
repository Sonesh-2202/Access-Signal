"""Shared access to the cloud model tiers for the few features that use AI: describing a route in
plain words and translating a report draft. Classification has its own path (classifier.py).

Tier order: a bring-your-own-key provider from the request first, then the server's keys in
AI_CLOUD_ORDER. Keyword rules can't translate or read a sentence, so when no cloud tier answers
the caller gets AIUnavailableError with a message that is safe to show."""

import re

from app.services.ai.classifier import get_chain
from app.services.ai.providers import Provider

NO_TIER_MESSAGE = (
    "This needs a cloud AI key. Add your own key in Settings, or ask the site operator to set one. "
    "The rest of AccessSignal works without it."
)
FAILED_MESSAGE = (
    "The AI service can't answer right now, most likely a provider outage or quota limit. "
    "Try again in a few minutes. The rest of AccessSignal still works."
)
_LANGUAGE_TAG = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$")


class AIUnavailableError(RuntimeError):
    """No cloud tier could answer. The message is safe to show to the user."""


def normalise_language(tag: str | None) -> str | None:
    """Accept a BCP 47 tag like "es" or "zh-Hant"; anything else is ignored."""
    if not tag:
        return None
    tag = tag.strip()
    return tag if _LANGUAGE_TAG.match(tag) else None


def available_tiers(byok: Provider | None) -> list[Provider]:
    """Available cloud tiers in order: the request's own key first, then the server's."""
    tiers = ([byok] if byok is not None else []) + list(get_chain().providers)
    return [p for p in tiers if p.status()["available"]]


def redact(text: str, secrets: list[str | None]) -> str:
    """Remove API keys from a message before it is logged."""
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[key redacted]")
    return text


def plain(text: str | None, limit: int) -> str:
    """One line of user-written text with quote and delimiter marks removed, cut to `limit`."""
    flat = " ".join((text or "").split())
    flat = flat.replace('"', "'").replace("<<<", "").replace(">>>", "")
    return flat[:limit] + ("..." if len(flat) > limit else "")
