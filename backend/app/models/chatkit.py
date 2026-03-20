from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.chatkit.feedback_types import FeedbackKind, FeedbackOrigin
from backend.app.db.session import Base


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, index=True)
    title: Mapped[str | None] = mapped_column(Text, default="New report")
    metadata_json: Mapped[dict] = mapped_column(JSON, default_factory=dict)
    status_json: Mapped[dict] = mapped_column(
        JSON, default_factory=lambda: {"type": "active"}
    )
    allowed_image_domains_json: Mapped[list[str] | None] = mapped_column(
        JSON, default=None
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
    items: Mapped[list["ChatItem"]] = relationship(
        back_populates="thread",
        default_factory=list,
        cascade="all, delete-orphan",
    )


class ChatItem(Base):
    __tablename__ = "chat_items"

    id: Mapped[str] = mapped_column(primary_key=True)
    thread_id: Mapped[str] = mapped_column(ForeignKey("chat_threads.id"), index=True)
    kind: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, default_factory=dict)
    sequence: Mapped[int] = mapped_column(Integer, index=True, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
    )
    thread: Mapped[ChatThread] = relationship(back_populates="items", init=False)


class ChatAttachment(Base):
    __tablename__ = "chat_attachments"

    id: Mapped[str] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, default_factory=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
    )


class ChatItemFeedback(Base):
    __tablename__ = "chat_item_feedback"

    id: Mapped[str] = mapped_column(primary_key=True)
    thread_id: Mapped[str] = mapped_column(ForeignKey("chat_threads.id"), index=True)
    item_ids_json: Mapped[list[str]] = mapped_column(JSON, default_factory=list)
    user_email: Mapped[str | None] = mapped_column(Text, index=True, default=None)
    kind: Mapped[FeedbackKind | None] = mapped_column(Text, default=None)
    label: Mapped[str | None] = mapped_column(Text, default=None)
    message: Mapped[str | None] = mapped_column(Text, default=None)
    origin: Mapped[FeedbackOrigin] = mapped_column(Text, default="interactive")
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
