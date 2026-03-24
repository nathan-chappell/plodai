from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.schemas.workspace import WorkspaceAppId


class PlodaiEntitySchemaBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlodaiEntitySearchRequest(PlodaiEntitySchemaBase):
    app_id: WorkspaceAppId
    workspace_id: str
    thread_id: str
    query: str = Field(default="", max_length=200)


class PlodaiComposerEntity(PlodaiEntitySchemaBase):
    id: str
    title: str
    icon: str | None = None
    interactive: bool = True
    group: str | None = None
    data: dict[str, str] = Field(default_factory=dict)


class PlodaiEntitySearchResponse(PlodaiEntitySchemaBase):
    entities: list[PlodaiComposerEntity] = Field(default_factory=list)


PlodaiEntityType = Literal[
    "thread_image",
    "farm_crop",
    "farm_order",
]
