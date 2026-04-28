"""add shared payment and free-credit records

Revision ID: 20260428_0002
Revises: 20260427_0001
Create Date: 2026-04-28
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

from backend.app.core.config import Settings

revision = "20260428_0002"
down_revision = "20260427_0001"
branch_labels = None
depends_on = None


def _settings() -> Settings:
    return Settings()


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _shared_schema() -> str | None:
    if not _is_postgresql():
        return None
    return _settings().database_shared_schema


def _inspector() -> sa.Inspector:
    return inspect(op.get_bind())


def _has_table(table_name: str, *, schema: str | None) -> bool:
    return _inspector().has_table(table_name, schema=schema)


def _column_names(table_name: str, *, schema: str | None) -> set[str]:
    if not _has_table(table_name, schema=schema):
        return set()
    return {
        column["name"]
        for column in _inspector().get_columns(table_name, schema=schema)
    }


def _has_index(table_name: str, index_name: str, *, schema: str | None) -> bool:
    inspector = _inspector()
    indexes = inspector.get_indexes(table_name, schema=schema)
    constraints = inspector.get_unique_constraints(table_name, schema=schema)
    return any(index["name"] == index_name for index in indexes) or any(
        constraint["name"] == index_name for constraint in constraints
    )


def _add_column_if_missing(
    table_name: str,
    column: sa.Column,
    *,
    schema: str | None,
) -> None:
    if column.name in _column_names(table_name, schema=schema):
        return
    op.add_column(table_name, column, schema=schema)


def _create_index_if_missing(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    schema: str | None,
    unique: bool = False,
) -> None:
    if not _has_table(table_name, schema=schema):
        return
    available_columns = _column_names(table_name, schema=schema)
    if any(column not in available_columns for column in columns):
        return
    if _has_index(table_name, index_name, schema=schema):
        return
    op.create_index(index_name, table_name, columns, unique=unique, schema=schema)


def _drop_index_if_exists(index_name: str, table_name: str, *, schema: str | None) -> None:
    if not _has_table(table_name, schema=schema):
        return
    if not _has_index(table_name, index_name, schema=schema):
        return
    op.drop_index(index_name, table_name=table_name, schema=schema)


def _drop_column_if_exists(table_name: str, column_name: str, *, schema: str | None) -> None:
    if column_name not in _column_names(table_name, schema=schema):
        return
    op.drop_column(table_name, column_name, schema=schema)


def _drop_table_if_exists(table_name: str, *, schema: str | None) -> None:
    if not _has_table(table_name, schema=schema):
        return
    op.drop_table(table_name, schema=schema)


def _ensure_payment_attempt_columns(shared_schema: str | None) -> None:
    columns = [
        sa.Column("id", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Text(), nullable=True),
        sa.Column("expected_amount_usd", sa.Float(), nullable=True),
        sa.Column("reference_code", sa.Text(), nullable=True),
        sa.Column("expected_currency", sa.Text(), nullable=True),
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("temporary_access_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_reference", sa.Text(), nullable=True),
        sa.Column("credit_grant_id", sa.Text(), nullable=True),
        sa.Column("receipt_filename", sa.Text(), nullable=True),
        sa.Column("receipt_media_type", sa.Text(), nullable=True),
        sa.Column("receipt_text_excerpt", sa.Text(), nullable=True),
        sa.Column("review_json", sa.JSON(), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    ]
    for column in columns:
        _add_column_if_missing("payment_attempts", column, schema=shared_schema)


def _ensure_free_credit_request_columns(shared_schema: str | None) -> None:
    columns = [
        sa.Column("id", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Text(), nullable=True),
        sa.Column("requested_amount_usd", sa.Float(), nullable=True),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("linkedin_profile_url", sa.Text(), nullable=True),
        sa.Column("relationship_note", sa.Text(), nullable=True),
        sa.Column("intended_use", sa.Text(), nullable=True),
        sa.Column("evidence_verified", sa.Boolean(), nullable=True),
        sa.Column("idempotency_key", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("decided_amount_usd", sa.Float(), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("reviewer_user_id", sa.Text(), nullable=True),
        sa.Column("credit_grant_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    ]
    for column in columns:
        _add_column_if_missing("free_credit_requests", column, schema=shared_schema)


def upgrade() -> None:
    shared_schema = _shared_schema()

    _add_column_if_missing(
        "credit_grants",
        sa.Column("source", sa.Text(), nullable=False, server_default="admin_manual"),
        schema=shared_schema,
    )
    _add_column_if_missing(
        "credit_grants",
        sa.Column("payment_provider", sa.Text(), nullable=True),
        schema=shared_schema,
    )
    _add_column_if_missing(
        "credit_grants",
        sa.Column("payment_reference", sa.Text(), nullable=True),
        schema=shared_schema,
    )
    _create_index_if_missing(
        op.f("ix_credit_grants_payment_reference"),
        "credit_grants",
        ["payment_reference"],
        schema=shared_schema,
    )

    if _has_table("payment_attempts", schema=shared_schema):
        _ensure_payment_attempt_columns(shared_schema)
    else:
        op.create_table(
            "payment_attempts",
            sa.Column("id", sa.Text(), nullable=False),
            sa.Column("user_id", sa.Text(), nullable=False),
            sa.Column("expected_amount_usd", sa.Float(), nullable=False),
            sa.Column("reference_code", sa.Text(), nullable=False),
            sa.Column("expected_currency", sa.Text(), nullable=False),
            sa.Column("provider", sa.Text(), nullable=False),
            sa.Column("status", sa.Text(), nullable=False),
            sa.Column("temporary_access_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("provider_reference", sa.Text(), nullable=True),
            sa.Column("credit_grant_id", sa.Text(), nullable=True),
            sa.Column("receipt_filename", sa.Text(), nullable=True),
            sa.Column("receipt_media_type", sa.Text(), nullable=True),
            sa.Column("receipt_text_excerpt", sa.Text(), nullable=True),
            sa.Column("review_json", sa.JSON(), nullable=False),
            sa.Column("decision_note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("reference_code"),
            schema=shared_schema,
        )
    _create_index_if_missing(op.f("ix_payment_attempts_user_id"), "payment_attempts", ["user_id"], schema=shared_schema)
    _create_index_if_missing(op.f("ix_payment_attempts_status"), "payment_attempts", ["status"], schema=shared_schema)
    _create_index_if_missing(
        op.f("ix_payment_attempts_provider_reference"),
        "payment_attempts",
        ["provider_reference"],
        schema=shared_schema,
    )
    _create_index_if_missing(
        op.f("ix_payment_attempts_credit_grant_id"),
        "payment_attempts",
        ["credit_grant_id"],
        schema=shared_schema,
    )

    if _has_table("free_credit_requests", schema=shared_schema):
        _ensure_free_credit_request_columns(shared_schema)
    else:
        op.create_table(
            "free_credit_requests",
            sa.Column("id", sa.Text(), nullable=False),
            sa.Column("user_id", sa.Text(), nullable=False),
            sa.Column("requested_amount_usd", sa.Float(), nullable=True),
            sa.Column("source", sa.Text(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("linkedin_profile_url", sa.Text(), nullable=True),
            sa.Column("relationship_note", sa.Text(), nullable=True),
            sa.Column("intended_use", sa.Text(), nullable=True),
            sa.Column("evidence_verified", sa.Boolean(), nullable=False),
            sa.Column("idempotency_key", sa.Text(), nullable=True),
            sa.Column("status", sa.Text(), nullable=False),
            sa.Column("decided_amount_usd", sa.Float(), nullable=True),
            sa.Column("decision_note", sa.Text(), nullable=True),
            sa.Column("reviewer_user_id", sa.Text(), nullable=True),
            sa.Column("credit_grant_id", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            schema=shared_schema,
        )
    _create_index_if_missing(op.f("ix_free_credit_requests_user_id"), "free_credit_requests", ["user_id"], schema=shared_schema)
    _create_index_if_missing(op.f("ix_free_credit_requests_source"), "free_credit_requests", ["source"], schema=shared_schema)
    _create_index_if_missing(op.f("ix_free_credit_requests_status"), "free_credit_requests", ["status"], schema=shared_schema)
    _create_index_if_missing(
        op.f("ix_free_credit_requests_idempotency_key"),
        "free_credit_requests",
        ["idempotency_key"],
        schema=shared_schema,
    )
    _create_index_if_missing(
        op.f("ix_free_credit_requests_reviewer_user_id"),
        "free_credit_requests",
        ["reviewer_user_id"],
        schema=shared_schema,
    )
    _create_index_if_missing(
        op.f("ix_free_credit_requests_credit_grant_id"),
        "free_credit_requests",
        ["credit_grant_id"],
        schema=shared_schema,
    )


def downgrade() -> None:
    shared_schema = _shared_schema()

    _drop_index_if_exists(op.f("ix_free_credit_requests_credit_grant_id"), "free_credit_requests", schema=shared_schema)
    _drop_index_if_exists(op.f("ix_free_credit_requests_reviewer_user_id"), "free_credit_requests", schema=shared_schema)
    _drop_index_if_exists(op.f("ix_free_credit_requests_idempotency_key"), "free_credit_requests", schema=shared_schema)
    _drop_index_if_exists(op.f("ix_free_credit_requests_status"), "free_credit_requests", schema=shared_schema)
    _drop_index_if_exists(op.f("ix_free_credit_requests_source"), "free_credit_requests", schema=shared_schema)
    _drop_index_if_exists(op.f("ix_free_credit_requests_user_id"), "free_credit_requests", schema=shared_schema)
    _drop_table_if_exists("free_credit_requests", schema=shared_schema)

    _drop_index_if_exists(op.f("ix_payment_attempts_credit_grant_id"), "payment_attempts", schema=shared_schema)
    _drop_index_if_exists(op.f("ix_payment_attempts_provider_reference"), "payment_attempts", schema=shared_schema)
    _drop_index_if_exists(op.f("ix_payment_attempts_status"), "payment_attempts", schema=shared_schema)
    _drop_index_if_exists(op.f("ix_payment_attempts_user_id"), "payment_attempts", schema=shared_schema)
    _drop_table_if_exists("payment_attempts", schema=shared_schema)

    _drop_index_if_exists(op.f("ix_credit_grants_payment_reference"), "credit_grants", schema=shared_schema)
    _drop_column_if_exists("credit_grants", "payment_reference", schema=shared_schema)
    _drop_column_if_exists("credit_grants", "payment_provider", schema=shared_schema)
    _drop_column_if_exists("credit_grants", "source", schema=shared_schema)
