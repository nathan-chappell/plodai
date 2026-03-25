from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.chatkit.metadata import AppChatMetadata
from backend.app.schemas.farm import FarmImageSummary, FarmRecordPayload


@dataclass(kw_only=True)
class FarmAgentContext:
    chat_id: str
    user_id: str
    user_email: str | None
    db: AsyncSession
    farm_id: str
    farm_name: str
    thread_title: str | None = None
    assistant_turn_count: int = 0
    request_metadata: AppChatMetadata = field(default_factory=dict)
    thread_metadata: AppChatMetadata = field(default_factory=dict)
    current_record: FarmRecordPayload | None = None
    farm_images: list[FarmImageSummary] = field(default_factory=list)
