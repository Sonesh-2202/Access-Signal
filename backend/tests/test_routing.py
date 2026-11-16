from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.routing.costs import Barrier, apply_barriers, base_cost
from tests.conftest import GRID_LAT, GRID_LNG, STEP, grid_edges

PROFILES = ["wheelchair", "reduced_effort", "low_vision", "standard"]

attrs_strategy = st.fixed_dictionaries({
    "highway": st.sampled_from(["footway", "residential", "steps", "pedestrian", "primary"]),
    "has_steps": st.booleans(),
}, optional={
    "surface": st.sampled_from(["asphalt", "concrete", "cobblestone", "gravel", "paving_stones"]),
    "incline": st.floats(min_value=0, max_value=0.3),
    "kerb": st.sampled_from(["lowered", "flush", "raised", "rolled"]),
    "crossing": st.sampled_from(["marked", "traffic_signals"]),
    "lit": st.sampled_from(["yes", "no"]),
})


@settings(max_examples=300, deadline=None)
@given(length=st.floats(min_value=0.5, max_value=2000), attrs=attrs_strategy, profile=st.sampled_from(PROFILES))
def test_cost_never_below_length(length, attrs, profile):
    """A* uses straight-line distance as heuristic; that's only admissible if cost >= length."""
    ec = base_cost(length, attrs, profile)
    assert ec.cost is None or ec.cost >= length - 1e-9


@settings(max_examples=200, deadline=None)
@given(length=st.floats(min_value=1, max_value=500), attrs=attrs_strategy,
       sev=st.floats(min_value=0, max_value=1), conf=st.floats(min_value=0, max_value=1),
       profile=st.sampled_from(PROFILES))
def test_barriers_only_increase_cost(length, attrs, sev, conf, profile):
    ec = base_cost(length, attrs, profile)
    b = Barrier("r", "ramp", "blocked_ramp", "Ramp blocked", sev, conf, True, 0, 0)
    after = apply_barriers(base_cost(length, attrs, profile), length, [b], profile)
    if ec.cost is None:
        assert after.cost is None
    elif after.cost is not None:
        assert after.cost >= ec.cost


def test_wheelchair_never_uses_stairs():
    assert base_cost(10, {"highway": "steps", "has_steps": True}, "wheelchair").cost is None
    assert base_cost(10, {"highway": "steps", "has_steps": True}, "standard").cost is not None


def _route(client, o, d, profile="wheelchair"):
    return client.post("/api/routing/route", json={"origin": o, "destination": d, "profile": profile})


def test_route_on_grid(client, grid):
    o = [GRID_LAT, GRID_LNG]
    d = [GRID_LAT + 4 * STEP, GRID_LNG + 4 * STEP]
    r = _route(client, o, d)
    assert r.status_code == 200, r.text
    best = r.json()["routes"][0]
    assert best["label"] == "Recommended"
    # 4 blocks north (~111 m each) + 4 blocks east (~84 m each at this latitude).
    assert 760 < best["distance_m"] < 800
    coords = best["geometry"]["coordinates"]
    assert abs(coords[0][1] - o[0]) < 1e-6 and abs(coords[-1][1] - d[0]) < 1e-6


def test_route_detours_around_stairs(client, db):
    # Only straight path along row 0 has stairs in the middle.
    steps = {("n0_1", "n0_2")}
    db.add_all(grid_edges(steps=steps))
    db.commit()
    o, d = [GRID_LAT, GRID_LNG + STEP], [GRID_LAT, GRID_LNG + 2 * STEP]
    std = _route(client, o, d, "standard").json()["routes"][0]
    wc = _route(client, o, d, "wheelchair").json()["routes"][0]
    assert wc["distance_m"] > std["distance_m"] * 2
    assert not any(s["has_steps"] for s in wc["segments"])


def test_route_avoids_reported_barrier(client, grid, user_headers):
    o, d = [GRID_LAT, GRID_LNG], [GRID_LAT, GRID_LNG + 2 * STEP]
    before = _route(client, o, d).json()["routes"][0]
    # Barrier in the middle of the direct edge n0_0 -> n0_1.
    rep = client.post("/api/reports", headers=user_headers, json={
        "lat": GRID_LAT, "lng": GRID_LNG + 0.5 * STEP, "category": "sidewalk", "subcategory": "construction",
        "description": "Sidewalk fully closed by construction fencing, no accessible detour.",
    })
    assert rep.status_code == 201
    from app.core.database import SessionLocal
    from app.models import Report

    s = SessionLocal()
    r = s.get(Report, rep.json()["id"])
    r.confidence_score = 0.8  # simulate a corroborated report
    s.commit()
    s.close()
    after = _route(client, o, d).json()["routes"][0]
    assert after["distance_m"] > before["distance_m"]
    assert after["barriers_avoided"] == 1
    assert any("Avoids 1 reported barrier" in e for e in after["explanation"])


def test_route_outside_network(client, grid):
    r = _route(client, [40.7600, -73.9700], [GRID_LAT, GRID_LNG])
    assert r.status_code == 422
