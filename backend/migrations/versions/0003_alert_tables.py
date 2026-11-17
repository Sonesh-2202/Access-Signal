"""Route alerts: saved corridors, Web Push subscriptions and the in-app inbox.

Adds only the three tables for alerts. 0001 creates the base schema and 0002 enables PostGIS
where it is available, so this revision builds on the head, 0002.

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_corridors",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("origin_lat", sa.Float, nullable=False),
        sa.Column("origin_lng", sa.Float, nullable=False),
        sa.Column("destination_lat", sa.Float, nullable=False),
        sa.Column("destination_lng", sa.Float, nullable=False),
        sa.Column("profile", sa.String(24), nullable=False),
        sa.Column("notify_reports", sa.Boolean, nullable=False),
        sa.Column("notify_outages", sa.Boolean, nullable=False),
        sa.Column("notify_route_changes", sa.Boolean, nullable=False),
        sa.Column("fingerprint", sa.String(64)),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_saved_corridors_user_id", "saved_corridors", ["user_id"])
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("endpoint", sa.String(500), nullable=False, unique=True),
        sa.Column("p256dh", sa.String(200), nullable=False),
        sa.Column("auth", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("corridor_id", sa.String(36), sa.ForeignKey("saved_corridors.id", ondelete="SET NULL")),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("body", sa.String(300), nullable=False),
        sa.Column("dedupe_key", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "dedupe_key", name="uq_notifications_user_key"),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_notifications_created_at", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
    op.drop_index("ix_saved_corridors_user_id", table_name="saved_corridors")
    op.drop_table("saved_corridors")
