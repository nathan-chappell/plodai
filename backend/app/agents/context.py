from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class ReportAgentContext:
    report_id: str
    user_email: str
    db: AsyncSession
    dataset_ids: list[str] = field(default_factory=list)
    chart_cache: dict[str, str] = field(default_factory=dict)
    thread_metadata: dict[str, Any] = field(default_factory=dict)
