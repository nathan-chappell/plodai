"""initial schema

Revision ID: 20260427_0001
Revises:
Create Date: 2026-04-27
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260427_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "farms",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_farms_user_id"), "farms", ["user_id"], unique=False)

    op.create_table(
        "user_credit_balances",
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("current_credit_usd", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
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
    )
    op.create_index(op.f("ix_cost_events_response_id"), "cost_events", ["response_id"], unique=False)
    op.create_index(op.f("ix_cost_events_thread_id"), "cost_events", ["thread_id"], unique=False)
    op.create_index(op.f("ix_cost_events_user_id"), "cost_events", ["user_id"], unique=False)

    op.create_table(
        "credit_grants",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("admin_user_id", sa.Text(), nullable=True),
        sa.Column("credit_amount_usd", sa.Float(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_credit_grants_admin_user_id"), "credit_grants", ["admin_user_id"], unique=False)
    op.create_index(op.f("ix_credit_grants_user_id"), "credit_grants", ["user_id"], unique=False)

    op.create_table(
        "farm_chats",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("farm_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("status_json", sa.JSON(), nullable=False),
        sa.Column("allowed_image_domains_json", sa.JSON(), nullable=True),
        sa.Column("updated_sequence", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["farm_id"], ["farms.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("farm_id"),
    )
    op.create_index(op.f("ix_farm_chats_farm_id"), "farm_chats", ["farm_id"], unique=True)
    op.create_index(op.f("ix_farm_chats_updated_sequence"), "farm_chats", ["updated_sequence"], unique=False)
    op.create_index(op.f("ix_farm_chats_user_id"), "farm_chats", ["user_id"], unique=False)

    op.create_table(
        "farm_records",
        sa.Column("farm_id", sa.String(), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["farm_id"], ["farms.id"]),
        sa.PrimaryKeyConstraint("farm_id"),
    )

    op.create_table(
        "farm_chat_attachments",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "farm_chat_entries",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("chat_id", sa.String(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], ["farm_chats.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_farm_chat_entries_chat_id"), "farm_chat_entries", ["chat_id"], unique=False)
    op.create_index(op.f("ix_farm_chat_entries_sequence"), "farm_chat_entries", ["sequence"], unique=False)

    op.create_table(
        "farm_images",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("farm_id", sa.String(), nullable=False),
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
        sa.ForeignKeyConstraint(["chat_id"], ["farm_chats.id"]),
        sa.ForeignKeyConstraint(["farm_id"], ["farms.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_farm_images_attachment_id"), "farm_images", ["attachment_id"], unique=False)
    op.create_index(op.f("ix_farm_images_chat_id"), "farm_images", ["chat_id"], unique=False)
    op.create_index(op.f("ix_farm_images_farm_id"), "farm_images", ["farm_id"], unique=False)
    op.create_index(op.f("ix_farm_images_source_kind"), "farm_images", ["source_kind"], unique=False)
    op.create_index(op.f("ix_farm_images_status"), "farm_images", ["status"], unique=False)
    op.create_index(op.f("ix_farm_images_storage_key"), "farm_images", ["storage_key"], unique=True)
    op.create_index(op.f("ix_farm_images_storage_provider"), "farm_images", ["storage_provider"], unique=False)
    op.create_index(op.f("ix_farm_images_user_id"), "farm_images", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_farm_images_user_id"), table_name="farm_images")
    op.drop_index(op.f("ix_farm_images_storage_provider"), table_name="farm_images")
    op.drop_index(op.f("ix_farm_images_storage_key"), table_name="farm_images")
    op.drop_index(op.f("ix_farm_images_status"), table_name="farm_images")
    op.drop_index(op.f("ix_farm_images_source_kind"), table_name="farm_images")
    op.drop_index(op.f("ix_farm_images_farm_id"), table_name="farm_images")
    op.drop_index(op.f("ix_farm_images_chat_id"), table_name="farm_images")
    op.drop_index(op.f("ix_farm_images_attachment_id"), table_name="farm_images")
    op.drop_table("farm_images")
    op.drop_index(op.f("ix_farm_chat_entries_sequence"), table_name="farm_chat_entries")
    op.drop_index(op.f("ix_farm_chat_entries_chat_id"), table_name="farm_chat_entries")
    op.drop_table("farm_chat_entries")
    op.drop_table("farm_chat_attachments")
    op.drop_table("farm_records")
    op.drop_index(op.f("ix_farm_chats_user_id"), table_name="farm_chats")
    op.drop_index(op.f("ix_farm_chats_updated_sequence"), table_name="farm_chats")
    op.drop_index(op.f("ix_farm_chats_farm_id"), table_name="farm_chats")
    op.drop_table("farm_chats")
    op.drop_index(op.f("ix_credit_grants_user_id"), table_name="credit_grants")
    op.drop_index(op.f("ix_credit_grants_admin_user_id"), table_name="credit_grants")
    op.drop_table("credit_grants")
    op.drop_index(op.f("ix_cost_events_user_id"), table_name="cost_events")
    op.drop_index(op.f("ix_cost_events_thread_id"), table_name="cost_events")
    op.drop_index(op.f("ix_cost_events_response_id"), table_name="cost_events")
    op.drop_table("cost_events")
    op.drop_table("user_credit_balances")
    op.drop_index(op.f("ix_farms_user_id"), table_name="farms")
    op.drop_table("farms")
