from datetime import UTC, datetime
from typing import Literal

from pydantic import SecretStr
from sqlalchemy import Boolean, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.db.types import SecretStrText
from app.models.types import UserRole


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(init=False, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(Text, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(Text, default="")
    password_hash: Mapped[SecretStr] = mapped_column(SecretStrText())
    role: Mapped[UserRole] = mapped_column(Text, default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
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
