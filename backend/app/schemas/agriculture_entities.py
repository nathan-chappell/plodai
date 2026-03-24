from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.schemas.workspace import WorkspaceAppId


class AgricultureEntitySchemaBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgricultureEntitySearchRequest(AgricultureEntitySchemaBase):
    app_id: WorkspaceAppId
    workspace_id: str
    thread_id: str
    query: str = Field(default="", max_length=200)


class AgricultureComposerEntity(AgricultureEntitySchemaBase):
    id: str
    title: str
    icon: str | None = None
    interactive: bool = True
    group: str | None = None
    data: dict[str, str] = Field(default_factory=dict)


class AgricultureEntitySearchResponse(AgricultureEntitySchemaBase):
    entities: list[AgricultureComposerEntity] = Field(default_factory=list)


AgricultureEntityType = Literal[
    "thread_image",
    "farm_crop",
    "farm_issue",
    "farm_project",
    "farm_current_work",
    "farm_order",
]
