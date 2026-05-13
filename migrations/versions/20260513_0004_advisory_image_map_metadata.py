"""add advisory image map metadata

Revision ID: 20260513_0004
Revises: 20260513_0003
Create Date: 2026-05-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from backend.app.core.config import Settings

revision = "20260513_0004"
down_revision = "20260513_0003"
branch_labels = None
depends_on = None


def _settings() -> Settings:
    return Settings()


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _app_schema() -> str | None:
    if not _is_postgresql():
        return None
    return _settings().database_app_schema


def upgrade() -> None:
    app_schema = _app_schema()
    with op.batch_alter_table("advisory_images", schema=app_schema) as batch_op:
        batch_op.add_column(sa.Column("detailed_description", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("location_label", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("latitude", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    app_schema = _app_schema()
    with op.batch_alter_table("advisory_images", schema=app_schema) as batch_op:
        batch_op.drop_column("longitude")
        batch_op.drop_column("latitude")
        batch_op.drop_column("location_label")
        batch_op.drop_column("detailed_description")
