"""Accessibility classification via a local LM Studio server (OpenAI-compatible API),
with a deterministic keyword classifier as fallback when the model is offline,
slow, or returns something we can't validate."""

import base64
import json
import logging
import re
import time
from dataclasses import dataclass

import httpx

from app.core.config import get_settings
from app.domain.taxonomy import CATEGORIES, is_valid_category, subcategory_info
from app.schemas import Classification
from app.services.ai.prompts import RESPONSE_SCHEMA, SYSTEM_PROMPT

log = logging.getLogger(__name__)


@dataclass
class ImageInput:
    data: bytes
    mime: str


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


# ------------------------------------------------------------------ LM Studio

class LMStudioClient:
    def __init__(self, base_url: str, model: str, timeout: float):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._health: tuple[float, bool, str | None] = (0.0, False, None)

    def status(self) -> dict:
        """Cached for 20s so the UI can poll it cheaply."""
        checked, ok, model = self._health
        if time.monotonic() - checked < 20:
            return {"available": ok, "model": model, "base_url": self.base_url}
        ok, model = False, None
        try:
            r = httpx.get(f"{self.base_url}/models", timeout=2.0)
            r.raise_for_status()
            ids = [m.get("id") for m in r.json().get("data", [])]
            ok = bool(ids)
            model = self.model if self.model in ids else (ids[0] if ids else None)
        except (httpx.HTTPError, ValueError):
            pass
        self._health = (time.monotonic(), ok, model)
        return {"available": ok, "model": model, "base_url": self.base_url}

    def _chat(self, content: list[dict] | str, use_schema: bool) -> str:
        body: dict = {
            "model": self.status().get("model") or self.model,
            "temperature": 0.1,
            "max_tokens": 400,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
        }
        if use_schema:
            body["response_format"] = {"type": "json_schema", "json_schema": RESPONSE_SCHEMA}
        r = httpx.post(f"{self.base_url}/chat/completions", json=body, timeout=self.timeout)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

    def classify(self, text: str, images: list[ImageInput]) -> Classification:
        prompt = f"Report text from the user:\n\"\"\"\n{text.strip() or '(no text provided)'}\n\"\"\""
        attempts: list[tuple[list[dict] | str, bool]] = []
        if images:
            parts: list[dict] = [{"type": "text", "text": prompt + f"\n{len(images)} photo(s) attached."}]
            for img in images[:3]:
                b64 = base64.b64encode(img.data).decode("ascii")
                parts.append({"type": "image_url", "image_url": {"url": f"data:{img.mime};base64,{b64}"}})
            attempts += [(parts, True), (parts, False)]
        attempts += [(prompt, True), (prompt, False)]

        last_err: Exception | None = None
        for content, use_schema in attempts:
            try:
                raw = self._chat(content, use_schema)
                return self._parse(raw, used_images=bool(images) and not isinstance(content, str))
            except (httpx.HTTPError, KeyError, ValueError) as e:
                last_err = e
                log.info("LM Studio attempt failed (schema=%s images=%s): %s", use_schema, not isinstance(content, str), e)
                if isinstance(e, httpx.ConnectError | httpx.TimeoutException):
                    break
        raise RuntimeError(f"LM Studio classification failed: {last_err}")

    def _parse(self, raw: str, used_images: bool) -> Classification:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            raise ValueError("no JSON object in model output")
        data = json.loads(match.group(0))
        cat, sub = str(data.get("category", "")).strip(), str(data.get("subcategory", "")).strip()
        if not is_valid_category(cat, sub):
            # Model sometimes returns a valid subcategory under the wrong parent.
            owner = next((c for c, i in CATEGORIES.items() if sub in i["subcategories"]), None)
            if owner is None:
                raise ValueError(f"invalid category pair {cat}/{sub}")
            cat = owner
        features = [str(f)[:40] for f in data.get("detected_features", [])][:8]
        if used_images:
            features = features or ["photo reviewed"]
        return Classification(
            category=cat,
            subcategory=sub,
            severity=round(min(1.0, max(0.0, float(data.get("severity", 0.5)))), 2),
            summary=str(data.get("summary", ""))[:240] or subcategory_info(cat, sub)["label"],
            detected_features=features,
            confidence=round(min(1.0, max(0.0, float(data.get("confidence", 0.6)))), 2),
            source="lmstudio",
            model=self.status().get("model") or self.model,
        )


_client: LMStudioClient | None = None


def get_client() -> LMStudioClient:
    global _client
    if _client is None:
        s = get_settings()
        _client = LMStudioClient(s.ai_api_base, s.ai_model, s.ai_timeout_seconds)
    return _client


def classify(text: str, images: list[ImageInput] | None = None) -> Classification:
    images = images or []
    s = get_settings()
    client = get_client()
    if client.status()["available"]:
        try:
            return client.classify(text, images)
        except RuntimeError as e:
            if not s.ai_fallback_enabled:
                raise
            log.warning("%s; using heuristic classifier", e)
    elif not s.ai_fallback_enabled:
        raise RuntimeError("AI service unavailable and fallback disabled")
    result = heuristic_classify(text)
    if images and result.category == "other":
        result.summary = result.summary or "Photo submitted without description."
    return result
