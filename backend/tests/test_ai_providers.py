"""Cloud provider selection, the shared prompt/parse path, vision fallback, tier fall-through
to keyword rules, and bring-your-own-key handling. Every provider is exercised against a
local fake OpenAI-compatible server (tests/fake_openai.py); nothing leaves the machine."""

import logging

import pytest
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.services.ai.classifier import ProviderChain, build_chain, log_startup_status
from app.services.ai.providers import (
    GeminiProvider,
    GroqProvider,
    ImageInput,
    NebiusProvider,
    ProviderError,
    parse_classification,
)
from tests.fake_openai import FakeOpenAI, has_image

KEY = "test-key-a1b2c3d4e5f6abcdef"
JPEG = ImageInput(b"\xff\xd8\xff\xe0" + b"\x00" * 64, "image/jpeg")


@pytest.fixture
def fake():
    server = FakeOpenAI().start()
    yield server
    server.stop()


@pytest.fixture
def fake2():
    server = FakeOpenAI().start()
    yield server
    server.stop()


# ------------------------------------------------------------------ settings and selection

def test_local_ai_settings_are_gone():
    # Any local-server provider name is rejected at startup, not silently ignored.
    with pytest.raises(ValidationError):
        Settings(ai_provider="local-server")
    assert not hasattr(Settings(), "ai_api_base")
    assert not hasattr(Settings(), "ai_model")
    assert not hasattr(Settings(), "local_ai")
    assert Settings().ai_provider == "cloud"


def test_chain_selection_by_ai_provider():
    names = lambda s: [p.name for p in build_chain(s).providers]  # noqa: E731
    assert names(Settings(ai_provider="none", gemini_api_key=KEY)) == []  # none means no cloud calls
    assert names(Settings(ai_provider="cloud")) == []  # no keys, keyword rules only
    assert names(Settings(ai_provider="cloud", gemini_api_key=KEY, groq_api_key=KEY)) == ["gemini", "groq"]
    # Nebius is never picked unless its key is set, and the order is configurable.
    assert names(Settings(ai_provider="cloud", gemini_api_key=KEY, nebius_api_key=KEY,
                          ai_cloud_order="nebius,gemini")) == ["nebius", "gemini"]


def test_cloud_status_needs_no_network_and_hides_key():
    p = GeminiProvider("https://example.invalid/v1", "gemini-x", api_key=KEY)
    st = p.status()
    assert st["available"] is True and st["provider"] == "gemini"
    assert KEY not in repr(p) and KEY not in str(st)
    assert GeminiProvider("https://example.invalid/v1", "gemini-x").status()["available"] is False


def test_startup_log_names_the_missing_key(monkeypatch, caplog, fresh_chain):
    monkeypatch.setattr(get_settings(), "gemini_api_key", None)
    monkeypatch.setattr(get_settings(), "groq_api_key", None)
    monkeypatch.setattr(get_settings(), "nebius_api_key", None)
    with caplog.at_level(logging.INFO, logger="app.services.ai"):
        log_startup_status()
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "GEMINI_API_KEY" in text and "keyword rules" in text
    assert "local" not in text.lower()


# ------------------------------------------------------------------ shared prompt and parsing

def test_parse_strips_thinking_blocks():
    raw = ('<|channel>thought maybe {"category": "nope"} <channel|>'
           '{"category":"ramp","subcategory":"blocked_ramp","severity":0.8,"summary":"s",'
           '"detected_features":[],"confidence":0.7}')
    c = parse_classification(raw, source="gemini", model="gemini-x", used_images=False)
    assert (c.category, c.subcategory, c.source) == ("ramp", "blocked_ramp", "gemini")


def test_parse_reassigns_subcategory_to_its_real_parent():
    raw = '{"category":"sidewalk","subcategory":"blocked_ramp","severity":2,"summary":"","confidence":0.5}'
    c = parse_classification(raw, source="gemini", model="m", used_images=False)
    assert c.category == "ramp" and c.severity == 1.0


def test_every_cloud_provider_sends_the_same_prompt_and_schema(fake):
    bodies = []
    for p in (GeminiProvider(fake.base, "gemini-x", api_key=KEY),
              GroqProvider(fake.base, "groq-x", api_key=KEY),
              NebiusProvider(fake.base, "nebius-x", api_key=KEY)):
        c = p.classify("Truck on the ramp", [])
        assert c.source == p.name and c.subcategory == "blocked_ramp"
        bodies.append(fake.chat_calls()[-1]["body"])
    systems = {b["messages"][0]["content"] for b in bodies}
    schemas = {b["response_format"]["json_schema"]["name"] for b in bodies}
    assert len(systems) == 1 and schemas == {"accessibility_classification"}
    # The prompt is city-neutral and carries the taxonomy-fit sentence.
    assert "in Manhattan" not in systems.pop()


# ------------------------------------------------------------------ cloud providers

def test_gemini_sends_bearer_key_and_photos(fake):
    c = GeminiProvider(fake.base, "gemini-3.5-flash-lite", api_key=KEY).classify("Ramp", [JPEG])
    call = fake.chat_calls()[-1]
    assert call["auth"] == f"Bearer {KEY}"
    assert KEY not in call["path"]  # key never in the URL
    assert has_image(call["body"]) and c.images_reviewed and c.source == "gemini"


def test_vision_rejection_is_logged_once_then_text_only(fake, caplog):
    fake.reject_images = True
    p = GeminiProvider(fake.base, "gemini-x", api_key=KEY)
    with caplog.at_level(logging.WARNING, logger="app.services.ai"):
        first = p.classify("Truck on the ramp", [JPEG])
        n_after_first = len(fake.chat_calls())
        second = p.classify("Truck on the ramp", [JPEG])
    assert first.images_reviewed is False and second.images_reviewed is False
    assert p.vision is False
    # First call: one photo attempt, one text attempt. Second call: straight to text.
    assert n_after_first == 2
    assert not any(has_image(c["body"]) for c in fake.chat_calls()[n_after_first:])
    lines = [r.getMessage() for r in caplog.records if "rejected image input" in r.getMessage()]
    assert len(lines) == 1 and "\n" not in lines[0]


def test_vision_accepted_marks_images_reviewed(fake):
    p = GeminiProvider(fake.base, "gemini-x", api_key=KEY)
    c = p.classify("Look at this", [JPEG])
    assert c.images_reviewed is True and p.vision is True
    content = fake.chat_calls()[-1]["body"]["messages"][1]["content"]
    assert content[0]["type"] == "image_url" and content[-1]["type"] == "text"


def test_empty_answer_from_a_thinking_model_is_explained(fake):
    fake.reply = ""
    with pytest.raises(ProviderError, match="empty answer"):
        GeminiProvider(fake.base, "gemini-x", api_key=KEY).classify("Ramp blocked", [])


def test_schema_rejection_retries_without_schema(fake):
    fake.reject_schema = True
    c = GroqProvider(fake.base, "groq-x", api_key=KEY).classify("Ramp blocked", [])
    assert c.subcategory == "blocked_ramp"
    assert "response_format" not in fake.chat_calls()[-1]["body"]


def test_groq_never_sends_photos(fake):
    chain = ProviderChain([GroqProvider(fake.base, "openai/gpt-oss-20b", api_key=KEY)])
    c = chain.classify("Ramp blocked by a truck", [JPEG])
    assert c.source == "groq" and not has_image(fake.chat_calls()[-1]["body"])
    assert "text only" in (c.fallback_reason or "")


def test_bad_key_and_quota_stop_retrying(fake):
    p = GeminiProvider(fake.base, "g", api_key=KEY)
    fake.status = 401
    with pytest.raises(ProviderError, match="rejected the API key"):
        p.classify("x", [JPEG])
    assert len(fake.chat_calls()) == 1
    fake.status = 429
    with pytest.raises(ProviderError, match="quota"):
        p.classify("x", [])


def test_chain_falls_through_tiers_and_says_why(fake, fake2):
    fake.status = 429
    chain = ProviderChain([GeminiProvider(fake.base, "g", api_key=KEY), GroqProvider(fake2.base, "q", api_key=KEY)])
    c = chain.classify("Ramp blocked", [])
    assert c.source == "groq" and "Gemini quota" in c.fallback_reason
    fake2.status = 500
    c = chain.classify("Delivery truck parked on the ramp", [])
    assert c.source == "heuristic" and c.category == "ramp"
    assert "Gemini" in c.fallback_reason and "Groq" in c.fallback_reason


def test_keyword_rules_are_labelled_heuristic_when_no_cloud_tier_answers(fake):
    fake.status = 500
    chain = ProviderChain([GeminiProvider(fake.base, "g", api_key=KEY)])
    c = chain.classify("Ramp blocked by a delivery truck", [])
    assert c.source == "heuristic" and c.model is None


def test_fallback_disabled_raises_when_every_tier_fails(fake):
    fake.status = 500
    chain = ProviderChain([GeminiProvider(fake.base, "g", api_key=KEY)], fallback_enabled=False)
    with pytest.raises(RuntimeError):
        chain.classify("x", [])
    # AI_PROVIDER=none: keyword rules are the chosen tier, not a fallback.
    assert ProviderChain([], fallback_enabled=False).classify("ramp blocked", []).source == "heuristic"


# ------------------------------------------------------------------ API: status, BYOK, limits

def test_ai_status_lists_tiers_and_chat(client, fresh_chain):
    body = client.get("/api/meta/ai-status").json()
    assert body["available"] is False and body["provider"] == "heuristic"
    assert [t["provider"] for t in body["tiers"]] == ["heuristic"]
    assert body["byok"]["providers"] == ["gemini", "groq", "nebius"]
    assert body["chat"]["available"] is False and body["chat"]["tier"] is None
    assert body["chat"]["read_only"] is True
    assert body["chat"]["rate_limit_per_minute"] == get_settings().chat_rate_limit_per_minute


def test_ai_status_reports_chat_tier_when_a_key_is_set(client, monkeypatch, fresh_chain):
    monkeypatch.setattr(get_settings(), "groq_api_key", KEY)
    from app.services.ai.classifier import reset_chain

    reset_chain()
    body = client.get("/api/meta/ai-status").json()
    assert body["available"] is True and body["provider"] == "groq"
    assert body["chat"]["available"] is True and body["chat"]["tier"] == "groq"
    assert KEY not in str(body)


def test_byok_key_used_once_and_never_logged(client, user_headers, fake, monkeypatch, caplog, fresh_chain):
    monkeypatch.setattr(get_settings(), "gemini_api_base", fake.base)
    headers = {**user_headers, "X-AI-Provider": "gemini", "X-AI-Key": KEY}
    with caplog.at_level(logging.DEBUG):
        r = client.post("/api/reports/classify", json={"description": "Truck on the ramp"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "gemini"
    assert fake.chat_calls()[-1]["auth"] == f"Bearer {KEY}"
    assert KEY not in caplog.text and KEY not in r.text
    # The next request without the header doesn't reuse the key.
    r = client.post("/api/reports/classify", json={"description": "Truck on the ramp"}, headers=user_headers)
    assert r.json()["source"] == "heuristic" and len(fake.chat_calls()) == 1


def test_byok_validation_does_not_echo_key(client, user_headers):
    r = client.post("/api/reports/classify", json={"description": "x"},
                    headers={**user_headers, "X-AI-Provider": "openai", "X-AI-Key": KEY})
    assert r.status_code == 422 and KEY not in r.text
    bad = "short" + "!" * 300
    r = client.post("/api/reports/classify", json={"description": "x"},
                    headers={**user_headers, "X-AI-Provider": "gemini", "X-AI-Key": bad})
    assert r.status_code == 422 and bad not in r.text


def test_classify_rate_limited_per_ip_even_with_byok(client, user_headers, monkeypatch):
    from app.api.dependencies import classify_limiter

    monkeypatch.setattr(classify_limiter, "limit", 3)
    headers = {**user_headers, "X-AI-Provider": "gemini", "X-AI-Key": KEY}
    monkeypatch.setattr(get_settings(), "gemini_api_base", "http://127.0.0.1:9/v1")
    codes = [client.post("/api/reports/classify", json={"description": "Ramp blocked"}, headers=headers).status_code
             for _ in range(4)]
    assert codes[:3] == [200, 200, 200] and codes[3] == 429


def test_classify_body_size_capped(client, user_headers):
    r = client.post("/api/reports/classify", content=b'{"description": "' + b"a" * 20_000 + b'"}',
                    headers={**user_headers, "Content-Type": "application/json"})
    assert r.status_code == 413
