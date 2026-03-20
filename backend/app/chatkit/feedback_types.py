from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


FeedbackKind = Literal["positive", "negative"]
FeedbackOrigin = Literal["interactive", "ui_integration_test"]


class ChatItemFeedbackRecord(BaseModel):
    id: str
    thread_id: str
    item_ids: list[str] = Field(default_factory=list)
    user_email: str | None = None
    kind: FeedbackKind | None = None
    message: str | None = None
    origin: FeedbackOrigin


class SubmitFeedbackSessionPayload(BaseModel):
    session_id: str
    selected_option: str | None = None
    sentiment: FeedbackKind | None = None
    message: str | None = None


class CancelFeedbackSessionPayload(BaseModel):
    session_id: str
