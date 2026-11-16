"""Load the routing graph, OSM places and the Manhattan demo narrative.

    python -m scripts.seed_demo            # seed if the database is empty
    python -m scripts.seed_demo --reset    # drop everything and reseed (demo reset)

Demo accounts share the password in DEMO_PASSWORD (default below). They exist for
local demos only; never run this against a real deployment."""

import argparse
import json
import os
import random
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, insert, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.database import Base, SessionLocal, engine, init_db  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.domain.taxonomy import CATEGORIES, priority_for_severity, subcategory_info  # noqa: E402
from app.models import Evidence, Issue, IssueHistory, PathEdge, Place, Report, User  # noqa: E402
from app.services import places as place_service  # noqa: E402
from app.services.intelligence.confidence import refresh_confidence  # noqa: E402
from app.services.intelligence.hotspots import recalculate_hotspots  # noqa: E402
from app.services.routing.costs import base_cost  # noqa: E402
from app.services.routing.engine import reset_graph  # noqa: E402
from app.utils.geo import haversine_m, in_service_area  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "Signal-demo-2026")
NOW = datetime.now(UTC)
rng = random.Random(20261116)


def ago(days: float = 0, hours: float = 0) -> datetime:
    return NOW - timedelta(days=days, hours=hours)


USERS = [
    ("admin@city.example.org", "Site Admin", "admin"),
    ("dana.whitfield@city.example.org", "Dana Whitfield (DOT liaison)", "infrastructure_manager"),
    ("marcus.oyelaran@city.example.org", "Marcus Oyelaran (MTA accessibility)", "infrastructure_manager"),
    ("priya.raman@example.org", "Priya Raman", "user"),
    ("tomas.rivera@example.org", "Tomás Rivera", "user"),
    ("june.park@example.org", "June Park", "user"),
    ("eli.brennan@example.org", "Eli Brennan", "user"),
    ("ana.sousa@example.org", "Ana Sousa", "user"),
    ("kwame.asante@example.org", "Kwame Asante", "user"),
    ("rosa.delgado@example.org", "Rosa Delgado", "user"),
]

CURATED_PLACES = [
    # key, name, type, lat, lng, address, osm-style tags, match token
    ("nyu", "NYU Langone Health, Tisch Hospital", "hospital", 40.74205, -73.97395, "550 1st Ave",
     {"wheelchair": "yes", "toilets:wheelchair": "yes", "elevator": "yes"}, "langone"),
    ("herald", "34 St–Herald Sq Station", "transit_station", 40.74970, -73.98780, "W 34th St & 6th Ave",
     {"wheelchair": "yes", "elevator": "yes"}, "herald"),
    ("union", "Union Square, Broadway & E 14th St corner", "park", 40.73490, -73.99060, "Broadway & E 14th St",
     {"wheelchair": "yes"}, "union square"),
    ("gct", "Grand Central Terminal", "transit_station", 40.75270, -73.97720, "89 E 42nd St",
     {"wheelchair": "yes", "toilets:wheelchair": "yes", "elevator": "yes", "ramp:wheelchair": "yes"}, "grand central"),
    ("les", "Orchard St between Rivington & Stanton", "place", 40.72060, -73.98930, "Orchard St", {}, "orchard"),
    ("nypl", "Stavros Niarchos Foundation Library", "library", 40.75240, -73.98110, "455 5th Ave",
     {"wheelchair": "yes", "toilets:wheelchair": "yes", "elevator": "yes", "automatic_door": "yes"}, "niarchos"),
    ("penn", "Penn Station (LIRR / NJ Transit)", "transit_station", 40.75060, -73.99350, "W 33rd St & 8th Ave",
     {"wheelchair": "yes", "elevator": "yes"}, "penn"),
    ("bellevue", "NYC Health + Hospitals/Bellevue", "hospital", 40.73900, -73.97570, "462 1st Ave",
     {"wheelchair": "yes", "toilets:wheelchair": "yes"}, "bellevue"),
]

TEMPLATES: dict[str, list[str]] = {
    "blocked_ramp": ["Delivery van parked across the curb ramp, had to go into the street to get around it.",
                     "Ramp blocked by stacked crates from the store next door."],
    "steep_ramp": ["Ramp up to the side entrance is much steeper than code, my chair tips back."],
    "damaged_ramp": ["Concrete on the ramp is cracked and a chunk is missing near the bottom."],
    "missing_handrail": ["Handrail on the ramp has been removed, only bolts left."],
    "out_of_service": ["Elevator has an out of service sign, staff said no estimate for repair."],
    "station_elevator_outage": ["Street elevator to the platform is out. No sign about the nearest working one."],
    "missing_curb_cut": ["No curb cut on this corner, the crosswalk ends at a 6 inch curb."],
    "broken_pavement": ["Sidewalk slabs heaved by tree roots, my front casters catch on the edge.",
                        "Large pothole in the crosswalk right where the curb ramp ends."],
    "obstruction": ["Restaurant shed and sandwich boards leave less than 3 feet of sidewalk.",
                    "Trash bags piled across most of the sidewalk on collection night."],
    "construction": ["Scaffolding with no covered accessible walkway, pedestrians sent into the bike lane.",
                     "Sidewalk closed for construction, detour sign points to a crossing with no curb ramp."],
    "narrow_sidewalk": ["Sidewalk pinches to about a metre between the subway grate and a newsstand."],
    "no_audible_signal": ["No accessible pedestrian signal at this crossing, hard to know when to go."],
    "short_signal": ["Walk signal is too short to cross the avenue at a slower pace."],
    "missing_tactile_paving": ["Curb ramp has no detectable warning strip, easy to walk into traffic."],
    "platform_gap": ["Big gap between the platform and the train on the curve."],
    "step_at_entrance": ["One step up at the entrance, no ramp and no bell to ask for help."],
    "heavy_door": ["Automatic door opener is broken, door is too heavy to open from a wheelchair."],
    "entrance_closed": ["Accessible side entrance locked, guard said to use the front which has stairs."],
    "restroom_locked": ["Accessible restroom locked and staff couldn't find the key."],
    "no_braille_signage": ["Elevator buttons have no braille labels."],
    "poor_lighting": ["Underpass is very dark, hard to see the uneven surface."],
}


def load_graph(db) -> dict:
    path = get_settings().graph_path
    if not path.exists():
        print(f"! {path} missing. Run: python scripts/osm_extract.py  (routing disabled until then)")
        return {"nodes": {}, "edges": []}
    g = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for e in g["edges"]:
        w = base_cost(e["length"], e["attrs"], "wheelchair").cost
        rows.append({
            "id": str(uuid.uuid4()), "from_node": e["u"], "to_node": e["v"], "coords": e["coords"],
            "length_m": e["length"], "name": e["name"], "accessibility_attributes": e["attrs"],
            "wheelchair_cost": w if w is not None else -1.0,
            "walking_cost": base_cost(e["length"], e["attrs"], "standard").cost,
            "source": "osm",
        })
    for i in range(0, len(rows), 2000):
        db.execute(insert(PathEdge), rows[i:i + 2000])
    db.commit()
    print(f"  {len(rows)} path edges")
    return g


def load_places(db) -> dict[str, Place]:
    path = DATA / "manhattan_places.json"
    osm = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    created: list[Place] = []
    for p in osm:
        if not in_service_area(p["lat"], p["lng"]):
            continue
        place = Place(name=p["name"][:200], place_type=p["place_type"], lat=p["lat"], lng=p["lng"],
                      address=p.get("address"), osm_id=p["osm_id"], osm_tags=p.get("tags", {}))
        place_service.init_osm_features(place)
        place_service.recompute_verification(place)
        db.add(place)
        created.append(place)
    db.flush()

    curated: dict[str, Place] = {}
    for key, name, ptype, lat, lng, addr, tags, token in CURATED_PLACES:
        match = next((p for p in created if token in p.name.lower() and haversine_m(lat, lng, p.lat, p.lng) < 250), None)
        if match:
            match.name, match.place_type, match.lat, match.lng, match.address = name, ptype, lat, lng, addr
            match.osm_tags = {**(match.osm_tags or {}), **tags}
            match.features.clear()
            db.flush()
            place = match
        else:
            place = Place(name=name, place_type=ptype, lat=lat, lng=lng, address=addr, osm_tags=tags)
            db.add(place)
        place_service.init_osm_features(place)
        place_service.recompute_verification(place)
        curated[key] = place
    db.flush()
    print(f"  {len(created)} OSM places, {len(curated)} curated")
    return curated


def make_report(db, user: User, lat, lng, cat, sub, desc, when, address, place=None, ai=True,
                voice: str | None = None) -> Report:
    info = subcategory_info(cat, sub)
    r = Report(user_id=user.id, place_id=place.id if place else None, lat=lat, lng=lng, address=address,
               category=cat, subcategory=sub, description=desc, severity_score=info["severity"],
               reported_at=when, user_confirmed=True, status="open")
    if ai:
        r.ai_analysis = {"category": cat, "subcategory": sub, "severity": info["severity"],
                         "summary": desc.split(".")[0][:160], "detected_features": [], "confidence": 0.7,
                         "source": "heuristic", "model": None}
    db.add(r)
    db.flush()
    if voice:
        db.add(Evidence(report_id=r.id, type="voice", file_path=None, mime_type=None, transcription=voice,
                        meta={"seeded": True, "note": "Transcript only in demo data"}, created_at=when))
    return r


def add_issue(db, r: Report, history: list[tuple[str, User | None, str | None, datetime]],
              assignee: User | None = None, resolution: str | None = None) -> Issue:
    issue = Issue(report_id=r.id, status="reported", priority=priority_for_severity(r.severity_score),
                  created_at=r.reported_at, updated_at=r.reported_at)
    issue.history.append(IssueHistory(old_status=None, new_status="reported", notes="Created from community report",
                                      changed_at=r.reported_at))
    db.add(issue)
    prev = "reported"
    for status, actor, note, when in history:
        if status == "assigned" and assignee:
            issue.assigned_to = assignee.id
        issue.history.append(IssueHistory(changed_by=actor.id if actor else None, old_status=prev, new_status=status,
                                          notes=note, changed_at=when))
        issue.status = status
        issue.updated_at = when
        if status == "resolved":
            issue.resolved_at = when
            issue.resolution_notes = resolution
            r.status = "resolved"
            r.resolved_at = when
        prev = status
    return issue


def narrative(db, u: dict[str, User], places: dict[str, Place]) -> None:
    nyu, herald, union, gct = places["nyu"], places["herald"], places["union"], places["gct"]

    # 1. Hospital ramp blockage: three independent reports over two days.
    r1 = make_report(db, u["priya"], 40.74212, -73.97361, "ramp", "blocked_ramp",
                     "Delivery trucks parked across the wheelchair ramp at the eastern entrance on the FDR side. "
                     "I had to wait 20 minutes for security to move one.", ago(2, 3), "550 1st Ave, east entrance",
                     place=nyu, voice="The ramp by the east doors is blocked again by two box trucks.")
    r1.severity_score = 0.92
    add_issue(db, r1, [("under_review", u["dana"], "Checking with hospital facilities", ago(1, 20)),
                       ("confirmed", u["dana"], "Three independent reports; facilities confirmed loading conflict",
                        ago(0, 18))])
    for who, when, text in [("tomas", ago(1, 9), "Box truck on the east entrance ramp again this morning, "
                                                 "no way in with my mother's wheelchair."),
                            ("eli", ago(0, 7), "Ramp at the hospital east side entry blocked by a delivery truck.")]:
        d = make_report(db, u[who], 40.74209 + rng.uniform(-0.00008, 0.00008), -73.97365 + rng.uniform(-0.00008, 0.00008),
                        "ramp", "blocked_ramp", text, when, "550 1st Ave, east entrance", place=nyu)
        d.status, d.duplicate_of = "duplicate", r1.id

    # 2. Subway elevator outage reported by a low-vision rider.
    r2 = make_report(db, u["june"], 40.74958, -73.98795, "transit", "station_elevator_outage",
                     "Street elevator at the southeast corner of 34th and 6th is out of service. "
                     "The only notice is a paper sign I couldn't read without help.",
                     ago(0, 6), "W 34th St & 6th Ave, SE corner", place=herald,
                     voice="Elevator at Herald Square southeast corner is down, there's just a paper sign.")
    add_issue(db, r2, [("confirmed", u["marcus"], "Confirmed with station agent; outage ticket opened", ago(0, 5)),
                       ("assigned", u["marcus"], "Assigned to MTA elevator maintenance", ago(0, 4)),
                       ("in_progress", u["marcus"], "Technician on site", ago(0, 2))], assignee=u["marcus"])

    # 3. Missing curb cut after sidewalk renovation, caregiver report.
    r3 = make_report(db, u["tomas"], 40.73478, -73.99071, "sidewalk", "missing_curb_cut",
                     "New sidewalk work at the southwest corner of Broadway and 14th removed the curb cut. "
                     "The crosswalk now ends at a full height curb, I had to lift my mother's chair.",
                     ago(5, 2), "Broadway & E 14th St, SW corner", place=union)
    add_issue(db, r3, [("under_review", u["dana"], None, ago(4, 20)),
                       ("confirmed", u["dana"], "Site photos from contractor confirm curb ramp not reinstalled", ago(4)),
                       ("assigned", u["dana"], "Assigned to DOT liaison for contractor follow-up", ago(3, 22))],
              assignee=u["dana"])
    c = make_report(db, u["ana"], 40.73481, -73.99066, "sidewalk", "missing_curb_cut",
                    "Curb ramp missing at Broadway and 14th since the sidewalk renovation.", ago(3, 4),
                    "Broadway & E 14th St", place=union)
    c.status, c.duplicate_of = "duplicate", r3.id

    # 4. Resolved success at Grand Central, now awaiting community reverification.
    r4 = make_report(db, u["kwame"], 40.75245, -73.97700, "ramp", "blocked_ramp",
                     "Ramp at the Vanderbilt Ave entrance blocked by barricades left after an event.",
                     ago(12), "Vanderbilt Ave entrance", place=gct)
    add_issue(db, r4, [("confirmed", u["marcus"], None, ago(11, 18)),
                       ("assigned", u["marcus"], "Assigned to terminal operations", ago(11, 12)),
                       ("in_progress", u["marcus"], None, ago(9)),
                       ("resolved", u["marcus"], "Barricades removed, crew confirmed clear path", ago(3)),
                       ("reverification", None, "Access Monitor: requesting community reverification of the fix",
                        ago(1))],
              assignee=u["marcus"], resolution="Event barricades removed from the ramp and the operations "
                                               "team added the ramp to the post-event clearance checklist.")

    # 5. Lower East Side has no data on purpose: coverage analysis shows the gap.


def background(db, u: dict[str, User], graph: dict) -> None:
    """~45 scattered reports over 12 weeks so trends, hotspots and the dashboard have shape."""
    named = [e for e in graph["edges"] if e["name"] not in ("unnamed street", "footpath", "crosswalk", "stairs")]
    if not named:
        return
    community = [u[k] for k in ("priya", "tomas", "june", "eli", "ana", "kwame", "rosa")]
    subs = [(c, s) for c, info in CATEGORIES.items() for s in info["subcategories"] if s in TEMPLATES]
    weights = [6 if s in ("obstruction", "construction", "broken_pavement", "blocked_ramp") else 2 for _, s in subs]
    # A few streets get repeated reports so hotspots form naturally.
    focus = rng.sample(named, 4)
    for i in range(46):
        edge = rng.choice(focus) if i % 4 == 0 else rng.choice(named)
        lng, lat = edge["coords"][len(edge["coords"]) // 2]
        lat += rng.uniform(-0.00015, 0.00015)
        lng += rng.uniform(-0.00015, 0.00015)
        if not in_service_area(lat, lng):
            continue
        cat, sub = rng.choices(subs, weights)[0]
        when = ago(days=rng.uniform(1, 84))
        r = make_report(db, rng.choice(community), lat, lng, cat, sub, rng.choice(TEMPLATES[sub]), when,
                        edge["name"], ai=rng.random() < 0.7)
        r.severity_score = round(min(1.0, max(0.2, r.severity_score + rng.uniform(-0.1, 0.05))), 2)
        place = place_service.nearest_place(db, lat, lng)
        r.place_id = place.id if place else None
        age = (NOW - when).days
        roll = rng.random()
        if age > 10 and roll < 0.55:
            t1 = when + timedelta(hours=rng.uniform(4, 30))
            t2 = t1 + timedelta(hours=rng.uniform(6, 48))
            t3 = min(ago(0, 2), t2 + timedelta(days=rng.uniform(1, 12)))
            mgr = rng.choice([u["dana"], u["marcus"]])
            add_issue(db, r, [("confirmed", mgr, None, t1), ("assigned", mgr, None, t2),
                              ("in_progress", mgr, None, t2 + timedelta(hours=6)),
                              ("resolved", mgr, "Crew cleared the obstruction / repaired the defect", t3)],
                      assignee=mgr, resolution="Repair completed and inspected by field crew.")
        elif roll < 0.8:
            t1 = when + timedelta(hours=rng.uniform(4, 30))
            add_issue(db, r, [("under_review", u["dana"], None, min(t1, ago(0, 1)))])
        else:
            add_issue(db, r, [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="drop all tables and reseed")
    args = ap.parse_args()

    from app import models  # noqa: F401

    if args.reset:
        print("Dropping tables...")
        Base.metadata.drop_all(bind=engine)
    init_db()
    reset_graph()
    db = SessionLocal()
    try:
        if db.scalar(select(func.count()).select_from(User)):
            print("Database already seeded. Use --reset to start over.")
            return 0
        print("Seeding users...")
        handles = ["admin", "dana", "marcus", "priya", "tomas", "june", "eli", "ana", "kwame", "rosa"]
        pw = hash_password(DEMO_PASSWORD)
        users = {}
        for h, (email, name, role) in zip(handles, USERS, strict=True):
            users[h] = User(email=email, display_name=name, role=role, password_hash=pw, created_at=ago(120))
            db.add(users[h])
        db.flush()
        print("Loading routing graph...")
        graph = load_graph(db)
        print("Loading places...")
        places = load_places(db)
        print("Writing demo narrative...")
        narrative(db, users, places)
        background(db, users, graph)
        db.flush()

        print("Scoring confidence and updating place profiles...")
        reports = db.scalars(select(Report).order_by(Report.reported_at)).all()
        for r in reports:
            db.refresh(r)
            refresh_confidence(db, r)
        for r in reports:
            if r.place_id and r.duplicate_of is None:
                place = db.get(Place, r.place_id)
                place_service.apply_report(db, place, r)
        db.commit()
        print("Calculating hotspots...")
        hs = recalculate_hotspots(db)
        print(f"Done: {len(reports)} reports, {len(hs)} hotspots.")
        print(f"Demo accounts use password: {DEMO_PASSWORD}")
        print("  community: priya.raman@example.org   manager: dana.whitfield@city.example.org")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
