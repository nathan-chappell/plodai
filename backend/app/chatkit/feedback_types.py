from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


FeedbackKind = Literal["positive", "negative"]
FeedbackLabel = Literal["ui", "tools", "behavior"]
FeedbackOrigin = Literal["interactive", "ui_integration_test"]


class ChatItemFeedbackRecord(BaseModel):
    id: str
    thread_id: str
    item_ids: list[str] = Field(default_factory=list)
    user_email: str | None = None
    kind: FeedbackKind | None = None
    label: FeedbackLabel | None = None
    message: str | None = None
    origin: FeedbackOrigin


class SubmitFeedbackDetailsPayload(BaseModel):
    feedback_id: str
    kind: FeedbackKind
    label: FeedbackLabel | None = None
    message: str | None = None


class CancelFeedbackDetailsPayload(BaseModel):
    feedback_id: str
