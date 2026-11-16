"""AI providers behind one interface.

Every model tier speaks the OpenAI-compatible chat API, so they share one client:
the same system prompt, JSON schema and output parser (prompts.py, parse_classification).
Subclasses only set defaults: base URL, whether a key is needed, whether photos are sent.

    LocalProvider      LM Studio or Ollama on this machine (probed via GET /models)
    GeminiProvider     Google AI Studio, OpenAI-compatible endpoint, text + photos
    GroqProvider       GroqCloud, text only
    NebiusProvider     Nebius Token Factory (optional, for leftover credits)
    HeuristicProvider  keyword rules, always available, always last

API keys are held on the instance only. They go in the Authorization header and
never into URLs, log lines or error messages."""

from __future__ import annotations

import base64
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.domain.taxonomy import CATEGORIES, is_valid_category, subcategory_info
from app.schemas import Classification
from app.services.ai.prompts import RESPONSE_SCHEMA, SYSTEM_PROMPT

log = logging.getLogger("app.services.ai")


@dataclass
class ImageInput:
    data: bytes
    mime: str


class ProviderError(RuntimeError):
    """A tier could not produce a classification. The message is safe to show and log."""


class Provider(Protocol):
    name: str
    label: str

    def status(self) -> dict: ...
    def classify(self, text: str, images: list[ImageInput]) -> Classification: ...


# ------------------------------------------------------------------ shared parsing

_THOUGHT = re.compile(r"<\|channel\>thought.*?<channel\|>|<think>.*?</think>", re.DOTALL)


def build_prompt(text: str) -> str:
    return f"Report text from the user:\n\"\"\"\n{text.strip() or '(no text provided)'}\n\"\"\""


def parse_classification(raw: str, *, source: str, model: str | None, used_images: bool) -> Classification:
    """Validate model output against the taxonomy. Raises ValueError on anything unusable."""
    raw = _THOUGHT.sub("", raw or "")
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError("no JSON object in model output")
    data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise ValueError("model output is not a JSON object")
    cat, sub = str(data.get("category", "")).strip(), str(data.get("subcategory", "")).strip()
    if not is_valid_category(cat, sub):
        # Models sometimes return a valid subcategory under the wrong parent.
        owner = next((c for c, i in CATEGORIES.items() if sub in i["subcategories"]), None)
        if owner is None:
            raise ValueError(f"invalid category pair {cat}/{sub}")
        cat = owner
    features = [str(f)[:40] for f in data.get("detected_features", []) or []][:8]
    if used_images:
        features = features or ["photo reviewed"]
    return Classification(
        category=cat,
        subcategory=sub,
        severity=round(min(1.0, max(0.0, float(data.get("severity", 0.5)))), 2),
        summary=str(data.get("summary", ""))[:240] or subcategory_info(cat, sub)["label"],
        detected_features=features,
        confidence=round(min(1.0, max(0.0, float(data.get("confidence", 0.6)))), 2),
        source=source,
        model=model,
        images_reviewed=used_images,
    )


def _short(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        body = ""
        try:
            body = e.response.text[:160].replace("\n", " ")
        except Exception:  # noqa: BLE001, S110 - best effort detail only
            pass
        return f"HTTP {e.response.status_code}{': ' + body if body else ''}"
    return f"{type(e).__name__}: {str(e)[:160]}"


# ------------------------------------------------------------------ OpenAI-compatible base

class OpenAICompatibleProvider:
    name = "openai"
    label = "OpenAI-compatible"
    requires_key = True
    default_vision = True
    max_tokens = 400
    extra_body: dict = {}

    def __init__(self, base_url: str, model: str, *, api_key: str | None = None, timeout: float = 45.0,
                 vision: bool | None = None):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._api_key = api_key or None
        self.timeout = timeout
        # None = not yet known, learned from the first photo request.
        self.vision: bool | None = self.default_vision if vision is None else vision

    def __repr__(self) -> str:  # never show the key
        return f"<{type(self).__name__} {self.base_url} model={self.model}>"

    # ---- status

    def status(self) -> dict:
        ok = bool(self._api_key) or not self.requires_key
        return {"provider": self.name, "label": self.label, "available": ok, "model": self.model,
                "base_url": self.base_url, "vision": self.vision is not False}

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}

    def _model_for_request(self) -> str:
        return self.model

    # ---- calls

    def _chat(self, content: list[dict] | str, use_schema: bool) -> str:
        body: dict = {
            "model": self._model_for_request(),
            "temperature": 0.1,
            "max_tokens": self.max_tokens,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            **self.extra_body,
        }
        if use_schema:
            body["response_format"] = {"type": "json_schema", "json_schema": RESPONSE_SCHEMA}
        r = httpx.post(f"{self.base_url}/chat/completions", json=body, headers=self._headers(), timeout=self.timeout)
        r.raise_for_status()
        choice = r.json()["choices"][0]
        content = choice["message"].get("content") or ""
        if not content.strip():
            # Reasoning models can spend the whole max_tokens budget thinking.
            thought = bool(choice["message"].get("reasoning") or choice["message"].get("reasoning_content"))
            raise ValueError(f"empty answer (finish_reason={choice.get('finish_reason')}"
                             f"{', output went to reasoning' if thought else ''})")
        return content

    def _attempt(self, content: list[dict] | str, use_schema: bool, used_images: bool) -> Classification:
        raw = self._chat(content, use_schema)
        return parse_classification(raw, source=self.name, model=self._model_for_request(), used_images=used_images)

    def classify(self, text: str, images: list[ImageInput]) -> Classification:
        """Up to four calls, each one answering a question: photos+schema, then text+schema
        (did the photos cause the failure?), then the same without a JSON schema (did the
        schema?). A model that rejects photos while accepting text is remembered, logged
        once, and sent text only from then on."""
        prompt = build_prompt(text)
        image_content: list[dict] | None = None
        if images and self.vision is not False:
            # Images first: Gemma and Gemini both read better with the image before the text.
            image_content = [
                {"type": "image_url", "image_url": {"url": f"data:{img.mime};base64,{base64.b64encode(img.data).decode('ascii')}"}}
                for img in images[:3]
            ]
            image_content.append({"type": "text", "text": prompt + f"\n{len(images[:3])} photo(s) attached."})

        last_err: Exception | None = None
        for use_schema in (True, False):
            image_rejected: Exception | None = None
            if image_content is not None and self.vision is not False:
                try:
                    result = self._attempt(image_content, use_schema, used_images=True)
                    self.vision = True
                    return result
                except (httpx.ConnectError, httpx.TimeoutException) as e:
                    raise ProviderError(f"{self.label} unreachable ({type(e).__name__})") from None
                except httpx.HTTPStatusError as e:
                    self._raise_if_fatal(e)
                    image_rejected = last_err = e
                except (KeyError, ValueError, TypeError, IndexError) as e:
                    last_err = e
            try:
                result = self._attempt(prompt, use_schema, used_images=False)
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                raise ProviderError(f"{self.label} unreachable ({type(e).__name__})") from None
            except httpx.HTTPStatusError as e:
                self._raise_if_fatal(e)
                last_err = e
                continue
            except (KeyError, ValueError, TypeError, IndexError) as e:
                last_err = e
                continue
            if image_rejected is not None:
                self.vision = False
                log.warning("%s model %s rejected image input (%s); classifying text only from now on.",
                            self.label, self._model_for_request(), _short(image_rejected))
            return result
        raise ProviderError(f"{self.label} classification failed ({_short(last_err) if last_err else 'no attempts'})")

    def _raise_if_fatal(self, e: httpx.HTTPStatusError) -> None:
        code = e.response.status_code
        if code in (401, 403):
            raise ProviderError(f"{self.label} rejected the API key (HTTP {code})") from None
        if code == 429:
            raise ProviderError(f"{self.label} quota or rate limit reached (HTTP 429)") from None


class LocalProvider(OpenAICompatibleProvider):
    """LM Studio or Ollama. Availability comes from GET /models, cached for 20 s so the
    UI can poll cheaply; the model actually loaded wins over the configured name."""

    requires_key = False
    default_vision = None  # depends on the model files; learned on first photo

    LABELS = {"lmstudio": "LM Studio", "ollama": "Ollama"}

    def __init__(self, kind: str, base_url: str, model: str, *, timeout: float = 45.0):
        super().__init__(base_url, model, timeout=timeout)
        self.name = kind
        self.label = self.LABELS.get(kind, kind)
        self._health: tuple[float, bool, str | None] = (0.0, False, None)
        if kind == "ollama":
            # Verified against Ollama 0.40 + gemma4:12b: over /v1 the model thinks by default
            # and spends max_tokens on `reasoning`, leaving `content` empty. "none" turns
            # thinking off; classification doesn't need it. LM Studio requests are unchanged.
            self.extra_body = {"reasoning_effort": "none"}

    def status(self) -> dict:
        checked, ok, model = self._health
        if time.monotonic() - checked >= 20:
            ok, model = False, None
            try:
                r = httpx.get(f"{self.base_url}/models", timeout=2.0)
                r.raise_for_status()
                ids = [m.get("id") for m in r.json().get("data", [])]
                ok = bool(ids)
                model = self.model if self.model in ids else (ids[0] if ids else None)
            except (httpx.HTTPError, ValueError, AttributeError):
                pass
            self._health = (time.monotonic(), ok, model)
        return {"provider": self.name, "label": self.label, "available": ok, "model": model or self.model,
                "base_url": self.base_url, "vision": self.vision is not False}

    def _model_for_request(self) -> str:
        return self._health[2] or self.model


class GeminiProvider(OpenAICompatibleProvider):
    name = "gemini"
    label = "Gemini"
    default_vision = True
    # Gemini 3+ always thinks; thinking tokens count against max_tokens.
    max_tokens = 2048
    extra_body = {"reasoning_effort": "low"}


class GroqProvider(OpenAICompatibleProvider):
    name = "groq"
    label = "Groq"
    default_vision = False  # the free-tier text models don't take images
    max_tokens = 2048
    extra_body = {"reasoning_effort": "low"}


class NebiusProvider(OpenAICompatibleProvider):
    name = "nebius"
    label = "Nebius"
    default_vision = False  # depends on NEBIUS_MODEL; set NEBIUS_VISION=true for a VL model
    max_tokens = 800


class HeuristicProvider:
    name = "heuristic"
    label = "Keyword rules"

    def status(self) -> dict:
        return {"provider": self.name, "label": self.label, "available": True, "model": None,
                "base_url": None, "vision": False}

    def classify(self, text: str, images: list[ImageInput]) -> Classification:
        from app.services.ai.classifier import heuristic_classify

        result = heuristic_classify(text)
        if images and result.category == "other":
            result.summary = result.summary or "Photo submitted without description."
        return result


CLOUD_PROVIDERS: dict[str, type[OpenAICompatibleProvider]] = {
    "gemini": GeminiProvider,
    "groq": GroqProvider,
    "nebius": NebiusProvider,
}
