from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AdvisorySchemaBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


AdvisorySeverity = Literal["low", "medium", "high"]
AdvisorySubjectKind = Literal[
    "crop",
    "livestock",
    "parcel",
    "equipment",
    "infrastructure",
    "market",
    "administrative",
    "other",
]
AdvisorySubjectStatus = Literal["planned", "active", "inactive", "resolved"]
AdvisoryReportCategory = Literal[
    "pest",
    "disease",
    "weather_damage",
    "drought",
    "flood",
    "input_shortage",
    "market_bottleneck",
    "infrastructure_damage",
    "livestock_health",
    "subsidy_or_payment",
    "invasive_species",
    "other",
]
AdvisoryReportStatus = Literal["open", "monitoring", "resolved", "escalated"]
AdvisoryQueryCategory = Literal[
    "production",
    "plant_health",
    "livestock_health",
    "input_sourcing",
    "regulatory",
    "subsidy",
    "market",
    "weather",
    "other",
]
AdvisoryQueryStatus = Literal["open", "answered", "needs_follow_up"]
AdvisoryMaterialStatus = Literal[
    "to_check",
    "available",
    "not_available",
    "ordered",
]


class AdvisorySubject(AdvisorySchemaBase):
    id: str
    name: str
    kind: AdvisorySubjectKind
    type: str | None = None
    location: str | None = None
    description: str | None = None
    quantity: str | None = None
    status: AdvisorySubjectStatus | None = None
    notes: str | None = None


class AdvisoryMeasurement(AdvisorySchemaBase):
    id: str
    label: str
    value: str
    unit: str | None = None
    measured_at: str | None = None
    method: str | None = None
    location: str | None = None
    subject_ids: list[str] = Field(default_factory=list)
    report_ids: list[str] = Field(default_factory=list)
    query_ids: list[str] = Field(default_factory=list)
    notes: str | None = None


class AdvisoryReport(AdvisorySchemaBase):
    id: str
    category: AdvisoryReportCategory
    title: str
    description: str | None = None
    status: AdvisoryReportStatus | None = None
    severity: AdvisorySeverity | None = None
    reported_at: str | None = None
    observed_at: str | None = None
    location: str | None = None
    recommended_follow_up: str | None = None
    subject_ids: list[str] = Field(default_factory=list)
    evidence_image_ids: list[str] = Field(default_factory=list)
    measurement_ids: list[str] = Field(default_factory=list)


class AdvisoryQuery(AdvisorySchemaBase):
    id: str
    category: AdvisoryQueryCategory
    question: str
    status: AdvisoryQueryStatus = "open"
    asked_at: str | None = None
    answer_summary: str | None = None
    source_urls: list[str] = Field(default_factory=list)
    subject_ids: list[str] = Field(default_factory=list)
    report_ids: list[str] = Field(default_factory=list)
    measurement_ids: list[str] = Field(default_factory=list)
    notes: str | None = None


class AdvisoryMaterial(AdvisorySchemaBase):
    id: str
    name: str
    purpose: str | None = None
    category: str | None = None
    status: AdvisoryMaterialStatus = "to_check"
    supplier_name: str | None = None
    supplier_url: str | None = None
    subject_ids: list[str] = Field(default_factory=list)
    report_ids: list[str] = Field(default_factory=list)
    query_ids: list[str] = Field(default_factory=list)
    notes: str | None = None


class AdvisoryRecordPayload(AdvisorySchemaBase):
    version: Literal["v2"]
    title: str
    profile_description: str | None = None
    default_location: str | None = None
    subjects: list[AdvisorySubject] = Field(default_factory=list)
    reports: list[AdvisoryReport] = Field(default_factory=list)
    queries: list[AdvisoryQuery] = Field(default_factory=list)
    measurements: list[AdvisoryMeasurement] = Field(default_factory=list)
    materials: list[AdvisoryMaterial] = Field(default_factory=list)


class AdvisoryCaseSummary(AdvisorySchemaBase):
    id: str
    title: str
    chat_id: str | None = None
    image_count: int = Field(ge=0)
    created_at: str
    updated_at: str


class AdvisoryImageSummary(AdvisorySchemaBase):
    id: str
    case_id: str
    chat_id: str | None = None
    attachment_id: str | None = None
    source_kind: Literal["upload", "chat_attachment"]
    name: str
    mime_type: str | None = None
    byte_size: int = Field(ge=0)
    width: int = Field(ge=0)
    height: int = Field(ge=0)
    detailed_description: str | None = None
    location_label: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    preview_url: str | None = None
    created_at: str
    updated_at: str


class AdvisoryCaseDetail(AdvisoryCaseSummary):
    default_location: str | None = None
    profile_description: str | None = None
    images: list[AdvisoryImageSummary] = Field(default_factory=list)


class AdvisoryCaseCreateRequest(AdvisorySchemaBase):
    title: str


class AdvisoryCaseUpdateRequest(AdvisorySchemaBase):
    title: str | None = None


class AdvisoryRecordResponse(AdvisorySchemaBase):
    case_id: str
    record: AdvisoryRecordPayload


class AdvisoryRecordUpdateRequest(AdvisorySchemaBase):
    record: AdvisoryRecordPayload


class AdvisoryCaseDeleteResponse(AdvisorySchemaBase):
    case_id: str
    deleted: bool


class AdvisoryImageListResponse(AdvisorySchemaBase):
    case_id: str
    images: list[AdvisoryImageSummary] = Field(default_factory=list)


class AdvisoryImageUploadResponse(AdvisorySchemaBase):
    image: AdvisoryImageSummary


class AdvisoryImageDeleteResponse(AdvisorySchemaBase):
    case_id: str
    image_id: str
    deleted: bool
