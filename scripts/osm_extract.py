"""Download a pedestrian network and points of interest for Midtown & Lower Manhattan
from the public Overpass API, and write compact JSON files the backend loads.

    python scripts/osm_extract.py              # writes backend/data/*.json
    python scripts/osm_extract.py --bbox 40.70,-74.02,40.77,-73.96

Only uses the standard library plus httpx (already a backend dependency).
Data © OpenStreetMap contributors, ODbL 1.0."""

import argparse
import json
import math
import sys
import time
from collections import Counter
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "backend" / "data"
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
# south, west, north, east
DEFAULT_BBOX = (40.7080, -74.0100, 40.7620, -73.9700)

WALKABLE = "footway|pedestrian|path|steps|living_street|residential|tertiary|secondary|primary|unclassified|corridor"

NETWORK_QUERY = """
[out:json][timeout:180];
(
  way["highway"~"^({walkable})$"]["footway"!="sidewalk"]["access"!~"^(private|no)$"]({bbox});
)->.ways;
.ways out body geom qt;
(
  node["kerb"]({bbox});
  node["barrier"]({bbox});
  node["highway"="crossing"]({bbox});
  node["highway"="elevator"]({bbox});
)->.tagged;
.tagged out body qt;
"""

POI_QUERY = """
[out:json][timeout:120];
(
  nwr["name"]["amenity"~"^(hospital|clinic|library|townhall|theatre|pharmacy|university|community_centre|post_office|courthouse)$"]({bbox});
  nwr["name"]["railway"="station"]({bbox});
  nwr["name"]["station"="subway"]({bbox});
  nwr["name"]["tourism"~"^(museum|attraction|gallery)$"]({bbox});
  nwr["name"]["leisure"="park"]({bbox});
);
out center tags qt;
"""


def overpass(query: str) -> dict:
    last = None
    for url in ENDPOINTS:
        for attempt in range(2):
            try:
                print(f"  POST {url} (attempt {attempt + 1})", flush=True)
                r = httpx.post(url, data={"data": query}, timeout=240,
                               headers={"User-Agent": "AccessSignal/1.0 (open-source accessibility demo)"})
                r.raise_for_status()
                return r.json()
            except (httpx.HTTPError, ValueError) as e:
                last = e
                time.sleep(5)
    raise RuntimeError(f"Overpass failed: {last}")


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    (lng1, lat1), (lng2, lat2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def parse_incline(v: str | None) -> float | None:
    if not v:
        return None
    v = v.strip().lower()
    if v in ("up", "down", "yes"):
        return 0.06  # tagged as sloped but unquantified
    try:
        if v.endswith("%"):
            return abs(float(v[:-1])) / 100
        if v.endswith("°"):
            return abs(math.tan(math.radians(float(v[:-1]))))
        return abs(float(v)) / 100
    except ValueError:
        return None


def edge_attributes(tags: dict, node_tags: list[dict]) -> dict:
    hw = tags.get("highway")
    attrs = {
        "highway": hw,
        "surface": tags.get("surface"),
        "smoothness": tags.get("smoothness"),
        "incline": parse_incline(tags.get("incline")),
        "width": tags.get("width"),
        "wheelchair": tags.get("wheelchair"),
        "lit": tags.get("lit"),
        "tactile_paving": tags.get("tactile_paving"),
        "has_steps": hw == "steps",
        "step_count": tags.get("step_count"),
        "ramp_wheelchair": tags.get("ramp:wheelchair"),
        "crossing": tags.get("crossing") or (tags.get("footway") == "crossing" and "yes") or None,
        "sidewalk": tags.get("sidewalk"),
    }
    kerbs = [t.get("kerb") for t in node_tags if t.get("kerb")]
    if kerbs:
        order = {"flush": 0, "no": 0, "lowered": 1, "rolled": 2, "yes": 3, "raised": 4}
        attrs["kerb"] = max(kerbs, key=lambda k: order.get(k, 2))
    else:
        attrs["kerb"] = None
    signals = [t for t in node_tags if t.get("highway") == "crossing"]
    if signals:
        attrs["crossing"] = attrs["crossing"] or signals[0].get("crossing", "yes")
        sound = [t.get("traffic_signals:sound") for t in signals if t.get("traffic_signals:sound")]
        attrs["audible_signal"] = sound[0] if sound else None
        tp = [t.get("tactile_paving") for t in signals if t.get("tactile_paving")]
        attrs["tactile_paving"] = attrs["tactile_paving"] or (tp[0] if tp else None)
    barriers = [t.get("barrier") for t in node_tags if t.get("barrier")]
    attrs["barrier"] = barriers[0] if barriers else None
    return {k: v for k, v in attrs.items() if v is not None and v is not False} | {"has_steps": hw == "steps"}


def build_graph(data: dict) -> dict:
    ways = [e for e in data["elements"] if e["type"] == "way" and "geometry" in e]
    tagged_nodes = {e["id"]: e.get("tags", {}) for e in data["elements"] if e["type"] == "node"}

    use = Counter()
    for w in ways:
        for i, n in enumerate(w["nodes"]):
            use[n] += 2 if i in (0, len(w["nodes"]) - 1) else 1
    node_xy: dict[int, tuple[float, float]] = {}
    edges = []
    for w in ways:
        ids, geom = w["nodes"], w["geometry"]
        if len(ids) != len(geom):
            continue
        tags = w.get("tags", {})
        start = 0
        for i in range(1, len(ids)):
            node_xy[ids[i]] = (round(geom[i]["lon"], 6), round(geom[i]["lat"], 6))
            node_xy[ids[start]] = (round(geom[start]["lon"], 6), round(geom[start]["lat"], 6))
            if use[ids[i]] > 1 or i == len(ids) - 1:
                coords = [[round(g["lon"], 6), round(g["lat"], 6)] for g in geom[start : i + 1]]
                length = sum(haversine(tuple(coords[k]), tuple(coords[k + 1])) for k in range(len(coords) - 1))
                if length > 0.5:
                    ntags = [tagged_nodes[n] for n in ids[start : i + 1] if n in tagged_nodes]
                    edges.append({
                        "u": str(ids[start]), "v": str(ids[i]),
                        "coords": coords, "length": round(length, 1),
                        "name": tags.get("name") or _fallback_name(tags),
                        "attrs": edge_attributes(tags, ntags),
                    })
                start = i
    used_nodes = {e["u"] for e in edges} | {e["v"] for e in edges}
    nodes = {str(k): v for k, v in node_xy.items() if str(k) in used_nodes}
    return {"nodes": nodes, "edges": edges}


def _fallback_name(tags: dict) -> str:
    hw = tags.get("highway")
    if tags.get("footway") == "crossing":
        return "crosswalk"
    return {"steps": "stairs", "footway": "footpath", "path": "path", "pedestrian": "pedestrian plaza",
            "corridor": "indoor corridor"}.get(hw, "unnamed street")


def largest_component(graph: dict) -> dict:
    adj: dict[str, set[str]] = {}
    for e in graph["edges"]:
        adj.setdefault(e["u"], set()).add(e["v"])
        adj.setdefault(e["v"], set()).add(e["u"])
    seen: set[str] = set()
    best: set[str] = set()
    for start in adj:
        if start in seen:
            continue
        comp, stack = set(), [start]
        while stack:
            n = stack.pop()
            if n in comp:
                continue
            comp.add(n)
            stack.extend(adj[n] - comp)
        seen |= comp
        if len(comp) > len(best):
            best = comp
    return {
        "nodes": {k: v for k, v in graph["nodes"].items() if k in best},
        "edges": [e for e in graph["edges"] if e["u"] in best],
    }


def poi_type(tags: dict) -> str:
    if tags.get("station") == "subway" or tags.get("railway") == "station":
        return "transit_station"
    for key in ("amenity", "tourism", "leisure"):
        if key in tags:
            return tags[key]
    return "place"


def build_places(data: dict) -> list[dict]:
    out, seen = [], set()
    for e in data["elements"]:
        tags = e.get("tags", {})
        name = tags.get("name")
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lng = e.get("lon") or (e.get("center") or {}).get("lon")
        if not name or lat is None or (name, poi_type(tags)) in seen:
            continue
        seen.add((name, poi_type(tags)))
        keep = {k: v for k, v in tags.items() if k.startswith(("wheelchair", "toilets", "entrance", "ramp",
                                                               "elevator", "addr:", "level", "tactile"))}
        out.append({
            "osm_id": f"{e['type']}/{e['id']}", "name": name, "place_type": poi_type(tags),
            "lat": round(lat, 6), "lng": round(lng, 6), "tags": keep,
            "address": " ".join(filter(None, [tags.get("addr:housenumber"), tags.get("addr:street")])) or None,
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bbox", help="south,west,north,east", default=",".join(map(str, DEFAULT_BBOX)))
    ap.add_argument("--skip-places", action="store_true")
    args = ap.parse_args()
    bbox = args.bbox
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Fetching pedestrian network...")
    raw = overpass(NETWORK_QUERY.format(walkable=WALKABLE, bbox=bbox))
    graph = largest_component(build_graph(raw))
    graph["meta"] = {"bbox": bbox, "source": "OpenStreetMap via Overpass", "license": "ODbL 1.0",
                     "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    (OUT_DIR / "manhattan_graph.json").write_text(json.dumps(graph, separators=(",", ":")), encoding="utf-8")
    print(f"  {len(graph['nodes'])} nodes, {len(graph['edges'])} edges")

    if not args.skip_places:
        print("Fetching points of interest...")
        places = build_places(overpass(POI_QUERY.format(bbox=bbox)))
        (OUT_DIR / "manhattan_places.json").write_text(json.dumps(places, indent=0), encoding="utf-8")
        print(f"  {len(places)} places")
    return 0


if __name__ == "__main__":
    sys.exit(main())
