from __future__ import annotations

from typing import TypedDict, cast

from pydantic import BaseModel, ConfigDict, field_validator

from backend.app.chatkit.feedback_types import FeedbackOrigin


class ThreadUsageTotalsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_tokens: int
    output_tokens: int
    cost_usd: float


class AppChatMetadataModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    openai_conversation_id: str | None = None
    openai_previous_response_id: str | None = None
    usage: ThreadUsageTotalsModel | None = None
    origin: FeedbackOrigin | None = None

    @field_validator(
        "title",
        "openai_conversation_id",
        "openai_previous_response_id",
        mode="before",
    )
    @classmethod
    def _normalize_optional_text(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("expected a string or null")
        stripped = value.strip()
        if not stripped:
            raise ValueError("expected a non-empty string")
        return stripped


class ChatMetadataPatch(TypedDict, total=False):
    title: str | None
    openai_conversation_id: str | None
    openai_previous_response_id: str | None
    usage: ThreadUsageTotalsModel | dict[str, object] | None
    origin: FeedbackOrigin | None


class AppChatMetadata(TypedDict, total=False):
    title: str
    openai_conversation_id: str
    openai_previous_response_id: str
    usage: dict[str, object]
    origin: FeedbackOrigin


def parse_chat_metadata(value: object) -> AppChatMetadata:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("chat metadata must be an object")
    parsed = AppChatMetadataModel.model_validate(value)
    return cast(
        AppChatMetadata,
        parsed.model_dump(mode="json", exclude_none=True),
    )


def merge_chat_metadata(
    current: AppChatMetadata | dict[str, object] | None,
    patch: ChatMetadataPatch | dict[str, object],
) -> AppChatMetadata:
    merged: dict[str, object] = dict(parse_chat_metadata(current))
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
            continue
        merged[key] = value
    return parse_chat_metadata(merged)
