"""Preflight brief (AI-5): a Good / Caution / Blocked status from open reports and key features,
tagged reasons, a screen-reader string, a cited AI summary, and no writes from any of it."""

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.models import Evidence, Issue, IssueHistory, Place, PlaceAccessibility, Report, User
from app.services.ai.classifier import reset_chain
from tests.fake_openai import FakeOpenAI

KEY = "test-key-a1b2c3d4e5f6abcdef"
WRITE_TABLES = (Report, Issue, IssueHistory, Evidence, Place, PlaceAccessibility, User)


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
    fake.reply = "Blocked: a delivery truck is on the ramp [R1]."
    return fake


def _place(db, features: dict[str, str] | None = None, name: str = "Test Hall") -> Place:
    p = Place(lat=40.7411, lng=-73.9897, name=name, place_type="other")
    for ftype, status in (features or {}).items():
        p.features.append(PlaceAccessibility(feature_type=ftype, status=status, source="osm", confidence=0.6))
    db.add(p)
    db.commit()
    return p


def _open_report(db, place: Place, subcategory: str = "blocked_ramp", category: str = "ramp",
                 severity: float = 0.9, confidence: float = 0.85) -> Report:
    r = Report(lat=place.lat, lng=place.lng, place_id=place.id, category=category, subcategory=subcategory,
               status="open", severity_score=severity, confidence_score=confidence,
               description="Delivery truck parked across the ramp.")
    db.add(r)
    db.commit()
    return r


def _counts(db) -> dict[str, int]:
    return {m.__tablename__: db.scalar(select(func.count()).select_from(m)) or 0 for m in WRITE_TABLES}


def _brief(client, place_id: str) -> dict:
    r = client.get(f"/api/places/{place_id}/preflight")
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ status rules
def test_good_when_critical_features_are_available_and_nothing_is_open(client, db):
    p = _place(db, {"step_free_entrance": "available", "ramp": "available", "elevator": "available"})
    body = _brief(client, p.id)
    assert body["status"] == "good" and body["status_label"] == "Good"
    assert "No open reports" in body["reasons"][0]
    assert "Preflight status: Good" in body["screen_reader"]


def test_blocked_by_an_open_report_that_stops_a_wheelchair_user(client, db):
    p = _place(db, {"ramp": "available"})
    _open_report(db, p)
    body = _brief(client, p.id)
    assert body["status"] == "blocked"
    assert body["reasons"][0].startswith("[R1] Open report:")
    assert "blocks a wheelchair user" in body["reasons"][0]


def test_blocked_by_a_critical_feature_out_of_service(client, db):
    p = _place(db, {"elevator": "unavailable", "step_free_entrance": "available"})
    body = _brief(client, p.id)
    assert body["status"] == "blocked"
    assert body["reasons"][0] == "[P1] Elevator is recorded as out of service."


def test_caution_for_an_open_report_that_does_not_block(client, db):
    p = _place(db, {"step_free_entrance": "available", "ramp": "available", "elevator": "available"})
    _open_report(db, p, subcategory="steep_ramp", severity=0.4, confidence=0.7)
    body = _brief(client, p.id)
    assert body["status"] == "caution"
    assert body["reasons"][0].startswith("[R1] Open report: Ramp too steep")


def test_caution_when_a_critical_feature_is_only_limited(client, db):
    p = _place(db, {"step_free_entrance": "available", "ramp": "limited"})
    body = _brief(client, p.id)
    assert body["status"] == "caution"
    assert "Ramp is recorded as limited or unknown" in body["reasons"][0]


def test_caution_when_no_critical_feature_is_recorded(client, db):
    p = _place(db, {})
    body = _brief(client, p.id)
    assert body["status"] == "caution"
    assert "No step-free entrance, ramp or elevator is recorded" in body["reasons"][0]


def test_closed_and_duplicate_reports_do_not_count(client, db):
    p = _place(db, {"step_free_entrance": "available", "ramp": "available", "elevator": "available"})
    r = _open_report(db, p)
    r.status = "resolved"
    db.commit()
    assert _brief(client, p.id)["status"] == "good"


# ------------------------------------------------------------------ grounding and access
def test_reasons_cite_tags_that_appear_in_the_sources(client, db):
    p = _place(db, {"elevator": "unavailable"})
    r = _open_report(db, p)
    body = _brief(client, p.id)
    tags = {s["tag"]: s for s in body["sources"]}
    assert {"P1", "R1"} <= set(tags)
    assert tags["R1"]["url"] == f"/reports/{r.id}"
    for reason in body["reasons"]:
        if reason.startswith("["):
            assert reason[1:reason.index("]")] in tags


def test_brief_is_public_and_calls_no_model(client, db, ai):
    p = _place(db, {"ramp": "available"})
    _brief(client, p.id)
    assert ai.chat_calls() == []


def test_unknown_place_is_not_found(client):
    assert client.get("/api/places/00000000-missing/preflight").status_code == 404


def test_screen_reader_text_has_no_tags(client, db):
    p = _place(db, {"elevator": "unavailable"}, name="Quiet Station")
    body = _brief(client, p.id)
    assert body["screen_reader"].startswith("Quiet Station. Preflight status: Blocked.")
    assert "[P1]" not in body["screen_reader"]


# ------------------------------------------------------------------ AI summary
def test_ai_summary_is_grounded_and_cited(client, db, user_headers, ai):
    p = _place(db, {"elevator": "unavailable"}, name="Hall With Lift")
    _open_report(db, p)
    body = client.post(f"/api/places/{p.id}/preflight/summary", headers=user_headers).json()
    assert body["source"] == "gemini" and body["model"]
    assert [s["tag"] for s in body["sources"]] == ["R1"]
    system = ai.chat_calls()[-1]["body"]["messages"][0]["content"]
    assert "Elevator: unavailable" in system and "Hall With Lift" in system


def test_ai_summary_needs_sign_in(client, db, ai):
    p = _place(db, {"ramp": "available"})
    assert client.post(f"/api/places/{p.id}/preflight/summary").status_code == 401


def test_without_cloud_the_summary_is_the_rule_based_one_and_labelled(client, db, user_headers):
    p = _place(db, {"elevator": "unavailable"})
    body = client.post(f"/api/places/{p.id}/preflight/summary", headers=user_headers).json()
    assert body["source"] == "rules" and body["model"] is None
    assert body["summary"].startswith("Blocked.")


def test_preflight_writes_nothing(client, db, user_headers, ai):
    p = _place(db, {"elevator": "unavailable"})
    _open_report(db, p)
    before = _counts(db)
    _brief(client, p.id)
    client.post(f"/api/places/{p.id}/preflight/summary", headers=user_headers)
    assert _counts(db) == before
