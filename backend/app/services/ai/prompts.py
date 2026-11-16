from app.domain.taxonomy import CATEGORIES


def taxonomy_listing() -> str:
    lines = []
    for cat, info in CATEGORIES.items():
        subs = ", ".join(info["subcategories"].keys())
        lines.append(f"- {cat}: {subs}")
    return "\n".join(lines)


SYSTEM_PROMPT = f"""You classify reports of physical accessibility barriers in public spaces in any city.
Reporters are often disabled people, caregivers or transit staff. Be literal: describe what is visible or stated, do not guess beyond the evidence.

Choose exactly one category and subcategory from this list (use the keys verbatim):
{taxonomy_listing()}
If the report does not fit the taxonomy, choose the closest category and say so in the summary.

Severity is 0.0 to 1.0: how much the barrier blocks someone who relies on the missing feature.
1.0 means impassable for a wheelchair user (blocked ramp, broken elevator with no alternative).
0.3 means an inconvenience that most people can work around.

detected_features: short noun phrases for things you can see or that are named, e.g. "delivery truck", "ramp", "elevator door", "curb", "construction barrier".
summary: one plain sentence, under 25 words, written for a city maintenance crew.
confidence: your confidence in the category choice, 0.0 to 1.0. Lower it when the photo is unclear or the text is vague.

Reply with JSON only."""


RESPONSE_SCHEMA = {
    "name": "accessibility_classification",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "category": {"type": "string", "enum": list(CATEGORIES.keys())},
            "subcategory": {"type": "string"},
            "severity": {"type": "number", "minimum": 0, "maximum": 1},
            "summary": {"type": "string"},
            "detected_features": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["category", "subcategory", "severity", "summary", "detected_features", "confidence"],
        "additionalProperties": False,
    },
}
