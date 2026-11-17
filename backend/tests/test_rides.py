"""Accessible ride handoff: the curated list and the fixed dispatcher message. No external ride service
and no model is called. Nothing is written."""

import json
from pathlib import Path

from sqlalchemy import func, select

from app.models import Evidence, Issue, IssueHistory, Place, PlaceAccessibility, Report, User
from app.services.rides import RIDE_DATA, load_rides

WRITE_TABLES = (Report, Issue, IssueHistory, Evidence, Place, PlaceAccessibility, User)
DRAFT = {"pickup": "Union Square", "dropoff": "Grand Central Terminal", "barrier": "missing curb cut",
         "passengers": 1}


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


def test_list_endpoint_is_public(client):
    r = client.get("/api/rides")
    assert r.status_code == 200
    assert {x["id"] for x in r.json()} == {"aar", "accessible-dispatch"}


# ------------------------------------------------------------------ draft
def test_draft_is_a_labelled_preview_with_the_facts(client, db):
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


def test_draft_has_no_ai_path(client):
    body = client.post("/api/rides/draft", json={**DRAFT, "use_ai": True}).json()
    assert body["source"] == "template"  # the unknown field is ignored; there is no model call to make


def test_draft_input_is_bounded(client):
    assert client.post("/api/rides/draft", json={**DRAFT, "passengers": 9}).status_code == 422
    assert client.post("/api/rides/draft", json={**DRAFT, "barrier": "x" * 300}).status_code == 422
