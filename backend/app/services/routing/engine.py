"""Accessibility-aware pedestrian routing over an OSM-derived graph.

The graph lives in the path_edges table and is held in memory as an undirected
NetworkX graph. Live barrier reports are mapped to nearby edges on each request,
so a new report changes routes immediately without rebuilding the graph."""

import math
import threading
from collections import defaultdict
from datetime import UTC, datetime
from dataclasses import dataclass

import networkx as nx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.taxonomy import subcategory_info
from app.models import PathEdge, Report
from app.services.intelligence.risk import FORMULA, HIGH_RISK, corridor_risk
from app.services.routing.costs import (
    SPEED_M_PER_MIN,
    apply_risk,
    Barrier,
    apply_barriers,
    base_cost,
    unknown_penalty,
)
from app.utils.geo import haversine_m, point_to_segment_m

CELL = 0.002  # ~170-220 m grid cells for spatial lookups
BARRIER_SNAP_M = 25.0
MAX_SNAP_M = 400.0


class RoutingError(ValueError):
    pass


def _cell(lng: float, lat: float) -> tuple[int, int]:
    return int(math.floor(lng / CELL)), int(math.floor(lat / CELL))


@dataclass
class EdgeData:
    id: str
    u: str
    v: str
    coords: list[list[float]]
    length: float
    name: str
    attrs: dict


class RoutingGraph:
    def __init__(self, edges: list[EdgeData]):
        self.G = nx.Graph()
        self.nodes: dict[str, tuple[float, float]] = {}
        self.edges: dict[str, EdgeData] = {}
        self.node_grid: dict[tuple[int, int], list[str]] = defaultdict(list)
        self.edge_grid: dict[tuple[int, int], set[str]] = defaultdict(set)
        for e in edges:
            if e.u == e.v:
                continue
            existing = self.G.get_edge_data(e.u, e.v)
            if existing and self.edges[existing["id"]].length <= e.length:
                continue
            self.edges[e.id] = e
            self.G.add_edge(e.u, e.v, id=e.id)
            self.nodes[e.u] = tuple(e.coords[0])
            self.nodes[e.v] = tuple(e.coords[-1])
            for lng, lat in e.coords:
                self.edge_grid[_cell(lng, lat)].add(e.id)
        for nid, (lng, lat) in self.nodes.items():
            self.node_grid[_cell(lng, lat)].append(nid)

    @property
    def size(self) -> dict:
        return {"nodes": self.G.number_of_nodes(), "edges": self.G.number_of_edges()}

    def nearest_node(self, lat: float, lng: float) -> tuple[str, float]:
        cx, cy = _cell(lng, lat)
        best, best_d = None, float("inf")
        for ring in range(0, 4):
            for dx in range(-ring, ring + 1):
                for dy in range(-ring, ring + 1):
                    if max(abs(dx), abs(dy)) != ring:
                        continue
                    for nid in self.node_grid.get((cx + dx, cy + dy), ()):
                        nlng, nlat = self.nodes[nid]
                        d = haversine_m(lat, lng, nlat, nlng)
                        if d < best_d:
                            best, best_d = nid, d
            if best is not None and ring >= 1:
                break
        if best is None:
            raise RoutingError("No walkable path found near that point")
        return best, best_d

    def edges_near(self, lat: float, lng: float, radius_m: float) -> list[tuple[str, float]]:
        cx, cy = _cell(lng, lat)
        ids: set[str] = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                ids |= self.edge_grid.get((cx + dx, cy + dy), set())
        out = []
        for eid in ids:
            c = self.edges[eid].coords
            d = min(point_to_segment_m(lat, lng, tuple(c[i]), tuple(c[i + 1])) for i in range(len(c) - 1))
            if d <= radius_m:
                out.append((eid, d))
        return out


_graph: RoutingGraph | None = None
_lock = threading.Lock()


def load_graph(db: Session, force: bool = False) -> RoutingGraph:
    global _graph
    with _lock:
        if _graph is None or force:
            rows = db.scalars(select(PathEdge)).all()
            _graph = RoutingGraph([
                EdgeData(r.id, r.from_node, r.to_node, r.coords, r.length_m, r.name or "unnamed street",
                         r.accessibility_attributes or {})
                for r in rows
            ])
        return _graph


def reset_graph() -> None:
    global _graph
    with _lock:
        _graph = None


def active_barriers(db: Session, g: RoutingGraph) -> dict[str, list[Barrier]]:
    reports = db.scalars(
        select(Report).where(Report.deleted_at.is_(None), Report.status == "open", Report.duplicate_of.is_(None))
    ).all()
    by_edge: dict[str, list[Barrier]] = defaultdict(list)
    for r in reports:
        if r.category in ("restroom", "wayfinding"):
            continue  # these don't affect passability of the path itself
        info = subcategory_info(r.category, r.subcategory)
        b = Barrier(r.id, r.category, r.subcategory, info["label"], r.severity_score, r.confidence_score,
                    info["blocks_wheelchair"], r.lat, r.lng)
        near = g.edges_near(r.lat, r.lng, BARRIER_SNAP_M)
        if not near:
            continue
        # Attach to the closest edge plus any equally close (corner reports touch several).
        dmin = min(d for _, d in near)
        for eid, d in near:
            if d <= dmin + 5:
                by_edge[eid].append(b)
    return by_edge


def _bearing(a: list[float], b: list[float]) -> float:
    lng1, lat1, lng2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lng2 - lng1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lng2 - lng1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _turn(prev: float, nxt: float) -> str:
    delta = (nxt - prev + 540) % 360 - 180
    if abs(delta) < 25:
        return "Continue"
    if abs(delta) > 150:
        return "Turn around"
    side = "right" if delta > 0 else "left"
    return f"Turn {side}" if abs(delta) >= 60 else f"Bear {side}"


class Router:
    def __init__(self, db: Session, now: datetime | None = None):
        self.db = db
        self.g = load_graph(db)
        self.barriers = active_barriers(db, self.g)
        self.now = now or datetime.now(UTC)
        self._risk_cache: dict[str, dict] | None = None

    # -------------------------------------------------------------- cost

    def _edge_cost(self, eid: str, profile: str, avoid_unknown: bool, with_barriers: bool = True,
                   reliable: bool = False):
        e = self.g.edges[eid]
        ec = base_cost(e.length, e.attrs, profile)
        if with_barriers:
            ec = apply_barriers(ec, e.length, self.barriers.get(eid, []), profile)
        if reliable:
            ec = apply_risk(ec, e.length, self._risk_map().get(eid, {}).get("risk", 0.0))
        if ec.cost is not None:
            ec.cost = unknown_penalty(ec.cost, ec.unknown, avoid_unknown)
        return ec

    def _path(self, s: str, t: str, profile: str, avoid_unknown: bool, penalty: dict[str, float],
              with_barriers: bool = True, reliable: bool = False) -> list[str] | None:
        cache: dict[str, float | None] = {}

        def weight(u, v, d):
            eid = d["id"]
            if eid not in cache:
                cache[eid] = self._edge_cost(eid, profile, avoid_unknown, with_barriers, reliable).cost
            c = cache[eid]
            return None if c is None else c * penalty.get(eid, 1.0)

        def h(a, b):
            (alng, alat), (blng, blat) = self.g.nodes[a], self.g.nodes[b]
            return haversine_m(alat, alng, blat, blng)

        try:
            return nx.astar_path(self.g.G, s, t, heuristic=h, weight=weight)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None

    # -------------------------------------------------------------- public

    def route(self, origin: tuple[float, float], destination: tuple[float, float], profile: str,
              avoid_unknown: bool = False, alternatives: int = 2, prefer_reliable: bool = False) -> dict:
        s, ds = self.g.nearest_node(*origin)
        t, dt = self.g.nearest_node(*destination)
        warnings = []
        if ds > MAX_SNAP_M or dt > MAX_SNAP_M:
            raise RoutingError("Start or end is outside the mapped pedestrian network")
        if ds > 60:
            warnings.append(f"Start point is {int(ds)} m from the nearest mapped path")
        if dt > 60:
            warnings.append(f"Destination is {int(dt)} m from the nearest mapped path")
        if s == t:
            raise RoutingError("Start and destination are the same point on the network")

        baseline_nodes = self._path(s, t, "standard", False, {}, with_barriers=False)
        baseline = self._summarise(baseline_nodes, "standard", False) if baseline_nodes else None

        found: list[list[str]] = []
        penalty: dict[str, float] = {}
        for _ in range(alternatives + 1 + 2):  # a couple of extra tries to find distinct paths
            nodes = self._path(s, t, profile, avoid_unknown, penalty, reliable=prefer_reliable)
            if nodes is None:
                break
            eids = self._edge_ids(nodes)
            if all(self._overlap(eids, self._edge_ids(f)) < 0.75 for f in found):
                found.append(nodes)
            for eid in eids:
                penalty[eid] = penalty.get(eid, 1.0) * 1.6
            if len(found) >= alternatives + 1:
                break

        if not found:
            blockers = self._blocking_barriers(baseline_nodes) if baseline_nodes else []
            msg = "No route meets this accessibility profile."
            if blockers:
                msg += " Blocked by: " + "; ".join(sorted({b.label for b in blockers}))
            raise RoutingError(msg)

        routes = []
        for i, nodes in enumerate(found):
            summary = self._summarise(nodes, profile, avoid_unknown, reliable=prefer_reliable)
            label = "Recommended" if i == 0 else f"Alternative {i}"
            summary["label"] = label
            summary["explanation"] = self._explain(summary, baseline, profile, i)
            if prefer_reliable and i == 0:
                summary["risk"] = self._risk_report(nodes, baseline_nodes)
                summary["explanation"].insert(0, summary["risk"]["summary"])
            routes.append(summary)
        return {"profile": profile, "routes": routes, "warnings": warnings}

    def shortest_walk_m(self, origin: tuple[float, float], destination: tuple[float, float]) -> float | None:
        """Length of the plain shortest walk, ignoring profiles and reports. Used as the
        baseline for detour limits. Returns None when no path connects the two points."""
        s, _ = self.g.nearest_node(*origin)
        t, _ = self.g.nearest_node(*destination)
        nodes = self._path(s, t, "standard", False, {}, with_barriers=False)
        if nodes is None:
            return None
        return round(sum(self.g.edges[eid].length for eid in self._edge_ids(nodes)), 1)

    # -------------------------------------------------------------- helpers

    def _risk_map(self) -> dict[str, dict]:
        if self._risk_cache is None:
            self._risk_cache = corridor_risk(self.db, self.g, self.barriers, self.now)
        return self._risk_cache

    def _risk_report(self, nodes: list[str], baseline_nodes: list[str] | None) -> dict:
        """Which high-risk streets the shortest walk uses that this route doesn't, and what it costs in metres."""
        risk_map = self._risk_map()

        def risky(ns: list[str]) -> dict[str, dict]:
            out: dict[str, dict] = {}
            for eid in self._edge_ids(ns):
                r = risk_map.get(eid)
                if r and r["risk"] >= HIGH_RISK:
                    out.setdefault(self.g.edges[eid].name, r)
            return out

        base = risky(baseline_nodes) if baseline_nodes else {}
        on_route = risky(nodes)
        avoided = sorted(set(base) - set(on_route))
        route_m = sum(self.g.edges[eid].length for eid in self._edge_ids(nodes))
        base_m = sum(self.g.edges[eid].length for eid in self._edge_ids(baseline_nodes)) if baseline_nodes else route_m
        extra = route_m - base_m
        n = len(avoided)
        if n:
            summary = (f"Avoids {n} high-risk corridor{'s' if n != 1 else ''} ({', '.join(avoided[:3])}), "
                       f"{extra:+.0f} m compared with the shortest walk.")
        else:
            summary = (f"No high-risk corridor on the shortest walk is avoided. "
                       f"This route is {extra:+.0f} m compared with it.")
        return {
            "enabled": True, "threshold": HIGH_RISK, "high_risk_avoided": n, "avoided_streets": avoided,
            "extra_m": round(extra, 1), "summary": summary, "formula": FORMULA,
            "on_route": [{"street": name, **r} for name, r in on_route.items()][:10],
        }

    def shortest_walk_coords(self, origin: tuple[float, float], destination: tuple[float, float]) -> list[list[float]] | None:
        """The shortest walk's line as [lng, lat] points, ignoring profiles and reports."""
        s, _ = self.g.nearest_node(*origin)
        t, _ = self.g.nearest_node(*destination)
        nodes = self._path(s, t, "standard", False, {}, with_barriers=False)
        if nodes is None:
            return None
        coords: list[list[float]] = []
        for a, b in zip(nodes, nodes[1:]):
            e = self.g.edges[self.g.G[a][b]["id"]]
            seg = e.coords if tuple(e.coords[0]) == self.g.nodes[a] else list(reversed(e.coords))
            coords.extend(seg if not coords else seg[1:])
        return coords

    def _edge_ids(self, nodes: list[str]) -> list[str]:
        return [self.g.G[a][b]["id"] for a, b in zip(nodes, nodes[1:])]

    @staticmethod
    def _overlap(a: list[str], b: list[str]) -> float:
        sa, sb = set(a), set(b)
        return len(sa & sb) / max(1, min(len(sa), len(sb)))

    def _blocking_barriers(self, nodes: list[str]) -> list[Barrier]:
        out = []
        for eid in self._edge_ids(nodes):
            out.extend(self.barriers.get(eid, []))
        return out

    def _summarise(self, nodes: list[str], profile: str, avoid_unknown: bool, reliable: bool = False) -> dict:
        segments: list[dict] = []
        coords_all: list[list[float]] = []
        total_len = total_cost = unknown_len = quality_len = 0.0
        barriers_seen: dict[str, Barrier] = {}
        steepest = (0.0, "")
        prev_bearing = None

        for a, b in zip(nodes, nodes[1:]):
            eid = self.g.G[a][b]["id"]
            e = self.g.edges[eid]
            coords = e.coords if tuple(e.coords[0]) == self.g.nodes[a] else list(reversed(e.coords))
            ec = self._edge_cost(eid, profile, avoid_unknown, reliable=reliable)
            cost = ec.cost if ec.cost is not None else e.length * 10
            total_len += e.length
            total_cost += cost
            quality_len += e.length * min(1.0, e.length / cost) if cost > 0 else e.length
            if ec.unknown:
                unknown_len += e.length
            inc = e.attrs.get("incline")
            if inc and inc > steepest[0]:
                steepest = (inc, e.name)
            edge_barriers = self.barriers.get(eid, [])
            for bar in edge_barriers:
                barriers_seen[bar.report_id] = bar

            bearing = _bearing(coords[0], coords[min(1, len(coords) - 1)])
            same_street = segments and segments[-1]["name"] == e.name
            if same_street:
                seg = segments[-1]
                seg["length_m"] += e.length
                seg["coords"].extend(coords[1:])
                seg["unknown_attributes"] = sorted(set(seg["unknown_attributes"]) | set(ec.unknown))
                seg["has_steps"] = seg["has_steps"] or bool(e.attrs.get("has_steps"))
                seg["barriers"].extend(self._barrier_dict(x) for x in edge_barriers)
            else:
                turn = "Start" if prev_bearing is None else _turn(prev_bearing, bearing)
                segments.append({
                    "name": e.name,
                    "length_m": e.length,
                    "instruction": self._instruction(turn, e),
                    "surface": e.attrs.get("surface"),
                    "incline": e.attrs.get("incline"),
                    "kerb": e.attrs.get("kerb"),
                    "has_steps": bool(e.attrs.get("has_steps")),
                    "unknown_attributes": list(ec.unknown),
                    "barriers": [self._barrier_dict(x) for x in edge_barriers],
                    "coords": [list(c) for c in coords],
                })
            prev_bearing = _bearing(coords[-2], coords[-1]) if len(coords) > 1 else bearing
            coords_all.extend(coords if not coords_all else coords[1:])

        for seg in segments:
            seg["length_m"] = round(seg["length_m"], 1)
            n = seg["length_m"]
            text = "a few metres" if n < 10 else f"{int(round(n, -1))} m"
            seg["instruction"] = (seg["instruction"].replace(" and continue {len}", "" if n < 10 else f" and continue {text}")
                                  .replace(" for {len}", "" if n < 10 else f" for {text}")
                                  .replace("{len}", text))
        speed = SPEED_M_PER_MIN.get(profile, 70.0)
        return {
            "distance_m": round(total_len, 1),
            "duration_min": round(total_len / speed, 1),
            "cost": round(total_cost, 1),
            "accessibility_score": round(quality_len / total_len, 3) if total_len else 1.0,
            "unknown_share": round(unknown_len / total_len, 3) if total_len else 0.0,
            "barriers_on_route": len(barriers_seen),
            "barriers_avoided": 0,
            "_barrier_ids": set(barriers_seen),
            "_steepest": steepest,
            "geometry": {"type": "LineString", "coordinates": coords_all},
            "segments": segments,
        }

    @staticmethod
    def _barrier_dict(b: Barrier) -> dict:
        return {"report_id": b.report_id, "label": b.label, "severity": b.severity, "confidence": b.confidence}

    @staticmethod
    def _instruction(turn: str, e: EdgeData) -> str:
        name = e.name
        if e.attrs.get("has_steps"):
            return f"{turn} up or down the stairs ({{len}})"
        if name == "crosswalk":
            kerb = e.attrs.get("kerb")
            k = f", kerb {kerb}" if kerb else ""
            return f"{turn} and cross at the crosswalk{k}"
        if turn == "Start":
            return f"Start on {name} and continue {{len}}"
        if turn == "Continue":
            return f"Continue onto {name} for {{len}}"
        return f"{turn} onto {name} and continue {{len}}"

    def _explain(self, r: dict, baseline: dict | None, profile: str, index: int) -> list[str]:
        out = []
        if baseline:
            avoided = baseline["_barrier_ids"] - r["_barrier_ids"]
            r["barriers_avoided"] = len(avoided)
            if avoided:
                labels = sorted({self._label_for(rid) for rid in avoided})
                out.append(f"Avoids {len(avoided)} reported barrier{'s' if len(avoided) > 1 else ''} on the "
                           f"shortest walking route: {', '.join(labels)}.")
            extra = r["distance_m"] - baseline["distance_m"]
            if extra > 20:
                pct = extra / baseline["distance_m"] * 100
                out.append(f"{int(round(extra, -1))} m longer (+{pct:.0f}%) than the shortest walking route.")
            elif profile != "standard":
                out.append("Matches the shortest walking route closely.")
        if r["barriers_on_route"]:
            out.append(f"Passes {r['barriers_on_route']} reported issue{'s' if r['barriers_on_route'] > 1 else ''} "
                       "that this profile can work around. Check segment details.")
        if r["unknown_share"] > 0.05:
            out.append(f"{r['unknown_share']:.0%} of the route has missing surface or kerb data.")
        inc, name = r["_steepest"]
        if inc >= 0.04:
            out.append(f"Steepest section about {inc:.0%} on {name}.")
        if profile == "wheelchair" and index == 0:
            out.append("No stairs or raised kerbs mapped on this route.")
        r.pop("_barrier_ids", None)
        r.pop("_steepest", None)
        return out

    def _label_for(self, report_id: str) -> str:
        for bs in self.barriers.values():
            for b in bs:
                if b.report_id == report_id:
                    return b.label.lower()
        return "barrier"
