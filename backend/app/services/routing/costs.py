"""Per-profile edge costs. Costs are metres of 'effective distance': never less than
the edge length, so straight-line distance stays an admissible A* heuristic.

Returning None means the edge is impassable for that profile."""

from dataclasses import dataclass, field

ROUGH_SURFACES = {"cobblestone", "sett", "unhewn_cobblestone", "gravel", "fine_gravel", "pebblestone",
                  "dirt", "earth", "grass", "ground", "mud", "sand", "unpaved", "wood", "woodchips"}
PAVED_STREETS = {"residential", "tertiary", "secondary", "primary", "unclassified", "living_street"}
BAD_SMOOTHNESS = {"bad", "very_bad", "horrible", "very_horrible", "impassable"}

SPEED_M_PER_MIN = {"wheelchair": 60.0, "reduced_effort": 50.0, "low_vision": 60.0, "standard": 80.0}


@dataclass
class Barrier:
    report_id: str
    category: str
    subcategory: str
    label: str
    severity: float
    confidence: float
    blocks_wheelchair: bool
    lat: float
    lng: float


@dataclass
class EdgeCost:
    cost: float | None
    factors: list[str] = field(default_factory=list)
    unknown: list[str] = field(default_factory=list)


def is_crossing(attrs: dict) -> bool:
    """A mapped crosswalk segment. Street centerlines also pass through crossing nodes,
    but the kerb and signal data only describe the footway=crossing segment."""
    return bool(attrs.get("crossing")) and attrs.get("highway") not in PAVED_STREETS


def unknown_attributes(attrs: dict, profile: str) -> list[str]:
    hw = attrs.get("highway")
    missing = []
    if hw not in PAVED_STREETS and hw != "steps" and not attrs.get("surface"):
        missing.append("surface")
    crossing = is_crossing(attrs)
    if crossing and profile in ("wheelchair", "reduced_effort") and not attrs.get("kerb"):
        missing.append("kerb")
    if crossing and profile == "low_vision":
        if not attrs.get("tactile_paving"):
            missing.append("tactile_paving")
        if not attrs.get("audible_signal"):
            missing.append("audible_signal")
    return missing


def base_cost(length: float, attrs: dict, profile: str) -> EdgeCost:
    """Static cost from OSM tags only (no live reports)."""
    f = 1.0
    why: list[str] = []
    steps = bool(attrs.get("has_steps"))
    incline = attrs.get("incline")
    surface = attrs.get("surface")
    rough = surface in ROUGH_SURFACES or attrs.get("smoothness") in BAD_SMOOTHNESS
    kerb = attrs.get("kerb")

    if profile == "wheelchair":
        if steps and attrs.get("ramp_wheelchair") != "yes":
            return EdgeCost(None, ["stairs"])
        if kerb in ("raised", "yes"):
            return EdgeCost(None, ["raised kerb"])
        if attrs.get("wheelchair") == "no":
            return EdgeCost(None, ["tagged not wheelchair accessible"])
        if incline is not None:
            if incline > 0.10:
                f *= 8.0
                why.append(f"very steep ({incline:.0%})")
            elif incline > 0.08:
                f *= 4.0
                why.append(f"steep ({incline:.0%})")
            elif incline > 0.05:
                f *= 1.8
                why.append(f"moderate slope ({incline:.0%})")
        if rough:
            f *= 3.0
            why.append(f"rough surface ({surface or attrs.get('smoothness')})")
        if kerb == "rolled":
            f *= 1.3
    elif profile == "reduced_effort":
        if steps:
            f *= 3.0
            why.append("stairs")
        if incline is not None and incline > 0.03:
            f *= 1.0 + incline * 15
            why.append(f"slope {incline:.0%}")
        if rough:
            f *= 2.0
            why.append("rough surface")
    elif profile == "low_vision":
        if steps and attrs.get("tactile_paving") != "yes":
            f *= 1.5
            why.append("stairs without tactile warning")
        if is_crossing(attrs):
            if attrs.get("audible_signal") != "yes":
                f *= 1.4
                why.append("crossing without confirmed audible signal")
            if attrs.get("tactile_paving") == "no":
                f *= 1.3
        if attrs.get("lit") == "no":
            f *= 1.3
            why.append("unlit")
    else:  # standard
        if steps:
            f *= 1.1

    return EdgeCost(length * f, why, unknown_attributes(attrs, profile))


def apply_barriers(ec: EdgeCost, length: float, barriers: list[Barrier], profile: str) -> EdgeCost:
    if ec.cost is None or not barriers:
        return ec
    cost = ec.cost
    why = list(ec.factors)
    for b in barriers:
        weight = b.severity * (0.4 + 0.6 * b.confidence)
        if profile == "wheelchair" and b.blocks_wheelchair and b.severity >= 0.75 and b.confidence >= 0.35:
            return EdgeCost(None, why + [f"reported barrier: {b.label}"], ec.unknown)
        if profile == "standard":
            cost += length * 0.2 * weight
        else:
            cost += max(150.0, length * 6.0) * weight
        why.append(f"reported barrier: {b.label}")
    return EdgeCost(cost, why, ec.unknown)


RISK_WEIGHT = 1.5  # extra effective metres per metre of edge at risk 1.0


def apply_risk(ec: EdgeCost, length: float, risk: float) -> EdgeCost:
    """Corridor risk from intelligence/risk.py. Only ever adds cost, so cost stays >= length."""
    if ec.cost is None or risk <= 0:
        return ec
    return EdgeCost(ec.cost + length * RISK_WEIGHT * min(1.0, risk), ec.factors + [f"corridor risk {risk:.2f}"],
                    ec.unknown)

def unknown_penalty(cost: float, unknown: list[str], avoid_unknown: bool) -> float:
    if not unknown:
        return cost
    return cost * ((1.6 if avoid_unknown else 1.15) ** len(unknown))
