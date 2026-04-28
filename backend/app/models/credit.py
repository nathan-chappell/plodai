from datetime import UTC, datetime

from sqlalchemy import DateTime, Float, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base
from backend.app.db.schemas import SHARED_SCHEMA_KEY


class UserCreditBalance(Base):
    __tablename__ = "user_credit_balances"
    __table_args__ = {"schema": SHARED_SCHEMA_KEY}

    user_id: Mapped[str] = mapped_column(Text, primary_key=True)
    current_credit_usd: Mapped[float] = mapped_column(Float, default=0.0)
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
