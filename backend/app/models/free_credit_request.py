from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base
from backend.app.db.schemas import SHARED_SCHEMA_KEY


class FreeCreditRequest(Base):
    __tablename__ = "free_credit_requests"
    __table_args__ = {"schema": SHARED_SCHEMA_KEY}

    id: Mapped[str] = mapped_column(
        Text,
        primary_key=True,
        default_factory=lambda: str(uuid4()),
        kw_only=True,
    )
    user_id: Mapped[str] = mapped_column(Text, index=True)
    requested_amount_usd: Mapped[float | None] = mapped_column(Float, default=None, kw_only=True)
    source: Mapped[str] = mapped_column(Text, default="general", index=True, kw_only=True)
    reason: Mapped[str] = mapped_column(Text)
    linkedin_profile_url: Mapped[str | None] = mapped_column(Text, default=None, kw_only=True)
    relationship_note: Mapped[str | None] = mapped_column(Text, default=None, kw_only=True)
    intended_use: Mapped[str | None] = mapped_column(Text, default=None, kw_only=True)
    evidence_verified: Mapped[bool] = mapped_column(default=False, kw_only=True)
    idempotency_key: Mapped[str | None] = mapped_column(Text, index=True, default=None, kw_only=True)
    status: Mapped[str] = mapped_column(Text, default="pending", index=True, kw_only=True)
    decided_amount_usd: Mapped[float | None] = mapped_column(Float, default=None, kw_only=True)
    decision_note: Mapped[str | None] = mapped_column(Text, default=None, kw_only=True)
    reviewer_user_id: Mapped[str | None] = mapped_column(Text, index=True, default=None, kw_only=True)
    credit_grant_id: Mapped[str | None] = mapped_column(Text, index=True, default=None, kw_only=True)
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
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        default=None,
        kw_only=True,
    )
