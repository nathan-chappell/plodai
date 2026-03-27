from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, cast

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.chatkit.metadata import AppChatMetadata
from backend.app.schemas.farm import FarmImageSummary, FarmRecordPayload

PreferredOutputLanguage = Literal["hr", "en"]
DEFAULT_PREFERRED_OUTPUT_LANGUAGE: PreferredOutputLanguage = "hr"


def resolve_preferred_output_language(value: object) -> PreferredOutputLanguage:
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"hr", "en"}:
            return cast(PreferredOutputLanguage, normalized)
    return DEFAULT_PREFERRED_OUTPUT_LANGUAGE


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
    preferred_output_language: PreferredOutputLanguage = (
        DEFAULT_PREFERRED_OUTPUT_LANGUAGE
    )
    current_record: FarmRecordPayload | None = None
    farm_images: list[FarmImageSummary] = field(default_factory=list)
