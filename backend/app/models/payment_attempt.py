from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base
from backend.app.db.schemas import SHARED_SCHEMA_KEY


class PaymentAttempt(Base):
    __tablename__ = "payment_attempts"
    __table_args__ = {"schema": SHARED_SCHEMA_KEY}

    id: Mapped[str] = mapped_column(
        Text,
        primary_key=True,
        default_factory=lambda: str(uuid4()),
        kw_only=True,
    )
    user_id: Mapped[str] = mapped_column(Text, index=True)
    expected_amount_usd: Mapped[float] = mapped_column(Float)
    reference_code: Mapped[str] = mapped_column(Text, unique=True)
    expected_currency: Mapped[str] = mapped_column(Text, default="USD", kw_only=True)
    provider: Mapped[str] = mapped_column(Text, default="paypal", kw_only=True)
    status: Mapped[str] = mapped_column(Text, default="pending_payment", index=True, kw_only=True)
    temporary_access_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        default=None,
        kw_only=True,
    )
    provider_reference: Mapped[str | None] = mapped_column(Text, index=True, default=None, kw_only=True)
    credit_grant_id: Mapped[str | None] = mapped_column(Text, index=True, default=None, kw_only=True)
    receipt_filename: Mapped[str | None] = mapped_column(Text, default=None, kw_only=True)
    receipt_media_type: Mapped[str | None] = mapped_column(Text, default=None, kw_only=True)
    receipt_text_excerpt: Mapped[str | None] = mapped_column(Text, default=None, kw_only=True)
    review_json: Mapped[dict[str, object]] = mapped_column(JSON, default_factory=dict, kw_only=True)
    decision_note: Mapped[str | None] = mapped_column(Text, default=None, kw_only=True)
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
