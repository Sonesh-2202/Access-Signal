"""Shared vocabulary for reports, issues and place features.

Base severities are on a 0..1 scale and express how much a barrier blocks a
person who depends on the missing feature (1.0 = fully impassable)."""

from typing import TypedDict


class Subcategory(TypedDict):
    label: str
    severity: float
    blocks_wheelchair: bool


CATEGORIES: dict[str, dict] = {
    "entrance": {
        "label": "Entrance",
        "subcategories": {
            "step_at_entrance": {"label": "Step at entrance", "severity": 0.85, "blocks_wheelchair": True},
            "heavy_door": {"label": "Heavy or manual door", "severity": 0.45, "blocks_wheelchair": False},
            "narrow_doorway": {"label": "Narrow doorway", "severity": 0.7, "blocks_wheelchair": True},
            "entrance_closed": {"label": "Accessible entrance closed", "severity": 0.8, "blocks_wheelchair": True},
        },
    },
    "ramp": {
        "label": "Ramp",
        "subcategories": {
            "blocked_ramp": {"label": "Ramp blocked", "severity": 0.9, "blocks_wheelchair": True},
            "steep_ramp": {"label": "Ramp too steep", "severity": 0.6, "blocks_wheelchair": False},
            "damaged_ramp": {"label": "Ramp damaged", "severity": 0.65, "blocks_wheelchair": False},
            "missing_handrail": {"label": "Missing handrail", "severity": 0.4, "blocks_wheelchair": False},
        },
    },
    "elevator": {
        "label": "Elevator",
        "subcategories": {
            "out_of_service": {"label": "Out of service", "severity": 0.95, "blocks_wheelchair": True},
            "no_elevator": {"label": "No elevator", "severity": 0.8, "blocks_wheelchair": True},
            "small_cabin": {"label": "Cabin too small", "severity": 0.5, "blocks_wheelchair": False},
        },
    },
    "sidewalk": {
        "label": "Sidewalk",
        "subcategories": {
            "missing_curb_cut": {"label": "Missing curb cut", "severity": 0.85, "blocks_wheelchair": True},
            "broken_pavement": {"label": "Broken pavement", "severity": 0.5, "blocks_wheelchair": False},
            "obstruction": {"label": "Obstruction on path", "severity": 0.6, "blocks_wheelchair": False},
            "construction": {"label": "Construction blocking path", "severity": 0.75, "blocks_wheelchair": True},
            "narrow_sidewalk": {"label": "Sidewalk too narrow", "severity": 0.45, "blocks_wheelchair": False},
        },
    },
    "crossing": {
        "label": "Crossing",
        "subcategories": {
            "no_audible_signal": {"label": "No audible signal", "severity": 0.6, "blocks_wheelchair": False},
            "short_signal": {"label": "Signal too short", "severity": 0.5, "blocks_wheelchair": False},
            "missing_tactile_paving": {"label": "Missing tactile paving", "severity": 0.55, "blocks_wheelchair": False},
        },
    },
    "transit": {
        "label": "Transit",
        "subcategories": {
            "station_elevator_outage": {"label": "Station elevator outage", "severity": 0.95, "blocks_wheelchair": True},
            "platform_gap": {"label": "Large platform gap", "severity": 0.6, "blocks_wheelchair": False},
            "no_level_boarding": {"label": "No level boarding", "severity": 0.65, "blocks_wheelchair": False},
        },
    },
    "restroom": {
        "label": "Restroom",
        "subcategories": {
            "no_accessible_restroom": {"label": "No accessible restroom", "severity": 0.55, "blocks_wheelchair": False},
            "restroom_locked": {"label": "Accessible restroom locked", "severity": 0.5, "blocks_wheelchair": False},
        },
    },
    "wayfinding": {
        "label": "Wayfinding",
        "subcategories": {
            "no_braille_signage": {"label": "No braille signage", "severity": 0.4, "blocks_wheelchair": False},
            "poor_lighting": {"label": "Poor lighting", "severity": 0.35, "blocks_wheelchair": False},
            "confusing_layout": {"label": "Confusing layout", "severity": 0.3, "blocks_wheelchair": False},
        },
    },
    "other": {
        "label": "Other",
        "subcategories": {
            "other": {"label": "Other barrier", "severity": 0.4, "blocks_wheelchair": False},
        },
    },
}

PLACE_FEATURES: dict[str, str] = {
    "step_free_entrance": "Step-free entrance",
    "ramp": "Ramp",
    "elevator": "Elevator",
    "automatic_door": "Automatic door",
    "accessible_restroom": "Accessible restroom",
    "tactile_paving": "Tactile paving",
    "audible_signals": "Audible crossing signals",
    "hearing_loop": "Hearing loop",
    "accessible_parking": "Accessible parking",
}

FEATURE_STATUSES = ("available", "limited", "unavailable", "unknown")

# Which place feature a report subcategory speaks to, and the status it implies.
SUBCATEGORY_TO_FEATURE: dict[str, tuple[str, str]] = {
    "step_at_entrance": ("step_free_entrance", "unavailable"),
    "entrance_closed": ("step_free_entrance", "unavailable"),
    "heavy_door": ("automatic_door", "unavailable"),
    "narrow_doorway": ("step_free_entrance", "limited"),
    "blocked_ramp": ("ramp", "unavailable"),
    "steep_ramp": ("ramp", "limited"),
    "damaged_ramp": ("ramp", "limited"),
    "missing_handrail": ("ramp", "limited"),
    "out_of_service": ("elevator", "unavailable"),
    "station_elevator_outage": ("elevator", "unavailable"),
    "no_elevator": ("elevator", "unavailable"),
    "small_cabin": ("elevator", "limited"),
    "no_accessible_restroom": ("accessible_restroom", "unavailable"),
    "restroom_locked": ("accessible_restroom", "limited"),
    "missing_tactile_paving": ("tactile_paving", "unavailable"),
    "no_audible_signal": ("audible_signals", "unavailable"),
}

REPORT_STATUSES = ("open", "duplicate", "resolved", "rejected")

ISSUE_STATUSES = (
    "reported",
    "under_review",
    "confirmed",
    "assigned",
    "in_progress",
    "resolved",
    "reverification",
)

# Allowed issue workflow transitions. "reverification" can reopen or close.
ISSUE_TRANSITIONS: dict[str, set[str]] = {
    "reported": {"under_review", "confirmed"},
    "under_review": {"confirmed", "reported"},
    "confirmed": {"assigned", "under_review"},
    "assigned": {"in_progress", "confirmed"},
    "in_progress": {"resolved", "assigned"},
    "resolved": {"reverification"},
    "reverification": {"resolved", "confirmed"},
}

ISSUE_PRIORITIES = ("low", "medium", "high", "critical")

ROLES = ("user", "infrastructure_manager", "admin")


def is_valid_category(category: str, subcategory: str) -> bool:
    return category in CATEGORIES and subcategory in CATEGORIES[category]["subcategories"]


def subcategory_info(category: str, subcategory: str) -> Subcategory:
    try:
        return CATEGORIES[category]["subcategories"][subcategory]
    except KeyError:
        return CATEGORIES["other"]["subcategories"]["other"]


def priority_for_severity(severity: float) -> str:
    if severity >= 0.85:
        return "critical"
    if severity >= 0.65:
        return "high"
    if severity >= 0.4:
        return "medium"
    return "low"
