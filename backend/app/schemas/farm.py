from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FarmSchemaBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


FarmWorkItemSeverity = Literal["low", "medium", "high"]
FarmCropStatus = Literal["planned", "active", "harvested", "inactive"]
FarmWorkItemKind = Literal["issue", "task", "observation"]
FarmWorkItemStatus = Literal["open", "monitoring", "resolved"]


class FarmArea(FarmSchemaBase):
    id: str
    name: str
    kind: str | None = None
    description: str | None = None


class FarmCrop(FarmSchemaBase):
    id: str
    name: str
    type: str | None = None
    quantity: str | None = None
    expected_yield: str | None = None
    area_ids: list[str] = Field(default_factory=list)
    status: FarmCropStatus | None = None
    notes: str | None = None


class FarmWorkItem(FarmSchemaBase):
    id: str
    kind: FarmWorkItemKind
    title: str
    description: str | None = None
    status: FarmWorkItemStatus | None = None
    severity: FarmWorkItemSeverity | None = None
    observed_at: str | None = None
    due_at: str | None = None
    recommended_follow_up: str | None = None
    related_crop_ids: list[str] = Field(default_factory=list)
    related_area_ids: list[str] = Field(default_factory=list)
    related_image_ids: list[str] = Field(default_factory=list)


class FarmOrderItem(FarmSchemaBase):
    id: str
    label: str
    quantity: str | None = None
    crop_id: str | None = None
    notes: str | None = None


class FarmOrder(FarmSchemaBase):
    id: str
    title: str
    status: Literal["draft", "live", "sold_out"] = "draft"
    summary: str | None = None
    price_label: str | None = None
    order_url: str | None = None
    items: list[FarmOrderItem] = Field(default_factory=list)
    hero_image_file_id: str | None = None
    hero_image_alt_text: str | None = None
    notes: str | None = None


class FarmRecordPayload(FarmSchemaBase):
    version: Literal["v1"]
    farm_name: str
    description: str | None = None
    location: str | None = None
    areas: list[FarmArea] = Field(default_factory=list)
    crops: list[FarmCrop] = Field(default_factory=list)
    work_items: list[FarmWorkItem] = Field(default_factory=list)
    orders: list[FarmOrder] = Field(default_factory=list)


class FarmSummary(FarmSchemaBase):
    id: str
    name: str
    chat_id: str | None = None
    image_count: int = Field(ge=0)
    created_at: str
    updated_at: str


class FarmImageSummary(FarmSchemaBase):
    id: str
    farm_id: str
    chat_id: str | None = None
    attachment_id: str | None = None
    source_kind: Literal["upload", "chat_attachment"]
    name: str
    mime_type: str | None = None
    byte_size: int = Field(ge=0)
    width: int = Field(ge=0)
    height: int = Field(ge=0)
    preview_url: str | None = None
    created_at: str
    updated_at: str


class FarmDetail(FarmSummary):
    location: str | None = None
    description: str | None = None
    images: list[FarmImageSummary] = Field(default_factory=list)


class FarmCreateRequest(FarmSchemaBase):
    name: str


class FarmUpdateRequest(FarmSchemaBase):
    name: str | None = None


class FarmRecordResponse(FarmSchemaBase):
    farm_id: str
    record: FarmRecordPayload


class FarmRecordUpdateRequest(FarmSchemaBase):
    record: FarmRecordPayload


class FarmDeleteResponse(FarmSchemaBase):
    farm_id: str
    deleted: bool


class FarmImageListResponse(FarmSchemaBase):
    farm_id: str
    images: list[FarmImageSummary] = Field(default_factory=list)


class FarmImageUploadResponse(FarmSchemaBase):
    image: FarmImageSummary


class FarmImageDeleteResponse(FarmSchemaBase):
    farm_id: str
    image_id: str
    deleted: bool


class PublicFarmOrderResponse(FarmSchemaBase):
    farm_id: str
    farm_name: str
    location: str | None = None
    order: FarmOrder
    hero_image_preview_url: str | None = None
