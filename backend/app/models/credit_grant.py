from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base


class CreditGrant(Base):
    __tablename__ = "credit_grants"

    id: Mapped[str] = mapped_column(
        Text,
        primary_key=True,
        default_factory=lambda: str(uuid4()),
        kw_only=True,
    )
    user_id: Mapped[str] = mapped_column(Text, index=True)
    admin_user_id: Mapped[str | None] = mapped_column(
        Text,
        index=True,
        default=None,
        kw_only=True,
    )
    credit_amount_usd: Mapped[float] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(Text, default=None, kw_only=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        init=False,
        default_factory=lambda: datetime.now(UTC),
    )
