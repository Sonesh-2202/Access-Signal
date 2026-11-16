import math
import re
from collections import Counter

_STOP = set(
    "a an the and or but of to in on at by for with from is are was were be been it its this that "
    "there here i we you they he she my our your their me us them as so if not no very just "
    "again still now today yesterday please can cant can't could would should will".split()
)

# Light normalisation so "elevators", "elevator's", "lift" land on the same token.
_SYNONYMS = {
    "lift": "elevator", "lifts": "elevator", "elevators": "elevator",
    "kerb": "curb", "kerbs": "curb", "curbs": "curb",
    "ramps": "ramp", "trucks": "truck", "lorry": "truck", "van": "truck",
    "broken": "outage", "broke": "outage", "down": "outage", "out": "outage", "busted": "outage",
    "blocked": "block", "blocking": "block", "blocks": "block", "obstructed": "block",
    "entrance": "entry", "entry": "entry", "door": "entry", "doors": "entry",
    "wheelchair": "wheelchair", "chair": "wheelchair",
}


def tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9']+", text.lower())
    out = []
    for w in words:
        w = w.strip("'")
        if len(w) < 2 or w in _STOP:
            continue
        out.append(_SYNONYMS.get(w, w))
    return out


def cosine_similarity(a: str, b: str) -> float:
    ta, tb = Counter(tokens(a)), Counter(tokens(b))
    if not ta or not tb:
        return 0.0
    dot = sum(ta[t] * tb[t] for t in ta.keys() & tb.keys())
    na = math.sqrt(sum(v * v for v in ta.values()))
    nb = math.sqrt(sum(v * v for v in tb.values()))
    return dot / (na * nb)
