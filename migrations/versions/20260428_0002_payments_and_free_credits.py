"""add shared payment and free-credit records

Revision ID: 20260428_0002
Revises: 20260427_0001
Create Date: 2026-04-28
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

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


def upgrade() -> None:
    shared_schema = _shared_schema()

    op.add_column(
        "credit_grants",
        sa.Column("source", sa.Text(), nullable=False, server_default="admin_manual"),
        schema=shared_schema,
    )
    op.add_column(
        "credit_grants",
        sa.Column("payment_provider", sa.Text(), nullable=True),
        schema=shared_schema,
    )
    op.add_column(
        "credit_grants",
        sa.Column("payment_reference", sa.Text(), nullable=True),
        schema=shared_schema,
    )
    op.create_index(
        op.f("ix_credit_grants_payment_reference"),
        "credit_grants",
        ["payment_reference"],
        unique=False,
        schema=shared_schema,
    )

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
    op.create_index(op.f("ix_payment_attempts_user_id"), "payment_attempts", ["user_id"], unique=False, schema=shared_schema)
    op.create_index(op.f("ix_payment_attempts_status"), "payment_attempts", ["status"], unique=False, schema=shared_schema)
    op.create_index(
        op.f("ix_payment_attempts_provider_reference"),
        "payment_attempts",
        ["provider_reference"],
        unique=False,
        schema=shared_schema,
    )
    op.create_index(
        op.f("ix_payment_attempts_credit_grant_id"),
        "payment_attempts",
        ["credit_grant_id"],
        unique=False,
        schema=shared_schema,
    )

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
    op.create_index(op.f("ix_free_credit_requests_user_id"), "free_credit_requests", ["user_id"], unique=False, schema=shared_schema)
    op.create_index(op.f("ix_free_credit_requests_source"), "free_credit_requests", ["source"], unique=False, schema=shared_schema)
    op.create_index(op.f("ix_free_credit_requests_status"), "free_credit_requests", ["status"], unique=False, schema=shared_schema)
    op.create_index(
        op.f("ix_free_credit_requests_idempotency_key"),
        "free_credit_requests",
        ["idempotency_key"],
        unique=False,
        schema=shared_schema,
    )
    op.create_index(
        op.f("ix_free_credit_requests_reviewer_user_id"),
        "free_credit_requests",
        ["reviewer_user_id"],
        unique=False,
        schema=shared_schema,
    )
    op.create_index(
        op.f("ix_free_credit_requests_credit_grant_id"),
        "free_credit_requests",
        ["credit_grant_id"],
        unique=False,
        schema=shared_schema,
    )


def downgrade() -> None:
    shared_schema = _shared_schema()

    op.drop_index(op.f("ix_free_credit_requests_credit_grant_id"), table_name="free_credit_requests", schema=shared_schema)
    op.drop_index(op.f("ix_free_credit_requests_reviewer_user_id"), table_name="free_credit_requests", schema=shared_schema)
    op.drop_index(op.f("ix_free_credit_requests_idempotency_key"), table_name="free_credit_requests", schema=shared_schema)
    op.drop_index(op.f("ix_free_credit_requests_status"), table_name="free_credit_requests", schema=shared_schema)
    op.drop_index(op.f("ix_free_credit_requests_source"), table_name="free_credit_requests", schema=shared_schema)
    op.drop_index(op.f("ix_free_credit_requests_user_id"), table_name="free_credit_requests", schema=shared_schema)
    op.drop_table("free_credit_requests", schema=shared_schema)

    op.drop_index(op.f("ix_payment_attempts_credit_grant_id"), table_name="payment_attempts", schema=shared_schema)
    op.drop_index(op.f("ix_payment_attempts_provider_reference"), table_name="payment_attempts", schema=shared_schema)
    op.drop_index(op.f("ix_payment_attempts_status"), table_name="payment_attempts", schema=shared_schema)
    op.drop_index(op.f("ix_payment_attempts_user_id"), table_name="payment_attempts", schema=shared_schema)
    op.drop_table("payment_attempts", schema=shared_schema)

    op.drop_index(op.f("ix_credit_grants_payment_reference"), table_name="credit_grants", schema=shared_schema)
    op.drop_column("credit_grants", "payment_reference", schema=shared_schema)
    op.drop_column("credit_grants", "payment_provider", schema=shared_schema)
    op.drop_column("credit_grants", "source", schema=shared_schema)
