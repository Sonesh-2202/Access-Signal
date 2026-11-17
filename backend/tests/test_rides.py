"""Accessible ride handoff (AI-3): curated list, dispatcher draft preview, graceful fallbacks.
No external ride service is called. AI drafts go to the local fake OpenAI server."""

import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.models import Evidence, Issue, IssueHistory, Place, PlaceAccessibility, Report, User
from app.services.ai.classifier import reset_chain
from app.services.ai.ride import RIDE_DATA, load_rides
from tests.fake_openai import FakeOpenAI

KEY = "test-key-a1b2c3d4e5f6abcdef"
WRITE_TABLES = (Report, Issue, IssueHistory, Evidence, Place, PlaceAccessibility, User)
DRAFT = {"pickup": "Union Square", "dropoff": "Grand Central Terminal", "barrier": "missing curb cut",
         "passengers": 1}


@pytest.fixture
def fake():
    server = FakeOpenAI().start()
    yield server
    server.stop()


@pytest.fixture
def ai(fake, monkeypatch, fresh_chain):
    s = get_settings()
    monkeypatch.setattr(s, "gemini_api_key", KEY)
    monkeypatch.setattr(s, "gemini_api_base", fake.base)
    reset_chain()
    return fake


def _counts(db) -> dict[str, int]:
    return {m.__tablename__: db.scalar(select(func.count()).select_from(m)) or 0 for m in WRITE_TABLES}


# ------------------------------------------------------------------ curated list
def test_shipped_list_has_checked_contacts_with_sources():
    rides = load_rides()
    assert {r.id for r in rides} == {"aar", "accessible-dispatch"}
    for r in rides:
        assert r.source_url.startswith("https://")
        assert r.url is None or r.url.startswith("https://")
        assert r.phone and r.tel and r.tel.startswith("+1")


def test_invalid_entries_are_skipped_not_rendered(tmp_path: Path):
    data = {"rides": [
        {"id": "good", "name": "Good", "kind": "taxi", "phone": "646-599-9999", "notes": "n",
         "source_url": "https://example.gov/a"},
        {"id": "http", "name": "Plain http", "kind": "taxi", "url": "http://example.org", "notes": "n",
         "source_url": "https://example.gov/b"},
        {"id": "badphone", "name": "Bad", "kind": "taxi", "phone": "call us", "notes": "n",
         "source_url": "https://example.gov/c"},
        {"id": "nothing", "name": "No contact", "kind": "taxi", "notes": "n", "source_url": "https://example.gov/d"},
        {"id": "js", "name": "Script", "kind": "taxi", "url": "javascript:alert(1)", "notes": "n",
         "source_url": "https://example.gov/e"},
    ]}
    path = tmp_path / "rides.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    assert [r.id for r in load_rides(path)] == ["good"]


def test_missing_or_broken_file_gives_no_rides(tmp_path: Path):
    assert load_rides(tmp_path / "absent.json") == []
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert load_rides(bad) == []
    assert RIDE_DATA.name == "accessible_rides.json"


def test_list_endpoint_is_public_and_makes_no_model_call(client, fake):
    r = client.get("/api/rides")
    assert r.status_code == 200
    assert {x["id"] for x in r.json()} == {"aar", "accessible-dispatch"}
    assert fake.calls == []


# ------------------------------------------------------------------ draft
def test_template_draft_is_a_labelled_preview_with_the_facts(client, db, user_headers):
    counts = _counts(db)
    body = client.post("/api/rides/draft", json=DRAFT).json()
    assert body["source"] == "template" and body["preview"] is True
    assert "review before sending" in body["label"].lower()
    text = body["text"]
    assert "Union Square" in text and "Grand Central Terminal" in text
    assert "wheelchair" in text and "ramp or lift" in text and "missing curb cut" in text
    assert _counts(db) == counts


def test_passenger_count_is_in_the_draft(client):
    text = client.post("/api/rides/draft", json={**DRAFT, "passengers": 2}).json()["text"]
    assert "Passengers: 2." in text


def test_ai_draft_is_used_when_it_keeps_the_facts(client, ai):
    ai.reply = ("Please send an accessible taxi from Union Square to Grand Central Terminal. The passenger "
                "uses a wheelchair and needs a ramp or lift. The walk has a missing curb cut. Thank you.")
    body = client.post("/api/rides/draft", json={**DRAFT, "use_ai": True}).json()
    assert body["source"] == "ai" and body["model"] == get_settings().gemini_model
    assert body["preview"] is True and "Grand Central Terminal" in body["text"]


def test_ai_draft_missing_a_fact_falls_back_to_the_template(client, ai):
    ai.reply = "Please send a taxi to Union Square. Thank you."  # no drop-off, no wheelchair
    body = client.post("/api/rides/draft", json={**DRAFT, "use_ai": True}).json()
    assert body["source"] == "template"
    assert "did not include every required fact" in body["note"]


def test_ai_requested_without_a_cloud_tier_uses_the_template(client):
    body = client.post("/api/rides/draft", json={**DRAFT, "use_ai": True}).json()
    assert body["source"] == "template"
    assert "No cloud AI is available" in body["note"]


def test_ai_draft_with_a_provider_error_uses_the_template(client, ai):
    ai.status = 500
    body = client.post("/api/rides/draft", json={**DRAFT, "use_ai": True}).json()
    assert body["source"] == "template"


def test_draft_without_ai_makes_no_model_call(client, ai):
    client.post("/api/rides/draft", json=DRAFT)
    assert ai.chat_calls() == []


def test_draft_input_is_bounded(client):
    r = client.post("/api/rides/draft", json={**DRAFT, "passengers": 9})
    assert r.status_code == 422
    r = client.post("/api/rides/draft", json={**DRAFT, "barrier": "x" * 300})
    assert r.status_code == 422
