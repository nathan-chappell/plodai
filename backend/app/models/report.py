from datetime import UTC, datetime

from sqlalchemy import DateTime, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ReportRun(Base):
    __tablename__ = "report_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(255), index=True)
    prompt: Mapped[str] = mapped_column(Text())
    status: Mapped[str] = mapped_column(String(32), default="draft")
    uploaded_files: Mapped[list[dict]] = mapped_column(JSON, default=list)
    sections: Mapped[list[dict]] = mapped_column(JSON, default=list)
    charts: Mapped[list[dict]] = mapped_column(JSON, default=list)
    tool_log: Mapped[list[dict]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
