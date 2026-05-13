"""add advisory semantic source mapping

Revision ID: 20260513_0003
Revises: 20260428_0002
Create Date: 2026-05-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from backend.app.core.config import Settings

revision = "20260513_0003"
down_revision = "20260428_0002"
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


def _app_fk(table_name: str, column_name: str = "id") -> str:
    app_schema = _app_schema()
    if app_schema is None:
        return f"{table_name}.{column_name}"
    return f"{app_schema}.{table_name}.{column_name}"


def upgrade() -> None:
    app_schema = _app_schema()
    op.create_table(
        "advisory_semantic_sources",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("case_id", sa.String(), nullable=False),
        sa.Column("item_type", sa.Text(), nullable=False),
        sa.Column("item_id", sa.Text(), nullable=False),
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], [_app_fk("advisory_cases")]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "case_id",
            "item_type",
            "item_id",
            name="uq_advisory_semantic_sources_item",
        ),
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_semantic_sources_case_id"),
        "advisory_semantic_sources",
        ["case_id"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_semantic_sources_item_id"),
        "advisory_semantic_sources",
        ["item_id"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_semantic_sources_item_type"),
        "advisory_semantic_sources",
        ["item_type"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_semantic_sources_source_id"),
        "advisory_semantic_sources",
        ["source_id"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_semantic_sources_user_id"),
        "advisory_semantic_sources",
        ["user_id"],
        unique=False,
        schema=app_schema,
    )


def downgrade() -> None:
    app_schema = _app_schema()
    op.drop_index(
        op.f("ix_advisory_semantic_sources_user_id"),
        table_name="advisory_semantic_sources",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_semantic_sources_source_id"),
        table_name="advisory_semantic_sources",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_semantic_sources_item_type"),
        table_name="advisory_semantic_sources",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_semantic_sources_item_id"),
        table_name="advisory_semantic_sources",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_semantic_sources_case_id"),
        table_name="advisory_semantic_sources",
        schema=app_schema,
    )
    op.drop_table("advisory_semantic_sources", schema=app_schema)
