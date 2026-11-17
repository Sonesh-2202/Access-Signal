"""Alerts near me: plain distance matching, a one-off check that stores nothing, an opt-in location that
expires, dedupe, and a mocked push whose payload has no addresses, names or report text. No AI, no
real push service."""

import json
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pywebpush import WebPushException
from sqlalchemy import func, select

from app.core.config import get_settings
from app.models import (
    Evidence,
    Issue,
    IssueHistory,
    Notification,
    Place,
    PlaceAccessibility,
    PushSubscription,
    Report,
    User,
)
from app.services.alerts import push as push_module
from app.services.alerts.check import check_nearby, check_nearby_all, find_nearby
from app.services.alerts.matching import NEARBY_LOCATION_TTL, within_radius
from tests.conftest import login, make_user

LAT, LNG = 40.7349, -73.9906  # Union Square
DEG_PER_M = 1 / 111_195  # about 111 m per 0.001 degree of latitude
NEAR = (LAT + 40 * DEG_PER_M, LNG)  # about 40 m north
MID = (LAT + 180 * DEG_PER_M, LNG)  # about 180 m north: inside 250 m, outside 100 m
FAR = (LAT + 600 * DEG_PER_M, LNG)  # about 600 m north: outside every radius
WRITE_TABLES = (Report, Issue, IssueHistory, Evidence, Place, PlaceAccessibility, User, Notification)
SECRET = "Secret delivery truck text that must never leave the server"
PUBLIC_KEY = "BBmsR3-t2eEDhsJP5UDnWel1YY0RBkfgJD_l3p9qMphyfwxjH2CfQ"


def _report(db, lat, lng, *, status="open", deleted=False, duplicate=False, subcategory="blocked_ramp",
            category="ramp", description=SECRET) -> Report:
    r = Report(lat=lat, lng=lng, category=category, subcategory=subcategory, status=status,
               severity_score=0.8, confidence_score=0.8, description=description,
               reported_at=datetime.now(UTC), user_id=None,
               deleted_at=datetime.now(UTC) if deleted else None,
               duplicate_of=None)
    if duplicate:
        r.status = "duplicate"
    db.add(r)
    db.commit()
    return r


def _place(db, lat, lng, status="unavailable", feature="elevator", name="Corner Station") -> Place:
    p = Place(lat=lat, lng=lng, name=name, place_type="transit_station")
    p.features.append(PlaceAccessibility(feature_type=feature, status=status, source="report", confidence=0.7,
                                         assessed_at=datetime.now(UTC)))
    db.add(p)
    db.commit()
    return p


def _counts(db) -> dict[str, int]:
    return {m.__tablename__: db.scalar(select(func.count()).select_from(m)) or 0 for m in WRITE_TABLES}


def _user(db, email="nearby@example.org") -> User:
    return make_user(db, email, name="Nearby Walker")


def _headers(client, email="nearby@example.org") -> dict:
    return login(client, email)


def _now(client, lat=LAT, lng=LNG, radius=250):
    return client.post("/api/alerts/nearby/now", json={"lat": lat, "lng": lng, "radius_m": radius})


# ------------------------------------------------------------------ plain distance rules
def test_a_point_just_inside_the_radius_matches_and_just_outside_does_not():
    assert within_radius(LAT, LNG, LAT + 99 * DEG_PER_M, LNG, 100)
    assert not within_radius(LAT, LNG, LAT + 101 * DEG_PER_M, LNG, 100)


def test_find_nearby_uses_the_box_then_the_exact_distance(db):
    near = _report(db, *NEAR)
    _report(db, *FAR)
    found = find_nearby(db, LAT, LNG, 100)
    assert [r.id for r, _ in found.barriers] == [near.id]
    assert 30 < found.barriers[0][1] < 60  # metres, nearest first
    assert find_nearby(db, LAT, LNG, 250).barriers[0][0].id == near.id
    assert len(find_nearby(db, LAT, LNG, 500).barriers) == 1  # FAR is about 600 m: still outside


def test_deleted_resolved_and_duplicate_reports_never_count(db):
    _report(db, *NEAR, deleted=True)
    _report(db, *NEAR, status="resolved")
    _report(db, *NEAR, duplicate=True)
    assert find_nearby(db, LAT, LNG, 250).barriers == []


def test_only_unavailable_critical_features_count_as_outages(db):
    _place(db, *NEAR, status="unavailable", feature="elevator")
    _place(db, *NEAR, status="available", feature="elevator", name="Working Lift")
    _place(db, *NEAR, status="unavailable", feature="automatic_door", name="Door")  # not a critical feature
    names = [p.name for _, p, _ in find_nearby(db, LAT, LNG, 250).outages]
    assert names == ["Corner Station"]


# ------------------------------------------------------------------ the one-off check
def test_nearby_now_lists_open_barriers_and_outages_without_the_report_text(client, db):
    _report(db, *NEAR)
    _report(db, *FAR)
    _place(db, *MID, name="Herald Square Station")
    body = _now(client, radius=250).json()
    assert [b["label"] for b in body["barriers"]] == ["Ramp blocked"]
    assert body["barriers"][0]["url"].startswith("/reports/")
    assert [o["place_name"] for o in body["outages"]] == ["Herald Square Station"]
    assert body["outages"][0]["label"] == "Elevator out of service"
    assert SECRET not in str(body)


def test_nearby_now_respects_the_chosen_radius(client, db):
    _report(db, *MID)
    assert _now(client, radius=100).json()["barriers"] == []
    assert len(_now(client, radius=250).json()["barriers"]) == 1


def test_nearby_now_rejects_radii_other_than_the_three_offered(client):
    assert _now(client, radius=300).status_code == 422


def test_nearby_now_is_public_stores_nothing_and_sends_nothing(client, db):
    _report(db, *NEAR)
    before = _counts(db)
    assert _now(client).status_code == 200
    assert _counts(db) == before


# ------------------------------------------------------------------ opt-in and the shared location
def test_settings_need_sign_in(client):
    assert client.get("/api/alerts/nearby/settings").status_code == 401
    assert client.put("/api/alerts/nearby/settings", json={"enabled": True}).status_code == 401


def test_alerts_near_me_are_off_by_default(client, db, user_headers):
    body = client.get("/api/alerts/nearby/settings", headers=user_headers).json()
    assert body == {"enabled": False, "radius_m": 100, "has_location": False, "location_expires_at": None}


def test_a_location_cannot_be_shared_before_switching_the_feature_on(client, user_headers):
    r = client.put("/api/alerts/nearby/location", headers=user_headers, json={"lat": LAT, "lng": LNG})
    assert r.status_code == 422


def test_turning_on_stores_a_rounded_location_that_expires(client, db, user_headers):
    headers = user_headers
    client.put("/api/alerts/nearby/settings", headers=headers, json={"enabled": True, "radius_m": 250})
    body = client.put("/api/alerts/nearby/location", headers=headers, json={"lat": 40.734912345, "lng": -73.990612345}).json()
    assert body["has_location"] is True and body["radius_m"] == 250
    user = db.scalar(select(User).where(User.email == "reporter@example.org"))
    assert user.nearby_lat == round(40.734912345, 4) and user.nearby_lng == round(-73.990612345, 4)
    assert body["location_expires_at"] is not None


def test_turning_off_forgets_the_location(client, db, user_headers):
    client.put("/api/alerts/nearby/settings", headers=user_headers, json={"enabled": True, "radius_m": 100})
    client.put("/api/alerts/nearby/location", headers=user_headers, json={"lat": LAT, "lng": LNG})
    body = client.put("/api/alerts/nearby/settings", headers=user_headers, json={"enabled": False, "radius_m": 100}).json()
    assert body["has_location"] is False
    user = db.scalar(select(User).where(User.email == "reporter@example.org"))
    assert user.nearby_lat is None and user.nearby_location_at is None


def test_forgetting_the_location_on_request(client, db, user_headers):
    client.put("/api/alerts/nearby/settings", headers=user_headers, json={"enabled": True, "radius_m": 100})
    client.put("/api/alerts/nearby/location", headers=user_headers, json={"lat": LAT, "lng": LNG})
    assert client.delete("/api/alerts/nearby/location", headers=user_headers).status_code == 204
    assert client.get("/api/alerts/nearby/settings", headers=user_headers).json()["has_location"] is False


def test_a_stale_location_is_ignored_and_then_purged(client, db, user_headers):
    user = db.scalar(select(User).where(User.email == "reporter@example.org"))
    user.nearby_alerts, user.nearby_lat, user.nearby_lng = True, LAT, LNG
    user.nearby_location_at = datetime.now(UTC) - NEARBY_LOCATION_TTL - timedelta(hours=1)
    db.commit()
    assert client.get("/api/alerts/nearby/settings", headers=user_headers).json()["has_location"] is False
    totals = check_nearby_all(db)
    assert totals["purged"] == 1
    db.refresh(user)
    assert user.nearby_lat is None


# ------------------------------------------------------------------ the scheduled alert
def _push_recorder(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "vapid_public_key", PUBLIC_KEY)
    monkeypatch.setattr(s, "vapid_private_key", "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----")
    sent: list[dict] = []

    def fake_webpush(**kw):
        sent.append(json.loads(kw["data"]))

    monkeypatch.setattr(push_module, "webpush", fake_webpush)
    return sent


def _alerting_user(db) -> User:
    u = _user(db, "alerts-on@example.org")
    u.nearby_alerts, u.nearby_radius_m = True, 250
    u.nearby_lat, u.nearby_lng, u.nearby_location_at = LAT, LNG, datetime.now(UTC)
    db.add(PushSubscription(user_id=u.id, endpoint="https://push.example.net/s/near", p256dh="B" * 40, auth="a" * 16))
    db.commit()
    return u


def test_the_scheduled_check_alerts_once_and_pushes_no_personal_text(db, monkeypatch):
    user = _alerting_user(db)
    _report(db, *NEAR)
    _place(db, *MID, name="Herald Square Station")
    sent = _push_recorder(monkeypatch)
    assert check_nearby(db, user) == 2
    db.commit()
    assert check_nearby(db, user) == 0  # the same records do not alert twice
    db.commit()
    kinds = sorted(n.kind for n in db.scalars(select(Notification).where(Notification.user_id == user.id)).all())
    assert kinds == ["nearby_outage", "nearby_report"]
    assert len(sent) == 2
    payloads = json.dumps(sent) + json.dumps([n.title + n.body for n in db.scalars(select(Notification)).all()])
    assert SECRET not in payloads
    assert "Herald Square" not in payloads and "Corner Station" not in payloads
    assert all(p["url"] == "#nearby" and set(p) == {"title", "body", "url", "kind"} for p in sent)


def test_nothing_is_checked_for_someone_who_switched_it_off(db, monkeypatch):
    user = _alerting_user(db)
    user.nearby_alerts = False
    _report(db, *NEAR)
    _push_recorder(monkeypatch)
    assert check_nearby(db, user) == 0


def test_a_push_the_browser_has_dropped_revokes_the_subscription(db, monkeypatch):
    user = _alerting_user(db)
    _report(db, *NEAR)

    class _Resp:
        status_code = 410

    def gone(**kw):
        raise WebPushException("gone", response=_Resp())

    monkeypatch.setattr(get_settings(), "vapid_public_key", PUBLIC_KEY)
    monkeypatch.setattr(get_settings(), "vapid_private_key", "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----")
    monkeypatch.setattr(push_module, "webpush", gone)
    assert check_nearby(db, user) == 1
    db.commit()
    sub = db.scalar(select(PushSubscription))
    assert sub.revoked_at is not None


def test_the_scheduler_script_prints_counts_only(capsys, db, monkeypatch):
    from scripts.check_corridors import main

    _alerting_user(db)
    _report(db, *NEAR)
    _push_recorder(monkeypatch)
    assert main() == 0
    out = capsys.readouterr().out
    assert "Alerts near me: 1 people checked" in out
    assert "https://" not in out and SECRET not in out


def test_the_alert_migration_adds_the_nearby_columns(tmp_path: Path):
    import sqlite3

    db_file = tmp_path / "nearby.db"
    env = {**os.environ, "DATABASE_URL": "sqlite:///" + db_file.as_posix()}
    backend = Path(__file__).resolve().parents[1]
    proc = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=backend, env=env,
                          capture_output=True, text=True, timeout=180)
    assert proc.returncode == 0, proc.stderr
    cols = {r[1] for r in sqlite3.connect(db_file).execute("pragma table_info(users)")}
    assert {"nearby_alerts", "nearby_radius_m", "nearby_lat", "nearby_lng", "nearby_location_at"} <= cols
