"""initial schema

Revision ID: 20260427_0001
Revises:
Create Date: 2026-04-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from backend.app.core.config import Settings

revision = "20260427_0001"
down_revision = None
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


def _shared_schema() -> str | None:
    if not _is_postgresql():
        return None
    return _settings().database_shared_schema


def _app_fk(table_name: str, column_name: str = "id") -> str:
    app_schema = _app_schema()
    if app_schema is None:
        return f"{table_name}.{column_name}"
    return f"{app_schema}.{table_name}.{column_name}"


def _create_configured_schemas() -> None:
    if not _is_postgresql():
        return
    settings = _settings()
    op.execute(f'CREATE SCHEMA IF NOT EXISTS "{settings.database_app_schema}"')
    if settings.database_shared_schema != "public":
        op.execute(f'CREATE SCHEMA IF NOT EXISTS "{settings.database_shared_schema}"')


def upgrade() -> None:
    _create_configured_schemas()
    app_schema = _app_schema()
    shared_schema = _shared_schema()

    op.create_table(
        "advisory_cases",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_cases_user_id"),
        "advisory_cases",
        ["user_id"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "user_credit_balances",
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("current_credit_usd", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
        schema=shared_schema,
    )

    op.create_table(
        "cost_events",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("thread_id", sa.Text(), nullable=False),
        sa.Column("response_id", sa.Text(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=shared_schema,
    )
    op.create_index(
        op.f("ix_cost_events_response_id"),
        "cost_events",
        ["response_id"],
        unique=False,
        schema=shared_schema,
    )
    op.create_index(
        op.f("ix_cost_events_thread_id"),
        "cost_events",
        ["thread_id"],
        unique=False,
        schema=shared_schema,
    )
    op.create_index(
        op.f("ix_cost_events_user_id"),
        "cost_events",
        ["user_id"],
        unique=False,
        schema=shared_schema,
    )

    op.create_table(
        "credit_grants",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("admin_user_id", sa.Text(), nullable=True),
        sa.Column("credit_amount_usd", sa.Float(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=shared_schema,
    )
    op.create_index(
        op.f("ix_credit_grants_admin_user_id"),
        "credit_grants",
        ["admin_user_id"],
        unique=False,
        schema=shared_schema,
    )
    op.create_index(
        op.f("ix_credit_grants_user_id"),
        "credit_grants",
        ["user_id"],
        unique=False,
        schema=shared_schema,
    )

    op.create_table(
        "advisory_chats",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("case_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("status_json", sa.JSON(), nullable=False),
        sa.Column("allowed_image_domains_json", sa.JSON(), nullable=True),
        sa.Column("updated_sequence", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], [_app_fk("advisory_cases")]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("case_id"),
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_chats_case_id"),
        "advisory_chats",
        ["case_id"],
        unique=True,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_chats_updated_sequence"),
        "advisory_chats",
        ["updated_sequence"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_chats_user_id"),
        "advisory_chats",
        ["user_id"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "advisory_records",
        sa.Column("case_id", sa.String(), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], [_app_fk("advisory_cases")]),
        sa.PrimaryKeyConstraint("case_id"),
        schema=app_schema,
    )

    op.create_table(
        "advisory_chat_attachments",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=app_schema,
    )

    op.create_table(
        "advisory_chat_entries",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("chat_id", sa.String(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], [_app_fk("advisory_chats")]),
        sa.PrimaryKeyConstraint("id"),
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_chat_entries_chat_id"),
        "advisory_chat_entries",
        ["chat_id"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_chat_entries_sequence"),
        "advisory_chat_entries",
        ["sequence"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "advisory_images",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("case_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("chat_id", sa.String(), nullable=True),
        sa.Column("attachment_id", sa.Text(), nullable=True),
        sa.Column("storage_provider", sa.Text(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("source_kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], [_app_fk("advisory_chats")]),
        sa.ForeignKeyConstraint(["case_id"], [_app_fk("advisory_cases")]),
        sa.PrimaryKeyConstraint("id"),
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_images_attachment_id"),
        "advisory_images",
        ["attachment_id"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_images_chat_id"),
        "advisory_images",
        ["chat_id"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_images_case_id"),
        "advisory_images",
        ["case_id"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_images_source_kind"),
        "advisory_images",
        ["source_kind"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_images_status"),
        "advisory_images",
        ["status"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_images_storage_key"),
        "advisory_images",
        ["storage_key"],
        unique=True,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_images_storage_provider"),
        "advisory_images",
        ["storage_provider"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        op.f("ix_advisory_images_user_id"),
        "advisory_images",
        ["user_id"],
        unique=False,
        schema=app_schema,
    )


def downgrade() -> None:
    app_schema = _app_schema()
    shared_schema = _shared_schema()

    op.drop_index(
        op.f("ix_advisory_images_user_id"),
        table_name="advisory_images",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_images_storage_provider"),
        table_name="advisory_images",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_images_storage_key"),
        table_name="advisory_images",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_images_status"),
        table_name="advisory_images",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_images_source_kind"),
        table_name="advisory_images",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_images_case_id"),
        table_name="advisory_images",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_images_chat_id"),
        table_name="advisory_images",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_images_attachment_id"),
        table_name="advisory_images",
        schema=app_schema,
    )
    op.drop_table("advisory_images", schema=app_schema)
    op.drop_index(
        op.f("ix_advisory_chat_entries_sequence"),
        table_name="advisory_chat_entries",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_chat_entries_chat_id"),
        table_name="advisory_chat_entries",
        schema=app_schema,
    )
    op.drop_table("advisory_chat_entries", schema=app_schema)
    op.drop_table("advisory_chat_attachments", schema=app_schema)
    op.drop_table("advisory_records", schema=app_schema)
    op.drop_index(
        op.f("ix_advisory_chats_user_id"),
        table_name="advisory_chats",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_chats_updated_sequence"),
        table_name="advisory_chats",
        schema=app_schema,
    )
    op.drop_index(
        op.f("ix_advisory_chats_case_id"),
        table_name="advisory_chats",
        schema=app_schema,
    )
    op.drop_table("advisory_chats", schema=app_schema)
    op.drop_index(
        op.f("ix_credit_grants_user_id"),
        table_name="credit_grants",
        schema=shared_schema,
    )
    op.drop_index(
        op.f("ix_credit_grants_admin_user_id"),
        table_name="credit_grants",
        schema=shared_schema,
    )
    op.drop_table("credit_grants", schema=shared_schema)
    op.drop_index(
        op.f("ix_cost_events_user_id"),
        table_name="cost_events",
        schema=shared_schema,
    )
    op.drop_index(
        op.f("ix_cost_events_thread_id"),
        table_name="cost_events",
        schema=shared_schema,
    )
    op.drop_index(
        op.f("ix_cost_events_response_id"),
        table_name="cost_events",
        schema=shared_schema,
    )
    op.drop_table("cost_events", schema=shared_schema)
    op.drop_table("user_credit_balances", schema=shared_schema)
    op.drop_index(op.f("ix_advisory_cases_user_id"), table_name="advisory_cases", schema=app_schema)
    op.drop_table("advisory_cases", schema=app_schema)
