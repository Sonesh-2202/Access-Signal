from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

Role = Literal["user", "infrastructure_manager", "admin"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- auth

class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=72)
    display_name: str = Field(min_length=2, max_length=80)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes")
        classes = sum([any(c.islower() for c in v), any(c.isupper() for c in v),
                       any(c.isdigit() for c in v), any(not c.isalnum() for c in v)])
        if classes < 3:
            raise ValueError("Use at least three of: lowercase, uppercase, digits, symbols")
        return v

    @field_validator("display_name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class RefreshIn(BaseModel):
    refresh_token: str = Field(max_length=200)


class UserOut(ORM):
    id: str
    email: str
    display_name: str
    role: Role
    created_at: datetime


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


# ---------------------------------------------------------------- AI

class Classification(BaseModel):
    category: str
    subcategory: str
    severity: float = Field(ge=0, le=1)
    summary: str
    detected_features: list[str] = []
    confidence: float = Field(ge=0, le=1)
    # Which tier produced this result. Shown in the UI next to every AI reading.
    source: Literal["gemini", "groq", "nebius", "heuristic"]
    model: str | None = None
    images_reviewed: bool = False
    # Why a higher tier didn't answer (e.g. "Gemini quota or rate limit reached"). Never contains keys.
    fallback_reason: str | None = Field(default=None, max_length=500)


class ClassifyIn(BaseModel):
    description: str = Field(default="", max_length=4000)
    evidence_ids: list[str] = Field(default=[], max_length=6)


# ---------------------------------------------------------------- evidence / reports

class EvidenceOut(ORM):
    id: str
    type: str
    url: str | None = None
    mime_type: str | None
    transcription: str | None
    meta: dict[str, Any]
    created_at: datetime


class TranslationRecord(BaseModel):
    """A translation the reporter reviewed and chose to file. The original text is kept with the report."""
    language: str = Field(min_length=2, max_length=20)  # BCP 47 tag of the original text
    original: str = Field(min_length=1, max_length=4000)
    source: str = Field(max_length=20)  # cloud tier that translated it
    model: str | None = Field(default=None, max_length=120)
    reviewed: Literal[True] = True


class TranslateIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    target: str = Field(default="en", min_length=2, max_length=20)  # BCP 47 tag to translate into


class TranslateOut(BaseModel):
    original: str
    translation: str
    target: str
    source: Literal["gemini", "groq", "nebius"]
    model: str | None
    label: str  # shown beside the translation: it is a draft for the reporter to review

class ReportCreate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str | None = Field(default=None, max_length=255)
    category: str
    subcategory: str
    description: str = Field(default="", max_length=4000)
    evidence_ids: list[str] = Field(default=[], max_length=6)
    place_id: str | None = None
    ai_analysis: Classification | None = None
    translation: TranslationRecord | None = None  # set only when the reporter accepted a translation
    user_confirmed: bool = True
    duplicate_of: str | None = None


class ReportSummary(ORM):
    id: str
    lat: float
    lng: float
    address: str | None
    category: str
    subcategory: str
    status: str
    severity_score: float
    confidence_score: float
    description: str
    reported_at: datetime
    place_id: str | None
    evidence_count: int = 0
    issue_status: str | None = None


class ReportDetail(ReportSummary):
    confidence_breakdown: dict[str, Any]
    ai_analysis: dict[str, Any] | None
    user_confirmed: bool
    duplicate_of: str | None
    resolved_at: datetime | None
    reporter: str | None = None
    evidence: list[EvidenceOut] = []
    corroborating: list[ReportSummary] = []
    place_name: str | None = None


class ReportPage(BaseModel):
    items: list[ReportSummary]
    total: int
    next_offset: int | None


class DuplicateCandidate(BaseModel):
    report: ReportSummary
    distance_m: float
    text_similarity: float
    category_match: bool
    score: float


class DuplicateCheckIn(BaseModel):
    lat: float
    lng: float
    category: str
    subcategory: str
    description: str = Field(default="", max_length=4000)


# ---------------------------------------------------------------- places

class PlaceFeatureOut(ORM):
    id: str
    feature_type: str
    label: str = ""
    status: str
    source: str
    source_report_id: str | None
    confidence: float
    notes: str | None
    assessed_at: datetime


class PlaceSummary(ORM):
    id: str
    name: str
    place_type: str
    lat: float
    lng: float
    address: str | None
    verification_status: str
    last_verified: datetime | None
    open_reports: int = 0
    feature_status: dict[str, str] = {}


class PlaceDetail(PlaceSummary):
    osm_id: str | None
    features: list[PlaceFeatureOut]
    reports: list[ReportSummary]
    timeline: list[dict[str, Any]]


# ---------------------------------------------------------------- routing

Profile = Literal["wheelchair", "reduced_effort", "low_vision", "standard"]


class RouteRequest(BaseModel):
    origin: tuple[float, float]  # (lat, lng)
    destination: tuple[float, float]
    profile: Profile = "wheelchair"
    avoid_unknown: bool = False
    alternatives: int = Field(default=2, ge=0, le=3)
    prefer_reliable: bool = False  # add corridor risk to the cost; see services/intelligence/risk.py


class RouteSegment(BaseModel):
    name: str
    length_m: float
    instruction: str
    surface: str | None
    incline: float | None
    kerb: str | None
    has_steps: bool
    unknown_attributes: list[str]
    barriers: list[dict[str, Any]]
    coords: list[list[float]]


class RouteOption(BaseModel):
    label: str
    distance_m: float
    duration_min: float
    cost: float
    accessibility_score: float
    unknown_share: float
    barriers_avoided: int
    barriers_on_route: int
    explanation: list[str]
    geometry: dict[str, Any]
    segments: list[RouteSegment]
    risk: dict[str, Any] | None = None  # set when prefer_reliable was requested


class RouteResponse(BaseModel):
    profile: Profile
    routes: list[RouteOption]
    warnings: list[str]


# ---------------------------------------------------------------- issues

class IssueOut(ORM):
    id: str
    status: str
    priority: str
    assigned_to: str | None
    assignee_name: str | None = None
    resolution_notes: str | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None
    report: ReportSummary


class IssueHistoryOut(ORM):
    id: str
    old_status: str | None
    new_status: str
    notes: str | None
    changed_at: datetime
    actor_name: str | None = None


class IssueDetail(IssueOut):
    history: list[IssueHistoryOut]
    report_detail: ReportDetail
    allowed_transitions: list[str]


class IssueUpdate(BaseModel):
    status: str | None = None
    priority: Literal["low", "medium", "high", "critical"] | None = None
    assigned_to: str | None = None
    notes: str | None = Field(default=None, max_length=4000)
    resolution_notes: str | None = Field(default=None, max_length=4000)
    resolution_evidence_id: str | None = None
    unassign: bool = False


class IssuePage(BaseModel):
    items: list[IssueOut]
    total: int


# ---------------------------------------------------------------- analytics

class HotspotOut(ORM):
    id: str
    lat: float
    lng: float
    radius_m: float
    area: dict[str, Any]
    severity_index: float
    report_count: int
    dominant_category: str
    trend: str
    calculated_at: datetime
    label: str | None = None


AvoidFeature = Literal["reported_barriers", "construction", "unknown_data", "stairs", "steep_slopes", "rough_surfaces"]


class RouteIntent(BaseModel):
    """A route request as the model extracted it. Place names only: the model never
    returns coordinates or a path. The server resolves names to places and runs the router."""
    model_config = ConfigDict(extra="forbid")

    profile: Profile = "wheelchair"
    start: str = Field(min_length=2, max_length=120)
    end: str = Field(min_length=2, max_length=120)
    avoid_features: list[AvoidFeature] = Field(default_factory=list, max_length=6)
    max_detour_pct: int | None = Field(default=None, ge=0, le=100)
    max_incline: float | None = Field(default=None, ge=0, le=0.2)  # 0.05 means 5 %


class RoutePlace(BaseModel):
    id: str
    name: str
    lat: float
    lng: float


class RoutePlanResult(BaseModel):
    status: Literal["planned", "place_not_found", "no_route"]
    intent: RouteIntent
    start: RoutePlace | None = None
    end: RoutePlace | None = None
    route: RouteOption | None = None  # the router's output, unchanged
    notes: list[str] = Field(default_factory=list)  # outcome of each limit the user set, and routing warnings
    unsupported: list[str] = Field(default_factory=list)  # avoid_features this profile can't enforce
    message: str  # plain text for places and routes that could not be planned


# ---------------------------------------------------------------- describe a route in plain words
class DescribeIn(BaseModel):
    text: str = Field(min_length=3, max_length=1000)  # e.g. "step-free from Union Square to Grand Central"


class DescribeOut(BaseModel):
    answer: str  # the explanation, or the router's message when nothing could be planned
    # The cloud tier that wrote the explanation. None when no model wrote one, or when the request
    # could not be planned, in which case the answer is the router's own message.
    source: Literal["gemini", "groq", "nebius"] | None
    model: str | None
    route: RoutePlanResult  # the router's output, not the model's


# ---------------------------------------------------------------- alerts near me (no AI)
NearbyRadius = Literal[100, 250, 500]  # metres; the only radii a person can choose


class NearbyNowIn(BaseModel):
    """A point the person names for a one-off check. Not stored: the request is read, answered and dropped."""
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    radius_m: NearbyRadius = 250


class NearbyItem(BaseModel):
    id: str
    kind: Literal["barrier", "outage"]
    label: str = Field(max_length=200)  # e.g. "Blocked ramp" or "Elevator out of service"; never the report text
    place_name: str | None = None
    distance_m: int
    url: str = Field(max_length=200)  # in-app path to the report or place
    when: datetime | None = None  # when it was reported, or when its status was last assessed


class NearbyOut(BaseModel):
    radius_m: int
    checked_at: datetime
    barriers: list[NearbyItem]
    outages: list[NearbyItem]


class NearbySettingsIn(BaseModel):
    enabled: bool
    radius_m: NearbyRadius = 100


class NearbySettingsOut(BaseModel):
    enabled: bool
    radius_m: int
    has_location: bool
    location_expires_at: datetime | None = None


class NearbyLocationIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


# ---------------------------------------------------------------- preflight brief (rules only)
class PreflightSource(BaseModel):
    tag: str  # the tag used in the reasons, e.g. "R1" or "P1"
    kind: Literal["report", "place"]
    label: str = Field(max_length=200)
    url: str = Field(max_length=200)  # path inside the app


class PreflightOut(BaseModel):
    place_id: str
    place_name: str
    status: Literal["good", "caution", "blocked"]
    status_label: str
    reasons: list[str]  # each starts with its tag, e.g. "[R1] ...", when one exists
    summary: str  # the rule-based summary: status, then the first reasons
    sources: list[PreflightSource]
    screen_reader: str


# ---------------------------------------------------------------- accessible rides (curated list, template draft)
class RideOption(BaseModel):
    """One curated ride service. Only tel: and https links are ever rendered."""
    id: str = Field(max_length=40)
    name: str = Field(max_length=120)
    kind: Literal["taxi", "paratransit"]
    phone: str | None = Field(default=None, pattern=r"^\d{3}-\d{3}-\d{4}$")
    tel: str | None = None  # derived from phone, e.g. +18773372017
    url: str | None = Field(default=None, max_length=300)
    notes: str = Field(max_length=400)
    source_url: str = Field(max_length=300)  # where the phone number was checked


class RideDraftIn(BaseModel):
    pickup: str = Field(min_length=2, max_length=120)
    dropoff: str = Field(min_length=2, max_length=120)
    barrier: str = Field(min_length=2, max_length=200)  # the specific barrier, e.g. "missing curb cut"
    passengers: int = Field(default=1, ge=1, le=4)


class DispatcherDraft(BaseModel):
    """A fixed-template message for the person to review. The app never sends it."""
    text: str
    source: Literal["template"] = "template"
    preview: Literal[True] = True
    label: str


# ---------------------------------------------------------------- route alerts (saved routes, nearby, push, inbox)
class CorridorIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    origin: tuple[float, float]  # (lat, lng)
    destination: tuple[float, float]
    profile: Profile = "wheelchair"
    notify_reports: bool = True
    notify_outages: bool = True
    notify_route_changes: bool = True

    @field_validator("origin", "destination")
    @classmethod
    def in_range(cls, v: tuple[float, float]) -> tuple[float, float]:
        if not (-90 <= v[0] <= 90 and -180 <= v[1] <= 180):
            raise ValueError("Coordinates are out of range")
        return v


class CorridorPatch(BaseModel):
    notify_reports: bool | None = None
    notify_outages: bool | None = None
    notify_route_changes: bool | None = None


class CorridorOut(ORM):
    id: str
    name: str
    origin: tuple[float, float]
    destination: tuple[float, float]
    profile: Profile
    notify_reports: bool
    notify_outages: bool
    notify_route_changes: bool
    last_checked_at: datetime | None
    created_at: datetime


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=4, max_length=64)


class PushSubscribeIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=500)
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def https_only(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("Push endpoints must use https")
        return v


class PushUnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=500)


class PushStatus(BaseModel):
    enabled: bool  # the server has VAPID keys, so push can be sent
    public_key: str | None = None


class InboxItem(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    corridor_id: str | None
    corridor_name: str | None
    created_at: datetime
    read: bool


class InboxOut(BaseModel):
    unread: int
    items: list[InboxItem]
