"""Multilingual reporting (AI-6): translation drafts for review, the original kept with the report,
and no writes from the translate endpoint. All model traffic goes to the fake OpenAI server."""

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.models import Evidence, Issue, IssueHistory, Place, PlaceAccessibility, Report, User
from app.services.ai.classifier import reset_chain
from app.services.ai.translate import LABEL, NEEDS_AI_MESSAGE
from tests.fake_openai import FakeOpenAI

KEY = "test-key-a1b2c3d4e5f6abcdef"
UNION = {"lat": 40.7349, "lng": -73.9906}
SPANISH = "La rampa de la entrada esta bloqueada por un camion de reparto."
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
    fake.reply = "The entrance ramp is blocked by a delivery truck."
    return fake


def _translate(client, headers, text: str = SPANISH, target: str = "en"):
    return client.post("/api/reports/translate", headers=headers, json={"text": text, "target": target})


def _counts(db) -> dict[str, int]:
    return {m.__tablename__: db.scalar(select(func.count()).select_from(m)) or 0 for m in WRITE_TABLES}


def test_translation_is_a_labelled_draft_with_the_original_kept(client, user_headers, ai):
    r = _translate(client, user_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["original"] == SPANISH
    assert body["translation"] == ai.reply
    assert body["target"] == "en" and body["source"] == "gemini" and body["model"]
    assert body["label"] == LABEL and "Review it before you file" in body["label"]


def test_the_model_is_told_to_translate_only_and_gets_no_structured_output(client, user_headers, ai):
    _translate(client, user_headers)
    call = ai.chat_calls()[-1]["body"]
    assert "response_format" not in call
    assert "Translate only" in call["messages"][0]["content"]
    assert SPANISH in call["messages"][1]["content"]


def test_translation_needs_sign_in(client, ai):
    assert _translate(client, {}).status_code == 401


def test_bad_language_tag_is_refused(client, user_headers, ai):
    assert _translate(client, user_headers, target="</system>").status_code == 422


def test_offline_says_translation_needs_cloud_ai(client, user_headers):
    r = _translate(client, user_headers)
    assert r.status_code == 503
    assert r.json()["detail"] == NEEDS_AI_MESSAGE


def test_an_implausibly_long_translation_is_not_used(client, user_headers, ai):
    ai.reply = "x" * 5000
    r = _translate(client, user_headers, text="Ramp blocked.")
    assert r.status_code == 503


def test_translating_writes_nothing(client, db, user_headers, ai):
    before = _counts(db)
    _translate(client, user_headers)
    assert _counts(db) == before


def _report_body(**extra) -> dict:
    return {**UNION, "category": "ramp", "subcategory": "blocked_ramp", "description": "Ramp is blocked by a truck.",
            **extra}


def test_an_accepted_translation_is_filed_with_the_original_text(client, user_headers, ai):
    record = {"language": "es", "original": SPANISH, "source": "gemini", "model": "fake-model", "reviewed": True}
    r = client.post("/api/reports", headers=user_headers, json=_report_body(translation=record))
    assert r.status_code == 201, r.text
    detail = client.get(f"/api/reports/{r.json()['id']}").json()
    stored = detail["ai_analysis"]["translation"]
    assert stored["original"] == SPANISH and stored["language"] == "es"
    assert stored["reviewed_by_reporter"] is True


def test_a_translation_must_be_marked_reviewed(client, user_headers):
    record = {"language": "es", "original": SPANISH, "source": "gemini", "model": None, "reviewed": False}
    r = client.post("/api/reports", headers=user_headers, json=_report_body(translation=record))
    assert r.status_code == 422


def test_reports_without_translation_store_no_translation(client, user_headers):
    r = client.post("/api/reports", headers=user_headers, json=_report_body())
    assert r.status_code == 201
    detail = client.get(f"/api/reports/{r.json()['id']}").json()
    assert not (detail["ai_analysis"] or {}).get("translation")
