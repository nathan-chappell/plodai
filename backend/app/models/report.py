from datetime import UTC, datetime

from sqlalchemy import DateTime, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.db.session import Base


class ReportRun(Base):
    __tablename__ = "report_runs"

    id: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(Text, index=True)
    prompt: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="draft")
    uploaded_files: Mapped[list[dict]] = mapped_column(JSON, default_factory=list)
    sections: Mapped[list[dict]] = mapped_column(JSON, default_factory=list)
    charts: Mapped[list[dict]] = mapped_column(JSON, default_factory=list)
    tool_log: Mapped[list[dict]] = mapped_column(JSON, default_factory=list)
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
