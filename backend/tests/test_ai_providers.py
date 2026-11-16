"""Provider selection, the shared prompt/parse path, vision fallback, tier fall-through
and bring-your-own-key handling. Every provider is exercised against a local fake
OpenAI-compatible server (tests/fake_openai.py); nothing leaves the machine."""

import logging

import pytest

from app.core.config import Settings, get_settings
from app.services.ai.classifier import ProviderChain, build_chain
from app.services.ai.providers import (
    GeminiProvider,
    GroqProvider,
    ImageInput,
    LocalProvider,
    NebiusProvider,
    ProviderError,
    parse_classification,
)
from tests.fake_openai import FakeOpenAI, has_image

KEY = "test-key-0123456789abcdef"
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

def test_local_defaults_per_server(monkeypatch):
    monkeypatch.delenv("AI_API_BASE", raising=False)
    monkeypatch.delenv("AI_MODEL", raising=False)
    assert Settings(ai_provider="lmstudio").local_ai() == ("http://localhost:1234/v1", "gemma-4-12b-it-qat-gguf")
    assert Settings(ai_provider="ollama").local_ai() == ("http://localhost:11434/v1", "gemma4:12b")
    # An explicit AI_API_BASE / AI_MODEL always wins.
    monkeypatch.setenv("AI_API_BASE", "http://gpu-box:11434/v1")
    monkeypatch.setenv("AI_MODEL", "gemma4:e4b")
    assert Settings(ai_provider="ollama").local_ai() == ("http://gpu-box:11434/v1", "gemma4:e4b")


def test_chain_selection_by_ai_provider():
    names = lambda s: [p.name for p in build_chain(s).providers]  # noqa: E731
    assert names(Settings(ai_provider="lmstudio")) == ["lmstudio"]
    assert names(Settings(ai_provider="ollama")) == ["ollama"]
    assert names(Settings(ai_provider="none")) == []
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


# ------------------------------------------------------------------ shared prompt and parsing

def test_parse_strips_thinking_blocks():
    raw = ('<|channel>thought maybe {"category": "nope"} <channel|>'
           '{"category":"ramp","subcategory":"blocked_ramp","severity":0.8,"summary":"s",'
           '"detected_features":[],"confidence":0.7}')
    c = parse_classification(raw, source="ollama", model="gemma4:12b", used_images=False)
    assert (c.category, c.subcategory, c.source) == ("ramp", "blocked_ramp", "ollama")


def test_parse_reassigns_subcategory_to_its_real_parent():
    raw = '{"category":"sidewalk","subcategory":"blocked_ramp","severity":2,"summary":"","confidence":0.5}'
    c = parse_classification(raw, source="gemini", model="m", used_images=False)
    assert c.category == "ramp" and c.severity == 1.0


def test_every_provider_sends_the_same_prompt_and_schema(fake):
    bodies = []
    for p in (LocalProvider("ollama", fake.base, "fake-model"),
              GeminiProvider(fake.base, "gemini-x", api_key=KEY),
              GroqProvider(fake.base, "groq-x", api_key=KEY),
              NebiusProvider(fake.base, "nebius-x", api_key=KEY)):
        c = p.classify("Truck on the ramp", [])
        assert c.source == p.name and c.subcategory == "blocked_ramp"
        bodies.append(fake.chat_calls()[-1]["body"])
    systems = {b["messages"][0]["content"] for b in bodies}
    schemas = {b["response_format"]["json_schema"]["name"] for b in bodies}
    assert len(systems) == 1 and schemas == {"accessibility_classification"}


# ------------------------------------------------------------------ local providers (Ollama / LM Studio)

def test_ollama_provider_probes_models_and_uses_loaded_model(fake):
    fake.models = ["gemma4:12b"]
    p = LocalProvider("ollama", fake.base, "gemma4:12b")
    st = p.status()
    assert st["available"] is True and st["model"] == "gemma4:12b" and st["label"] == "Ollama"
    c = p.classify("The elevator is out of service", [])
    assert c.source == "ollama" and c.model == "gemma4:12b"
    assert fake.chat_calls()[-1]["auth"] is None  # local servers get no key


def test_local_provider_unreachable_is_not_available():
    p = LocalProvider("ollama", "http://127.0.0.1:9/v1", "gemma4:12b")
    assert p.status()["available"] is False
    with pytest.raises(ProviderError, match="unreachable"):
        p.classify("text", [])


def test_vision_rejection_is_logged_once_then_text_only(fake, caplog):
    fake.reject_images = True
    p = LocalProvider("ollama", fake.base, "gemma4:12b")
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
    p = LocalProvider("lmstudio", fake.base, "fake-model")
    c = p.classify("Look at this", [JPEG])
    assert c.images_reviewed is True and p.vision is True
    content = fake.chat_calls()[-1]["body"]["messages"][1]["content"]
    assert content[0]["type"] == "image_url" and content[-1]["type"] == "text"


def test_schema_rejection_retries_without_schema(fake):
    fake.reject_schema = True
    c = LocalProvider("lmstudio", fake.base, "fake-model").classify("Ramp blocked", [])
    assert c.subcategory == "blocked_ramp"
    assert "response_format" not in fake.chat_calls()[-1]["body"]


# ------------------------------------------------------------------ cloud providers

def test_gemini_sends_bearer_key_and_photos(fake):
    c = GeminiProvider(fake.base, "gemini-3.5-flash-lite", api_key=KEY).classify("Ramp", [JPEG])
    call = fake.chat_calls()[-1]
    assert call["auth"] == f"Bearer {KEY}"
    assert KEY not in call["path"]  # key never in the URL
    assert has_image(call["body"]) and c.images_reviewed and c.source == "gemini"


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


def test_fallback_disabled_raises_when_every_tier_fails(fake):
    fake.status = 500
    chain = ProviderChain([GeminiProvider(fake.base, "g", api_key=KEY)], fallback_enabled=False)
    with pytest.raises(RuntimeError):
        chain.classify("x", [])
    # AI_PROVIDER=none: keyword rules are the chosen tier, not a fallback.
    assert ProviderChain([], fallback_enabled=False).classify("ramp blocked", []).source == "heuristic"


# ------------------------------------------------------------------ API: status, mode switch, BYOK

def test_ai_status_lists_tiers(client):
    body = client.get("/api/meta/ai-status").json()
    assert body["available"] is False and body["provider"] == "heuristic"
    assert [t["provider"] for t in body["tiers"]] == ["lmstudio", "heuristic"]
    assert body["byok"]["providers"] == ["gemini", "groq", "nebius"]


def test_ollama_mode_end_to_end(client, user_headers, fake, monkeypatch, fresh_chain):
    s = get_settings()
    monkeypatch.setattr(s, "ai_provider", "ollama")
    monkeypatch.setattr(s, "ai_api_base", fake.base)
    fake.models = ["gemma4:12b"]
    r = client.post("/api/reports/classify", json={"description": "Truck on the ramp"}, headers=user_headers)
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "ollama" and r.json()["model"] == "gemma4:12b"


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
