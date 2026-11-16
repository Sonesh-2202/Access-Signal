"""enable PostGIS where available

The schema keeps lat/lng as floats (see docs/ARCHITECTURE.md); PostGIS is enabled
so spatial queries can be added later without a manual step on Supabase. No-op on
SQLite and on Postgres servers that don't ship the extension.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-16 12:00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    available = bind.execute(sa.text("SELECT 1 FROM pg_available_extensions WHERE name = 'postgis'")).scalar()
    if available:
        # Supabase keeps extensions in their own schema; plain Postgres falls back to public.
        has_schema = bind.execute(sa.text("SELECT 1 FROM pg_namespace WHERE nspname = 'extensions'")).scalar()
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis" + (" WITH SCHEMA extensions" if has_schema else ""))


def downgrade() -> None:
    # Leave the extension in place: other objects in the database may depend on it.
    pass
