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
    source: Literal["lmstudio", "heuristic"]
    model: str | None = None


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
