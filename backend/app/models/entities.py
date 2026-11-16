"""ORM entities.

Locations are stored as latitude/longitude float pairs with composite indexes so
the same schema runs on SQLite (local dev) and PostgreSQL (docker-compose).
Spatial queries use a bounding-box prefilter in SQL followed by exact haversine
distance in Python (see app.utils.geo)."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(32), default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    reports: Mapped[list["Report"]] = relationship(back_populates="user", foreign_keys="Report.user_id")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Place(Base):
    __tablename__ = "places"
    __table_args__ = (Index("ix_places_lat_lng", "lat", "lng"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    osm_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    place_type: Mapped[str] = mapped_column(String(64), index=True)
    address: Mapped[str | None] = mapped_column(String(255))
    accessibility_profile: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    osm_tags: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    last_verified: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_status: Mapped[str] = mapped_column(String(32), default="unverified")

    features: Mapped[list["PlaceAccessibility"]] = relationship(
        back_populates="place", cascade="all, delete-orphan", order_by="PlaceAccessibility.feature_type"
    )


class PlaceAccessibility(Base):
    __tablename__ = "place_accessibility"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    place_id: Mapped[str] = mapped_column(ForeignKey("places.id", ondelete="CASCADE"), index=True)
    feature_type: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="unknown")
    source: Mapped[str] = mapped_column(String(32), default="osm")  # osm | report | manager
    source_report_id: Mapped[str | None] = mapped_column(ForeignKey("reports.id", ondelete="SET NULL"))
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    notes: Mapped[str | None] = mapped_column(Text)
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    place: Mapped[Place] = relationship(back_populates="features")


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (Index("ix_reports_lat_lng", "lat", "lng"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    place_id: Mapped[str | None] = mapped_column(ForeignKey("places.id", ondelete="SET NULL"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    address: Mapped[str | None] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(32), index=True)
    subcategory: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="open", index=True)
    severity_score: Mapped[float] = mapped_column(Float, default=0.5)
    confidence_score: Mapped[float] = mapped_column(Float, default=0.3)
    confidence_breakdown: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    description: Mapped[str] = mapped_column(Text, default="")
    ai_analysis: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    user_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    duplicate_of: Mapped[str | None] = mapped_column(ForeignKey("reports.id", ondelete="SET NULL"))
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User | None] = relationship(back_populates="reports", foreign_keys=[user_id])
    place: Mapped[Place | None] = relationship()
    evidence: Mapped[list["Evidence"]] = relationship(
        back_populates="report", cascade="all, delete-orphan", order_by="Evidence.created_at"
    )
    issue: Mapped["Issue | None"] = relationship(back_populates="report", uselist=False)


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    report_id: Mapped[str | None] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(16))  # photo | voice | text
    file_path: Mapped[str | None] = mapped_column(String(500))
    mime_type: Mapped[str | None] = mapped_column(String(100))
    transcription: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    report: Mapped[Report | None] = relationship(back_populates="evidence")


class Issue(Base):
    __tablename__ = "issues"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    report_id: Mapped[str] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), unique=True)
    assigned_to: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="reported", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    resolution_notes: Mapped[str | None] = mapped_column(Text)
    resolution_evidence_id: Mapped[str | None] = mapped_column(ForeignKey("evidence.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    report: Mapped[Report] = relationship(back_populates="issue")
    assignee: Mapped[User | None] = relationship(foreign_keys=[assigned_to])
    history: Mapped[list["IssueHistory"]] = relationship(
        back_populates="issue", cascade="all, delete-orphan", order_by="IssueHistory.changed_at"
    )


class IssueHistory(Base):
    __tablename__ = "issue_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    issue_id: Mapped[str] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    changed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    old_status: Mapped[str | None] = mapped_column(String(32))
    new_status: Mapped[str] = mapped_column(String(32))
    notes: Mapped[str | None] = mapped_column(Text)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    issue: Mapped[Issue] = relationship(back_populates="history")
    actor: Mapped[User | None] = relationship()


class PathEdge(Base):
    __tablename__ = "path_edges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    from_node: Mapped[str] = mapped_column(String(64), index=True)
    to_node: Mapped[str] = mapped_column(String(64), index=True)
    coords: Mapped[list[list[float]]] = mapped_column(JSON)  # [[lng, lat], ...]
    length_m: Mapped[float] = mapped_column(Float)
    name: Mapped[str | None] = mapped_column(String(200))
    accessibility_attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    wheelchair_cost: Mapped[float] = mapped_column(Float)
    walking_cost: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(32), default="osm")


class Hotspot(Base):
    __tablename__ = "hotspots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    radius_m: Mapped[float] = mapped_column(Float)
    area: Mapped[dict[str, Any]] = mapped_column(JSON)  # GeoJSON polygon
    severity_index: Mapped[float] = mapped_column(Float)
    report_count: Mapped[int] = mapped_column(Integer)
    dominant_category: Mapped[str] = mapped_column(String(32))
    trend: Mapped[str] = mapped_column(String(16), default="stable")  # rising | stable | falling
    report_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
