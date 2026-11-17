"""Alerts near me: per-user opt-in, radius and the last location the person chose to share.

The location is stored only while the person has alerts near me switched on, and it is cleared when
they switch it off or when it is more than 24 hours old (see services/alerts/check.py).

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("nearby_alerts", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("nearby_radius_m", sa.Integer(), nullable=False, server_default="100"))
    op.add_column("users", sa.Column("nearby_lat", sa.Float(), nullable=True))
    op.add_column("users", sa.Column("nearby_lng", sa.Float(), nullable=True))
    op.add_column("users", sa.Column("nearby_location_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("nearby_location_at")
        batch.drop_column("nearby_lng")
        batch.drop_column("nearby_lat")
        batch.drop_column("nearby_radius_m")
        batch.drop_column("nearby_alerts")
