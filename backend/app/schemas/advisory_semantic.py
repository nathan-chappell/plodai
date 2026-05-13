from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AdvisorySemanticSchemaBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


AdvisorySemanticItemType = Literal["report", "query", "image"]


class AdvisorySemanticSearchHit(AdvisorySemanticSchemaBase):
    item_type: AdvisorySemanticItemType
    item_id: str
    title: str
    excerpt: str
    score: float
    source_id: str


class AdvisorySemanticSearchRequest(AdvisorySemanticSchemaBase):
    query: str = Field(min_length=1, max_length=500)
    max_results: int = Field(default=6, ge=1, le=12)


class AdvisorySemanticSearchResponse(AdvisorySemanticSchemaBase):
    query: str
    indexed_item_count: int = Field(ge=0)
    hits: list[AdvisorySemanticSearchHit] = Field(default_factory=list)
    skipped_reason: str | None = None
