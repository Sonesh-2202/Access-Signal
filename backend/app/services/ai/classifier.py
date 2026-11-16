"""Accessibility classification through a chain of model tiers (see providers.py),
ending in a deterministic keyword classifier for when every model is offline, slow,
over quota, or returns something we can't validate.

Which tiers run is set by AI_PROVIDER:
    lmstudio  LM Studio on this machine (default)
    ollama    Ollama on this machine
    cloud     Gemini, Groq, Nebius: whichever have keys, in AI_CLOUD_ORDER
    none      keyword rules only
A bring-your-own-key provider from the request goes in front of the chain.
Every result carries `source` and `model`, so the UI can say which tier answered."""

import logging
import re

from app.core.config import Settings, get_settings
from app.domain.taxonomy import subcategory_info
from app.schemas import Classification
from app.services.ai.providers import (
    CLOUD_PROVIDERS,
    HeuristicProvider,
    ImageInput,
    LocalProvider,
    Provider,
    ProviderError,
)

__all__ = ["ImageInput", "classify", "get_chain", "heuristic_classify", "reset_chain", "byok_provider"]

log = logging.getLogger("app.services.ai")


# ------------------------------------------------------------------ heuristic

_RULES: list[tuple[str, str, tuple[str, ...]]] = [
    # (category, subcategory, keywords) - first match with the most hits wins
    ("transit", "station_elevator_outage", ("station elevator", "subway elevator", "elevator at the station", "platform elevator", "mta elevator")),
    ("elevator", "out_of_service", ("elevator out", "elevator broken", "lift broken", "out of service", "out of order", "elevator not working", "elevator down")),
    ("elevator", "no_elevator", ("no elevator", "no lift", "stairs only")),
    ("ramp", "blocked_ramp", ("ramp blocked", "blocked ramp", "blocking the ramp", "parked on the ramp", "truck on ramp", "ramp obstructed", "delivery truck")),
    ("ramp", "steep_ramp", ("steep ramp", "ramp too steep", "ramp is steep")),
    ("ramp", "damaged_ramp", ("ramp cracked", "damaged ramp", "broken ramp")),
    ("ramp", "missing_handrail", ("no handrail", "missing handrail", "handrail missing")),
    ("sidewalk", "missing_curb_cut", ("curb cut", "kerb cut", "curb ramp", "no ramp at the corner", "curb removed")),
    ("sidewalk", "construction", ("construction", "scaffold", "scaffolding", "roadwork", "sidewalk closed")),
    ("sidewalk", "broken_pavement", ("pothole", "broken pavement", "cracked sidewalk", "uneven", "tree root", "trip hazard")),
    ("sidewalk", "obstruction", ("obstruct", "blocked sidewalk", "trash bags", "scooter", "sandwich board", "vendor cart")),
    ("sidewalk", "narrow_sidewalk", ("narrow sidewalk", "too narrow to pass")),
    ("crossing", "no_audible_signal", ("audible signal", "accessible pedestrian signal", "no beeping", "no sound at crossing")),
    ("crossing", "short_signal", ("signal too short", "light changes too fast", "not enough time to cross")),
    ("crossing", "missing_tactile_paving", ("tactile", "truncated dome", "detectable warning")),
    ("transit", "platform_gap", ("platform gap", "gap between", "mind the gap")),
    ("transit", "no_level_boarding", ("level boarding", "bus ramp", "kneeling")),
    ("entrance", "step_at_entrance", ("step at entrance", "steps at the entrance", "single step", "one step", "stair at door")),
    ("entrance", "entrance_closed", ("entrance closed", "side entrance locked", "accessible entrance locked")),
    ("entrance", "heavy_door", ("heavy door", "no door button", "door opener broken", "automatic door broken", "push button")),
    ("entrance", "narrow_doorway", ("narrow door", "doorway too narrow")),
    ("restroom", "restroom_locked", ("restroom locked", "bathroom locked", "toilet locked")),
    ("restroom", "no_accessible_restroom", ("no accessible restroom", "no accessible bathroom", "restroom", "bathroom", "toilet")),
    ("wayfinding", "no_braille_signage", ("braille", "signage")),
    ("wayfinding", "poor_lighting", ("dark", "lighting", "unlit")),
    ("wayfinding", "confusing_layout", ("confusing", "hard to find", "no signs")),
]

_FEATURE_WORDS = ("ramp", "elevator", "curb", "stairs", "steps", "door", "truck", "car", "scaffolding",
                  "barrier", "platform", "crosswalk", "signal", "sidewalk", "restroom", "handrail")


def heuristic_classify(text: str) -> Classification:
    t = text.lower()
    best: tuple[int, str, str] | None = None
    for cat, sub, keywords in _RULES:
        hits = sum(1 for k in keywords if k in t)
        if hits and (best is None or hits > best[0]):
            best = (hits, cat, sub)
    if best is None:
        cat, sub, conf = "other", "other", 0.2
    else:
        cat, sub, conf = best[1], best[2], min(0.65, 0.4 + 0.1 * best[0])
    info = subcategory_info(cat, sub)
    severity = info["severity"]
    if any(w in t for w in ("completely", "impossible", "can't get in", "cannot get in", "no way", "stuck", "trapped")):
        severity = min(1.0, severity + 0.1)
    features = [w for w in _FEATURE_WORDS if re.search(rf"\b{w}", t)][:6]
    first_sentence = re.split(r"(?<=[.!?])\s", text.strip(), maxsplit=1)[0] if text.strip() else ""
    summary = first_sentence[:160] if first_sentence else f"{info['label']} reported."
    return Classification(
        category=cat, subcategory=sub, severity=round(severity, 2), summary=summary,
        detected_features=features, confidence=round(conf, 2), source="heuristic", model=None,
    )


# ------------------------------------------------------------------ provider chain

class LMStudioClient(LocalProvider):
    """The original LM Studio client, now one LocalProvider among several."""

    def __init__(self, base_url: str, model: str, timeout: float):
        super().__init__("lmstudio", base_url, model, timeout=timeout)


class ProviderChain:
    def __init__(self, providers: list[Provider], fallback_enabled: bool = True):
        self.providers = providers
        self.fallback_enabled = fallback_enabled
        self.heuristic = HeuristicProvider()

    def tiers(self) -> list[dict]:
        return [p.status() for p in self.providers] + [self.heuristic.status()]

    def status(self) -> dict:
        """Shape kept from the LM Studio-only days (`available`, `model`, `base_url`), plus
        which tier would answer now and the full list of tiers."""
        tiers = self.tiers()
        active = next((t for t in tiers[:-1] if t["available"]), None)
        return {
            "available": active is not None,
            "provider": active["provider"] if active else "heuristic",
            "label": active["label"] if active else self.heuristic.label,
            "model": active["model"] if active else None,
            "base_url": active["base_url"] if active else None,
            "vision": active["vision"] if active else False,
            "tiers": tiers,
        }

    def classify(self, text: str, images: list[ImageInput], byok: Provider | None = None) -> Classification:
        reasons: list[str] = []
        for p in ([byok] if byok else []) + self.providers:
            if not p.status()["available"]:
                reasons.append(f"{p.label} unavailable")
                continue
            try:
                result = p.classify(text, images)
            except ProviderError as e:
                log.warning("%s; trying the next tier", e)
                reasons.append(str(e))
                continue
            if images and not result.images_reviewed:
                reasons.append(f"{p.label} read the text only; photos were not sent to this model")
            if reasons:
                result.fallback_reason = "; ".join(reasons)
            return result
        if self.providers and not self.fallback_enabled:
            raise RuntimeError("AI service unavailable and fallback disabled")
        result = self.heuristic.classify(text, images)
        if reasons:
            result.fallback_reason = "; ".join(reasons)
        return result


def build_chain(s: Settings) -> ProviderChain:
    providers: list[Provider] = []
    if s.ai_provider in ("lmstudio", "ollama"):
        base, model = s.local_ai()
        providers.append(LocalProvider(s.ai_provider, base, model, timeout=s.ai_timeout_seconds))
    elif s.ai_provider == "cloud":
        for name in s.ai_cloud_order:
            p = _cloud_provider(s, name, getattr(s, f"{name}_api_key"))
            if p is not None:
                providers.append(p)
    return ProviderChain(providers, fallback_enabled=s.ai_fallback_enabled)


def _cloud_provider(s: Settings, name: str, key: str | None) -> Provider | None:
    if not key:
        return None
    cls = CLOUD_PROVIDERS[name]
    vision = s.nebius_vision if name == "nebius" else None
    return cls(getattr(s, f"{name}_api_base"), getattr(s, f"{name}_model"), api_key=key,
               timeout=min(s.ai_timeout_seconds, 30.0), vision=vision)


def byok_provider(name: str, key: str) -> Provider:
    """A one-request provider built from a browser-held key. Base URL and model always
    come from server settings, so a caller can't point the server at an arbitrary host."""
    p = _cloud_provider(get_settings(), name, key)
    assert p is not None
    return p


_chain: ProviderChain | None = None


def get_chain() -> ProviderChain:
    global _chain
    if _chain is None:
        _chain = build_chain(get_settings())
    return _chain


def reset_chain() -> None:
    global _chain
    _chain = None


def log_startup_status() -> None:
    """One line per tier at boot, so a self-hoster sees at once whether Ollama/LM Studio
    was found or the keyword classifier will be answering."""
    chain = get_chain()
    for t in chain.tiers()[:-1]:
        state = "available" if t["available"] else "not reachable" if t["provider"] in ("lmstudio", "ollama") else "no key"
        log.info("AI tier %s: %s (%s at %s)", t["label"], state, t["model"], t["base_url"])
    if not chain.status()["available"]:
        log.info("AI: no model tier available; the keyword classifier will label results as keyword-based.")


def classify(text: str, images: list[ImageInput] | None = None, byok: Provider | None = None) -> Classification:
    return get_chain().classify(text, images or [], byok=byok)
