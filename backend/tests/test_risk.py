"""Corridor risk for reliable routing (AI-2). Deterministic scoring, property tests on the cost
bound (A* admissibility), and engine behaviour on the test grid."""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from hypothesis import given, settings
from hypothesis import strategies as st
from sqlalchemy import select

from app.models import Hotspot, Report
from app.services.intelligence.risk import HIGH_RISK, edge_risk, time_multiplier
from app.services.routing.costs import Barrier, apply_barriers, apply_risk, base_cost, unknown_penalty
from app.services.routing.engine import Router
from tests.conftest import GRID_LAT, GRID_LNG, STEP
from tests.test_routing import PROFILES, attrs_strategy

NYC = ZoneInfo("America/New_York")


# ------------------------------------------------------------------ scoring
@settings(max_examples=300, deadline=None)
@given(h=st.integers(0, 5), n=st.integers(0, 10), conf=st.floats(0, 1), mult=st.floats(1, 1.5))
def test_risk_is_bounded_and_grows_with_each_signal(h, n, conf, mult):
    risk, _ = edge_risk(h, n, conf, mult)
    assert 0 <= risk <= 1
    assert edge_risk(h + 1, n, conf, mult)[0] >= risk
    assert edge_risk(h, n + 1, conf, mult)[0] >= risk
    assert edge_risk(h, n, conf, mult)[0] <= edge_risk(h, n, min(1, conf + 0.2), mult)[0] + 1e-9


def test_risk_breakdown_shows_the_inputs():
    risk, breakdown = edge_risk(2, 3, 0.8, 1.2)
    assert breakdown == {"hotspots": 2, "open_issues": 3, "mean_confidence": 0.8, "time_multiplier": 1.2,
                         "risk": risk}
    assert edge_risk(2, 3, 0.8, 1.2) == (risk, breakdown)  # deterministic


def test_no_signal_means_no_risk():
    assert edge_risk(0, 0, 0.9, 1.5)[0] == 0


def _reports_at(hours: list[int], day=datetime(2026, 3, 10, tzinfo=NYC)) -> list[datetime]:
    return [day.replace(hour=h) for h in hours]


def test_time_multiplier_needs_enough_reports():
    now = datetime(2026, 3, 10, 18, tzinfo=NYC)
    assert time_multiplier(_reports_at([18] * 5), now) == 1.0


def test_time_multiplier_rises_when_reports_cluster_near_now():
    now = datetime(2026, 3, 10, 18, tzinfo=NYC)
    assert time_multiplier(_reports_at([18] * 40), now) == 1.5
    # Reports spread evenly over the day give no lift.
    spread = _reports_at([h for h in range(24)] * 2)
    assert time_multiplier(spread, now) == 1.0
    # Quiet at this hour, so no lift even though there are many reports.
    assert time_multiplier(_reports_at([3] * 40), now) == 1.0


def test_time_multiplier_uses_new_york_hours_and_naive_times_as_utc():
    now = datetime(2026, 3, 10, 18, tzinfo=NYC)
    utc_18 = [datetime(2026, 3, 10, 22, tzinfo=UTC)] * 40  # 18:00 in New York
    assert time_multiplier(utc_18, now) == 1.5
    assert time_multiplier(_reports_at([18] * 40), now.astimezone(UTC)) == 1.5


# ------------------------------------------------------------------ cost bound with risk
@settings(max_examples=300, deadline=None)
@given(length=st.floats(min_value=0.5, max_value=2000), attrs=attrs_strategy,
       profile=st.sampled_from(PROFILES), risk=st.floats(min_value=0, max_value=1),
       sev=st.floats(min_value=0, max_value=1), conf=st.floats(min_value=0, max_value=1),
       avoid_unknown=st.booleans(), with_barrier=st.booleans())
def test_cost_with_risk_never_below_length(length, attrs, profile, risk, sev, conf, avoid_unknown, with_barrier):
    """Straight-line distance is the A* heuristic. It stays admissible only if every edge cost,
    including the risk penalty, is at least the edge length."""
    ec = base_cost(length, attrs, profile)
    barriers = [Barrier("r", "ramp", "blocked_ramp", "Ramp", sev, conf, False, 0, 0)] if with_barrier else []
    ec = apply_barriers(ec, length, barriers, profile)
    ec = apply_risk(ec, length, risk)
    if ec.cost is not None:
        ec.cost = unknown_penalty(ec.cost, ec.unknown, avoid_unknown)
        assert ec.cost >= length - 1e-9


@settings(max_examples=200, deadline=None)
@given(length=st.floats(min_value=1, max_value=500), attrs=attrs_strategy, profile=st.sampled_from(PROFILES),
       risk=st.floats(min_value=0, max_value=1))
def test_risk_only_adds_cost(length, attrs, profile, risk):
    ec = base_cost(length, attrs, profile)
    after = apply_risk(base_cost(length, attrs, profile), length, risk)
    if ec.cost is None:
        assert after.cost is None
    else:
        assert after.cost >= ec.cost


# ------------------------------------------------------------------ engine on the test grid
def _block_street(db, lat: float, lng: float, n: int = 3) -> None:
    """A hotspot and open reports on one street, so its risk is high."""
    db.add(Hotspot(lat=lat, lng=lng, radius_m=60.0, area={"type": "Polygon", "coordinates": []},
                   severity_index=0.6, report_count=n, dominant_category="ramp", trend="stable", report_ids=[]))
    now = datetime.now(UTC)
    for _ in range(n):
        db.add(Report(lat=lat, lng=lng, category="ramp", subcategory="blocked_ramp", status="open",
                      severity_score=0.8, confidence_score=0.8, description="Blocked", reported_at=now))
    db.commit()


def test_reliable_route_avoids_a_high_risk_street(client, db, grid):
    origin = [GRID_LAT, GRID_LNG]
    dest = [GRID_LAT + 4 * STEP, GRID_LNG + 4 * STEP]
    plain = client.post("/api/routing/route", json={"origin": origin, "destination": dest, "profile": "standard",
                                                    "alternatives": 0}).json()["routes"][0]
    assert plain["risk"] is None
    # Street names repeat across grid edges, so block a middle segment, not the first one.
    first = plain["segments"][2]
    lng, lat = first["coords"][0][0], first["coords"][0][1]
    lng2, lat2 = first["coords"][1][0], first["coords"][1][1]
    mid_lat, mid_lng = (lat + lat2) / 2, (lng + lng2) / 2
    _block_street(db, mid_lat, mid_lng)

    body = client.post("/api/routing/route", json={"origin": origin, "destination": dest, "profile": "standard",
                                                   "alternatives": 0, "prefer_reliable": True}).json()
    route = body["routes"][0]
    assert route["risk"]["enabled"] is True
    assert route["risk"]["threshold"] == HIGH_RISK
    assert first["name"] not in [s["name"] for s in route["segments"]]
    assert route["risk"]["high_risk_avoided"] >= 1
    assert route["explanation"][0].startswith("Avoids")
    assert "corridor" in route["explanation"][0]
    assert "Avoids" in route["risk"]["summary"]
    assert route["risk"]["formula"].startswith("Corridor risk")


def test_reliable_route_is_identical_when_no_risk_exists(client, grid):
    origin = [GRID_LAT, GRID_LNG]
    dest = [GRID_LAT + 4 * STEP, GRID_LNG + 4 * STEP]
    base = client.post("/api/routing/route", json={"origin": origin, "destination": dest, "profile": "standard",
                                                   "alternatives": 0}).json()["routes"][0]
    rel = client.post("/api/routing/route", json={"origin": origin, "destination": dest, "profile": "standard",
                                                  "alternatives": 0, "prefer_reliable": True}).json()["routes"][0]
    assert rel["geometry"] == base["geometry"]
    assert rel["risk"]["high_risk_avoided"] == 0


def test_risk_report_is_computed_without_writes(client, db, grid):
    before = db.scalar(select(Report.id).limit(1))
    client.post("/api/routing/route", json={"origin": [GRID_LAT, GRID_LNG],
                                            "destination": [GRID_LAT + 4 * STEP, GRID_LNG + 4 * STEP],
                                            "profile": "wheelchair", "alternatives": 0, "prefer_reliable": True})
    assert db.scalar(select(Report.id).limit(1)) == before
    assert db.scalars(select(Report)).all() == []


def test_router_accepts_a_fixed_clock_for_reproducible_risk(db, grid):
    _block_street(db, GRID_LAT, GRID_LNG)
    now = datetime(2026, 3, 10, 18, tzinfo=NYC)
    a = Router(db, now=now).route((GRID_LAT, GRID_LNG), (GRID_LAT + 4 * STEP, GRID_LNG + 4 * STEP), "standard",
                                  False, alternatives=0, prefer_reliable=True)["routes"][0]["risk"]
    b = Router(db, now=now).route((GRID_LAT, GRID_LNG), (GRID_LAT + 4 * STEP, GRID_LNG + 4 * STEP), "standard",
                                  False, alternatives=0, prefer_reliable=True)["routes"][0]["risk"]
    assert a == b
