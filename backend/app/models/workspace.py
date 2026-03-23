from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.db.session import Base


class Workspace(Base, kw_only=True):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, index=True)
    app_id: Mapped[str] = mapped_column(Text, index=True)
    name: Mapped[str] = mapped_column(Text)
    active_chat_id: Mapped[str | None] = mapped_column(Text, default=None)
    selected_item_id: Mapped[str | None] = mapped_column(Text, default=None)
    current_report_item_id: Mapped[str | None] = mapped_column(Text, default=None)
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
    items: Mapped[list["WorkspaceItem"]] = relationship(
        back_populates="workspace",
        default_factory=list,
        cascade="all, delete-orphan",
    )


class WorkspaceItem(Base, kw_only=True):
    __tablename__ = "workspace_items"

    id: Mapped[str] = mapped_column(primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id"),
        index=True,
    )
    item_origin: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    created_by_user_id: Mapped[str] = mapped_column(Text)
    name: Mapped[str | None] = mapped_column(Text, default=None)
    title: Mapped[str | None] = mapped_column(Text, default=None)
    content_key: Mapped[str | None] = mapped_column(Text, index=True, default=None)
    extension: Mapped[str] = mapped_column(Text, default="")
    mime_type: Mapped[str | None] = mapped_column(Text, default=None)
    byte_size: Mapped[int | None] = mapped_column(Integer, default=None)
    local_status: Mapped[str | None] = mapped_column(Text, default=None)
    source_item_id: Mapped[str | None] = mapped_column(Text, default=None)
    preview_json: Mapped[dict] = mapped_column(JSON, default_factory=dict)
    schema_version: Mapped[str | None] = mapped_column(Text, default=None)
    current_revision: Mapped[int | None] = mapped_column(Integer, default=None)
    created_by_agent_id: Mapped[str | None] = mapped_column(Text, default=None)
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
    workspace: Mapped[Workspace] = relationship(back_populates="items", init=False)
    revisions: Mapped[list["WorkspaceItemRevision"]] = relationship(
        back_populates="item",
        default_factory=list,
        cascade="all, delete-orphan",
        order_by="WorkspaceItemRevision.revision",
    )


class WorkspaceItemRevision(Base, kw_only=True):
    __tablename__ = "workspace_item_revisions"

    pk: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        init=False,
        autoincrement=True,
    )
    item_id: Mapped[str] = mapped_column(
        ForeignKey("workspace_items.id"),
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer)
    op: Mapped[str] = mapped_column(Text)
    created_by_user_id: Mapped[str] = mapped_column(Text)
    payload_json: Mapped[dict] = mapped_column(JSON, default_factory=dict)
    summary_json: Mapped[dict] = mapped_column(JSON, default_factory=dict)
    created_by_agent_id: Mapped[str | None] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
    )
    item: Mapped[WorkspaceItem] = relationship(
        back_populates="revisions",
        init=False,
    )
