from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base


class StoredFile(Base, kw_only=True):
    __tablename__ = "stored_files"

    id: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, index=True)
    app_id: Mapped[str | None] = mapped_column(Text, index=True, default=None)
    workspace_id: Mapped[str | None] = mapped_column(Text, index=True, default=None)
    thread_id: Mapped[str | None] = mapped_column(Text, index=True, default=None)
    attachment_id: Mapped[str | None] = mapped_column(Text, index=True, default=None)
    scope: Mapped[str] = mapped_column(Text, index=True)
    source_kind: Mapped[str] = mapped_column(Text)
    parent_file_id: Mapped[str | None] = mapped_column(Text, index=True, default=None)
    storage_provider: Mapped[str] = mapped_column(Text, index=True)
    storage_key: Mapped[str] = mapped_column(Text, unique=True, index=True)
    name: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text, index=True)
    extension: Mapped[str] = mapped_column(Text, default="")
    mime_type: Mapped[str | None] = mapped_column(Text, default=None)
    byte_size: Mapped[int | None] = mapped_column(Integer, default=None)
    status: Mapped[str] = mapped_column(Text, index=True, default="available")
    preview_json: Mapped[dict] = mapped_column(JSON, default_factory=dict)
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
