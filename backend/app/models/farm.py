from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base


class Farm(Base, kw_only=True):
    __tablename__ = "farms"

    id: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, index=True)
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )


class FarmRecord(Base, kw_only=True):
    __tablename__ = "farm_records"

    farm_id: Mapped[str] = mapped_column(
        ForeignKey("farms.id"),
        primary_key=True,
    )
    payload_json: Mapped[dict] = mapped_column(JSON, default_factory=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )


class FarmImage(Base, kw_only=True):
    __tablename__ = "farm_images"

    id: Mapped[str] = mapped_column(primary_key=True)
    farm_id: Mapped[str] = mapped_column(ForeignKey("farms.id"), index=True)
    user_id: Mapped[str] = mapped_column(Text, index=True)
    chat_id: Mapped[str | None] = mapped_column(
        ForeignKey("farm_chats.id"),
        index=True,
        default=None,
    )
    attachment_id: Mapped[str | None] = mapped_column(Text, index=True, default=None)
    storage_provider: Mapped[str] = mapped_column(Text, index=True)
    storage_key: Mapped[str] = mapped_column(Text, unique=True, index=True)
    source_kind: Mapped[str] = mapped_column(Text, index=True)
    name: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str | None] = mapped_column(Text, default=None)
    byte_size: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, index=True, default="available")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )


class FarmChat(Base, kw_only=True):
    __tablename__ = "farm_chats"

    id: Mapped[str] = mapped_column(primary_key=True)
    farm_id: Mapped[str] = mapped_column(
        ForeignKey("farms.id"),
        index=True,
        unique=True,
    )
    user_id: Mapped[str] = mapped_column(Text, index=True)
    title: Mapped[str | None] = mapped_column(Text, default="New chat")
    metadata_json: Mapped[dict] = mapped_column(JSON, default_factory=dict)
    status_json: Mapped[dict] = mapped_column(
        JSON,
        default_factory=lambda: {"type": "active"},
    )
    allowed_image_domains_json: Mapped[list[str] | None] = mapped_column(
        JSON,
        default=None,
    )
    updated_sequence: Mapped[int] = mapped_column(Integer, index=True, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )


class FarmChatEntry(Base, kw_only=True):
    __tablename__ = "farm_chat_entries"

    id: Mapped[str] = mapped_column(primary_key=True)
    chat_id: Mapped[str] = mapped_column(ForeignKey("farm_chats.id"), index=True)
    kind: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, default_factory=dict)
    sequence: Mapped[int] = mapped_column(Integer, index=True, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
    )


class FarmChatAttachment(Base, kw_only=True):
    __tablename__ = "farm_chat_attachments"

    id: Mapped[str] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, default_factory=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
    )
