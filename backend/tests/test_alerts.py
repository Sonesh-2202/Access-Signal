"""Route alerts (AI-4): matching rules, the opt-in API, the scheduled check, push delivery
(faked, no network), privacy of payloads, graceful fallbacks and the reverification nudge."""

import base64
import json
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pywebpush import WebPushException
from sqlalchemy import func, select

from app.core.config import get_settings
from app.models import (
    Issue,
    Notification,
    Place,
    PlaceAccessibility,
    PushSubscription,
    Report,
    SavedCorridor,
    User,
)
from app.services.alerts import push as push_module
from app.services.alerts.check import check_corridor
from app.services.alerts.matching import near_route, route_fingerprint
from app.services.alerts.notify import notify
from app.services.alerts.reverify import notify_reverification
from app.services.routing.engine import Router
from tests.conftest import GRID_LAT, GRID_LNG, PASSWORD, STEP, login, make_user

ORIGIN = (GRID_LAT, GRID_LNG)
DEST = (GRID_LAT + 4 * STEP, GRID_LNG + 4 * STEP)
T0 = datetime(2026, 1, 1, 9, tzinfo=UTC)
PUBLIC_KEY = "BBmsR3-t2eEDhsJP5UDnWel1YY0RBkfgJD_l3p9qMphyfwxjH2CfQ"


# ------------------------------------------------------------------ matching rules
def test_fingerprint_is_stable_and_moves_with_barriers_length_or_streets():
    streets = ["Elm", "Oak"]
    a = route_fingerprint(412.0, ["r2", "r1"], streets)
    assert a == route_fingerprint(412.0, ["r1", "r2"], streets)  # barrier order does not matter
    assert a == route_fingerprint(414.0, ["r1", "r2"], streets)  # under 10 m is not material
    assert a != route_fingerprint(412.0, ["r1"], streets)
    assert a != route_fingerprint(480.0, ["r1", "r2"], streets)
    assert a != route_fingerprint(412.0, ["r1", "r2"], ["Oak", "Elm"])  # a same-length detour still counts


def test_near_route_uses_distance_to_the_line():
    coords = [[-73.993, 40.735], [-73.991, 40.735]]  # a short east-west route
    on_line = (40.735, -73.992)
    off_line = (40.7365, -73.992)  # about 170 m north
    assert near_route(on_line[0], on_line[1], coords, 25)
    assert not near_route(off_line[0], off_line[1], coords, 25)


# ------------------------------------------------------------------ helpers
def _user(db, email: str = "walker@example.org") -> User:
    return make_user(db, email, name="Walker")


def _headers(client, email: str) -> dict:
    return login(client, email)


def _corridor(db, user: User, name: str = "Home to work", created: datetime = datetime(2025, 12, 31, tzinfo=UTC),
              **prefs) -> SavedCorridor:
    c = SavedCorridor(user_id=user.id, name=name, origin_lat=ORIGIN[0], origin_lng=ORIGIN[1],
                      destination_lat=DEST[0], destination_lng=DEST[1], profile="standard",
                      notify_reports=prefs.get("reports", True), notify_outages=prefs.get("outages", True),
                      notify_route_changes=prefs.get("changes", True), created_at=created)
    db.add(c)
    db.commit()
    return c


def _report_on_route(db, grid, *, when: datetime, user_id: str | None = None, lat=None, lng=None,
                     confirmed: bool = False) -> Report:
    if lat is None:
        route = Router(db).route(ORIGIN, DEST, "standard", False, alternatives=0)["routes"][0]
        pts = route["geometry"]["coordinates"]
        lng, lat = pts[len(pts) // 2]
    r = Report(user_id=user_id, lat=lat, lng=lng, category="ramp", subcategory="blocked_ramp", status="open",
               severity_score=0.8, confidence_score=0.8, description="Blocked ramp", reported_at=when)
    db.add(r)
    db.commit()
    if confirmed:
        db.add(Issue(report_id=r.id, status="confirmed"))
        db.commit()
    return r


def _push_recorder(monkeypatch, *, status: int | None = None):
    """Turns push on with dummy keys and records every payload instead of sending it."""
    s = get_settings()
    monkeypatch.setattr(s, "vapid_public_key", PUBLIC_KEY)
    monkeypatch.setattr(s, "vapid_private_key", "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----")
    sent: list[dict] = []

    class _Resp:
        status_code = status

    def fake_webpush(**kw):
        if status is not None:
            raise WebPushException("gone", response=_Resp())
        sent.append(json.loads(kw["data"]))

    monkeypatch.setattr(push_module, "webpush", fake_webpush)
    return sent


# ------------------------------------------------------------------ API: access and ownership
def test_alert_endpoints_require_sign_in(client):
    assert client.get("/api/alerts/corridors").status_code == 401
    assert client.get("/api/alerts/inbox").status_code == 401
    assert client.post("/api/alerts/push-subscriptions", json={}).status_code == 401


def test_push_is_off_without_vapid_keys(client):
    body = client.get("/api/alerts/push").json()
    assert body == {"enabled": False, "public_key": None}


def test_corridor_crud_is_private_to_its_owner(client, db, user_headers, grid):
    body = {"name": "Home to work", "origin": list(ORIGIN), "destination": list(DEST), "profile": "standard"}
    r = client.post("/api/alerts/corridors", headers=user_headers, json=body)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert r.json()["notify_reports"] is True and r.json()["origin"] == list(ORIGIN)

    assert [c["id"] for c in client.get("/api/alerts/corridors", headers=user_headers).json()] == [cid]
    other = _headers(client, _user(db, "other@example.org").email)
    assert client.get("/api/alerts/corridors", headers=other).json() == []
    assert client.patch(f"/api/alerts/corridors/{cid}", headers=other, json={"notify_reports": False}).status_code == 404
    assert client.delete(f"/api/alerts/corridors/{cid}", headers=other).status_code == 404

    patched = client.patch(f"/api/alerts/corridors/{cid}", headers=user_headers, json={"notify_outages": False})
    assert patched.json()["notify_outages"] is False
    assert client.delete(f"/api/alerts/corridors/{cid}", headers=user_headers).status_code == 204
    assert client.get("/api/alerts/corridors", headers=user_headers).json() == []


def test_corridor_input_is_checked(client, user_headers):
    bad = {"name": "x", "origin": [95, 0], "destination": [40.7, -73.9]}
    assert client.post("/api/alerts/corridors", headers=user_headers, json=bad).status_code == 422
    assert client.post("/api/alerts/corridors", headers=user_headers,
                       json={"name": "", "origin": [1, 1], "destination": [2, 2]}).status_code == 422


def test_a_user_can_watch_at_most_ten_routes(client, user_headers):
    body = {"name": "Route", "origin": list(ORIGIN), "destination": list(DEST)}
    for _ in range(10):
        assert client.post("/api/alerts/corridors", headers=user_headers, json=body).status_code == 201
    r = client.post("/api/alerts/corridors", headers=user_headers, json=body)
    assert r.status_code == 422 and "up to 10 routes" in r.json()["detail"]


def test_subscribe_and_unsubscribe_round_trip(client, db, user_headers):
    sub = {"endpoint": "https://push.example.net/send/abc123", "keys": {"p256dh": "B" * 40, "auth": "a" * 16}}
    assert client.post("/api/alerts/push-subscriptions", headers=user_headers, json=sub).status_code == 201
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 1
    assert client.post("/api/alerts/push-subscriptions", headers=user_headers, json=sub).status_code == 201
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 1  # re-subscribing does not duplicate
    client.post("/api/alerts/push-subscriptions/unsubscribe", headers=user_headers, json={"endpoint": sub["endpoint"]})
    assert db.scalar(select(func.count()).select_from(PushSubscription)) == 0


def test_push_endpoints_must_be_https(client, user_headers):
    bad = {"endpoint": "http://push.example.net/x", "keys": {"p256dh": "B" * 40, "auth": "a" * 16}}
    assert client.post("/api/alerts/push-subscriptions", headers=user_headers, json=bad).status_code == 422


# ------------------------------------------------------------------ scheduled check
def test_first_check_records_the_route_and_sends_nothing(db, grid, user_headers, client):
    user = db.scalar(select(User).where(User.email == "reporter@example.org"))
    c = _corridor(db, user)
    result = check_corridor(db, c, now=T0)
    db.commit()
    assert result == {"sent": 0, "route": True}
    assert c.fingerprint and c.last_checked_at is not None
    assert db.scalar(select(func.count()).select_from(Notification)) == 0


def test_confirmed_report_near_the_route_becomes_an_inbox_item_once(db, grid, monkeypatch):
    user = _user(db)
    c = _corridor(db, user)
    check_corridor(db, c, now=T0)
    db.commit()
    _report_on_route(db, grid, when=T0 + timedelta(days=1), confirmed=True)
    assert check_corridor(db, c, now=T0 + timedelta(days=2))["sent"] >= 1
    db.commit()
    items = db.scalars(select(Notification).where(Notification.user_id == user.id)).all()
    kinds = {i.kind for i in items}
    assert "report" in kinds
    assert all(i.corridor_id == c.id for i in items)
    before = db.scalar(select(func.count()).select_from(Notification))
    # Running again finds the same report, and the inbox does not get a second copy.
    check_corridor(db, c, now=T0 + timedelta(days=3))
    db.commit()
    assert db.scalar(select(func.count()).select_from(Notification)) == before


def test_unconfirmed_reports_do_not_alert(db, grid):
    user = _user(db)
    c = _corridor(db, user, changes=False)
    check_corridor(db, c, now=T0)
    db.commit()
    _report_on_route(db, grid, when=T0 + timedelta(days=1), confirmed=False)
    check_corridor(db, c, now=T0 + timedelta(days=2))
    db.commit()
    assert db.scalar(select(func.count()).select_from(Notification)) == 0


def test_a_report_far_from_the_route_does_not_alert(db, grid):
    user = _user(db)
    c = _corridor(db, user)
    check_corridor(db, c, now=T0)
    db.commit()
    _report_on_route(db, grid, when=T0 + timedelta(days=1), lat=GRID_LAT + 0.01, lng=GRID_LNG, confirmed=True)
    check_corridor(db, c, now=T0 + timedelta(days=2))
    db.commit()
    assert db.scalar(select(func.count()).select_from(Notification)) == 0


def test_a_changed_route_is_reported(db, grid):
    user = _user(db)
    c = _corridor(db, user)
    check_corridor(db, c, now=T0)
    db.commit()
    _report_on_route(db, grid, when=T0 + timedelta(days=1), confirmed=False)  # changes the route, no issue
    check_corridor(db, c, now=T0 + timedelta(days=2))
    db.commit()
    kinds = [i.kind for i in db.scalars(select(Notification)).all()]
    assert kinds == ["route_change"]


def test_preferences_switch_off_each_kind(db, grid):
    user = _user(db)
    c = _corridor(db, user, reports=False, outages=False, changes=False)
    check_corridor(db, c, now=T0)
    db.commit()
    _report_on_route(db, grid, when=T0 + timedelta(days=1), confirmed=True)
    check_corridor(db, c, now=T0 + timedelta(days=2))
    db.commit()
    assert db.scalar(select(func.count()).select_from(Notification)) == 0


def test_an_out_of_service_lift_near_the_route_is_an_outage(db, grid):
    user = _user(db)
    place = Place(lat=GRID_LAT, lng=GRID_LNG, name="Corner Station", place_type="transit_station")
    db.add(place)
    db.commit()
    c = _corridor(db, user)
    check_corridor(db, c, now=T0)
    db.commit()
    db.add(PlaceAccessibility(place_id=place.id, feature_type="elevator", status="unavailable", source="report",
                              confidence=0.8, assessed_at=T0 + timedelta(days=1)))
    db.commit()
    check_corridor(db, c, now=T0 + timedelta(days=2))
    db.commit()
    item = db.scalar(select(Notification))
    assert item.kind == "outage"


def test_push_is_sent_with_a_generic_payload_and_no_personal_text(db, grid, monkeypatch):
    user = _user(db)
    c = _corridor(db, user, name="Mum's house, 12 Private Lane")
    db.add(PushSubscription(user_id=user.id, endpoint="https://push.example.net/s/1", p256dh="B" * 40, auth="a" * 16))
    db.commit()
    sent = _push_recorder(monkeypatch)
    check_corridor(db, c, now=T0)
    db.commit()
    _report_on_route(db, grid, when=T0 + timedelta(days=1), confirmed=True, user_id=None)
    check_corridor(db, c, now=T0 + timedelta(days=2))
    db.commit()
    notes = db.scalars(select(Notification)).all()
    assert len(sent) == len(notes) >= 1
    payload_text = json.dumps(sent[0])
    assert sent[0]["url"] == "settings#alerts"  # relative: the service worker resolves it under the app base path
    for private in ("Mum", "Private Lane", "Blocked ramp", "Home to work"):
        assert private not in payload_text
    assert "Mum" not in json.dumps([i.body + i.title for i in db.scalars(select(Notification)).all()])


def test_gone_subscription_is_revoked(db, grid, monkeypatch):
    user = _user(db)
    db.add(PushSubscription(user_id=user.id, endpoint="https://push.example.net/s/gone", p256dh="B" * 40, auth="a" * 16))
    db.commit()
    _push_recorder(monkeypatch, status=410)
    notify(db, user.id, kind="report", title="t", body="b", dedupe_key="k1")
    db.commit()
    sub = db.scalar(select(PushSubscription))
    assert sub.revoked_at is not None
    assert db.scalar(select(func.count()).select_from(Notification)) == 1  # the inbox still has it


def test_without_push_support_the_inbox_still_works(db):
    user = _user(db)
    notify(db, user.id, kind="outage", title="t", body="b", dedupe_key="k-no-push")
    db.commit()
    assert db.scalar(select(func.count()).select_from(Notification)) == 1


def test_inbox_read_state_is_per_owner(client, db, user_headers):
    owner = db.scalar(select(User).where(User.email == "reporter@example.org"))
    notify(db, owner.id, kind="report", title="A report", body="Open the planner.", dedupe_key="inbox-1")
    db.commit()
    box = client.get("/api/alerts/inbox", headers=user_headers).json()
    assert box["unread"] == 1 and box["items"][0]["read"] is False
    item_id = box["items"][0]["id"]
    other = _headers(client, _user(db, "stranger@example.org").email)
    assert client.post(f"/api/alerts/inbox/{item_id}/read", headers=other).status_code == 404
    assert client.post(f"/api/alerts/inbox/{item_id}/read", headers=user_headers).status_code == 204
    assert client.get("/api/alerts/inbox", headers=user_headers).json()["unread"] == 0


def test_inbox_item_names_its_corridor(client, db, user_headers):
    owner = db.scalar(select(User).where(User.email == "reporter@example.org"))
    c = _corridor(db, owner, name="Gym route")
    notify(db, owner.id, kind="report", title="t", body="b", dedupe_key="named", corridor_id=c.id)
    db.commit()
    assert client.get("/api/alerts/inbox", headers=user_headers).json()["items"][0]["corridor_name"] == "Gym route"


# ------------------------------------------------------------------ reverification nudge
def test_a_repair_nudges_nearby_reporters_and_changes_nothing(db, grid):
    reporter = _user(db, "nearby@example.org")
    fixer_side = _report_on_route(db, grid, when=T0, user_id=None, lat=GRID_LAT, lng=GRID_LNG)
    nearby = Report(user_id=reporter.id, lat=GRID_LAT + 0.0002, lng=GRID_LNG, category="ramp",
                    subcategory="blocked_ramp", status="open", severity_score=0.8, confidence_score=0.8,
                    description="Blocked", reported_at=T0)
    far = Report(user_id=reporter.id, lat=GRID_LAT + 0.01, lng=GRID_LNG, category="ramp",
                 subcategory="blocked_ramp", status="open", severity_score=0.8, confidence_score=0.8,
                 description="Blocked far", reported_at=T0)
    db.add_all([nearby, far])
    db.commit()
    assert notify_reverification(db, fixer_side) == 1
    db.commit()
    items = db.scalars(select(Notification)).all()
    assert len(items) == 1 and items[0].kind == "reverify"
    assert "Nothing changes until you confirm" in items[0].body
    assert db.get(Report, nearby.id).status == "open"  # no automatic change
    assert notify_reverification(db, fixer_side) == 0  # a second run does not nudge again
    db.commit()


# ------------------------------------------------------------------ migrations and key tooling
def test_alert_migration_creates_the_tables_on_a_fresh_database(tmp_path: Path):
    db_file = tmp_path / "migrate.db"
    env = {**os.environ, "DATABASE_URL": "sqlite:///" + db_file.as_posix()}
    backend = Path(__file__).resolve().parents[1]
    proc = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=backend, env=env,
                          capture_output=True, text=True, timeout=180)
    assert proc.returncode == 0, proc.stderr
    import sqlite3
    names = {r[0] for r in sqlite3.connect(db_file).execute("select name from sqlite_master where type='table'")}
    assert {"saved_corridors", "push_subscriptions", "notifications"} <= names


def test_vapid_generator_prints_a_usable_key_pair(capsys):
    from scripts.generate_vapid import main
    assert main() == 0
    out = capsys.readouterr().out
    lines = dict(line.split("=", 1) for line in out.strip().splitlines())
    pub = lines["VAPID_PUBLIC_KEY"]
    raw = base64.urlsafe_b64decode(pub + "=" * (-len(pub) % 4))
    assert len(raw) == 65 and raw[0] == 4  # an uncompressed P-256 point
    assert lines["VAPID_PRIVATE_KEY"].startswith("-----BEGIN PRIVATE KEY-----")
