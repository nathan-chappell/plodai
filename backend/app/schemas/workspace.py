from __future__ import annotations

from typing import Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.app.agents.query_models import ChartPlan


class WorkspaceSchemaBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


WorkspaceAppId: TypeAlias = Literal["agriculture", "documents"]
WorkspaceUploadKind: TypeAlias = Literal["csv", "json", "pdf", "image", "other"]
WorkspaceCreatedItemKind: TypeAlias = Literal[
    "report.v1", "chart.v1", "pdf_split.v1", "farm.v1"
]
WorkspaceLocalStatus: TypeAlias = Literal["available", "missing"]


class DatasetPreview(WorkspaceSchemaBase):
    row_count: int = Field(ge=0)
    columns: list[str]
    numeric_columns: list[str] = Field(default_factory=list)
    sample_rows: list[dict[str, object]] = Field(default_factory=list)


class PdfPreview(WorkspaceSchemaBase):
    page_count: int = Field(ge=0)


class ImagePreview(WorkspaceSchemaBase):
    width: int = Field(ge=0)
    height: int = Field(ge=0)


class EmptyPreview(WorkspaceSchemaBase):
    pass


WorkspaceUploadPreview: TypeAlias = (
    DatasetPreview | PdfPreview | ImagePreview | EmptyPreview
)


class WorkspaceUploadItemSummary(WorkspaceSchemaBase):
    origin: Literal["upload"] = "upload"
    id: str
    workspace_id: str
    name: str
    kind: WorkspaceUploadKind
    extension: str
    mime_type: str | None = None
    byte_size: int | None = Field(default=None, ge=0)
    content_key: str
    local_status: WorkspaceLocalStatus
    preview: WorkspaceUploadPreview
    source_item_id: str | None = None
    created_at: str
    updated_at: str


class WorkspaceUploadCreateRequest(WorkspaceSchemaBase):
    id: str
    name: str
    kind: WorkspaceUploadKind
    extension: str = ""
    mime_type: str | None = None
    byte_size: int | None = Field(default=None, ge=0)
    content_key: str
    local_status: WorkspaceLocalStatus = "available"
    preview: WorkspaceUploadPreview = Field(default_factory=EmptyPreview)
    source_item_id: str | None = None

    @model_validator(mode="after")
    def _preview_matches_kind(self) -> "WorkspaceUploadCreateRequest":
        if self.kind in {"csv", "json"} and not isinstance(self.preview, DatasetPreview):
            raise ValueError("dataset uploads require a dataset preview")
        if self.kind == "pdf" and not isinstance(self.preview, PdfPreview):
            raise ValueError("pdf uploads require a pdf preview")
        if self.kind == "image" and not isinstance(self.preview, ImagePreview):
            raise ValueError("image uploads require an image preview")
        if self.kind == "other" and not isinstance(self.preview, EmptyPreview):
            raise ValueError("other uploads require an empty preview")
        return self


class WorkspaceUploadDeleteResponse(WorkspaceSchemaBase):
    workspace_id: str
    item_id: str
    deleted: bool


class ReportNarrativePanel(WorkspaceSchemaBase):
    id: str
    type: Literal["narrative"]
    title: str
    markdown: str


class ReportChartPanel(WorkspaceSchemaBase):
    id: str
    type: Literal["chart"]
    title: str
    dataset_id: str
    chart_plan_id: str
    chart: ChartPlan
    image_data_url: str | None = None


class ReportImagePanel(WorkspaceSchemaBase):
    id: str
    type: Literal["image"]
    title: str
    file_id: str
    image_data_url: str | None = None
    alt_text: str | None = None


ReportSlidePanel: TypeAlias = (
    ReportNarrativePanel | ReportChartPanel | ReportImagePanel
)


class ReportSlide(WorkspaceSchemaBase):
    id: str
    created_at: str
    title: str
    layout: Literal["1x1", "1x2", "2x2"]
    panels: list[ReportSlidePanel]


class WorkspaceReportPayload(WorkspaceSchemaBase):
    version: Literal["v1"]
    report_id: str
    title: str
    created_at: str
    updated_at: str
    slides: list[ReportSlide]


class ChartItemPayload(WorkspaceSchemaBase):
    version: Literal["v1"]
    source_file_id: str
    chart_plan_id: str
    title: str
    chart: ChartPlan
    image_data_url: str | None = None
    linked_report_id: str | None = None
    projection_file_id: str | None = None


class PdfSplitEntry(WorkspaceSchemaBase):
    file_id: str
    file_name: str
    title: str
    start_page: int = Field(ge=1)
    end_page: int = Field(ge=1)
    page_count: int = Field(ge=1)


class PdfSplitItemPayload(WorkspaceSchemaBase):
    version: Literal["v1"]
    title: str
    source_file_id: str
    entries: list[PdfSplitEntry]
    archive_file_id: str
    index_file_id: str
    markdown: str


class FarmCrop(WorkspaceSchemaBase):
    id: str
    name: str
    area: str
    expected_yield: str | None = None
    notes: str | None = None


class FarmIssue(WorkspaceSchemaBase):
    id: str
    title: str
    status: Literal["open", "watching", "resolved"]
    notes: str | None = None


class FarmProject(WorkspaceSchemaBase):
    id: str
    title: str
    status: Literal["planned", "active", "done"]
    notes: str | None = None


class FarmItemPayload(WorkspaceSchemaBase):
    version: Literal["v1"]
    farm_name: str
    location: str | None = None
    crops: list[FarmCrop] = Field(default_factory=list)
    issues: list[FarmIssue] = Field(default_factory=list)
    projects: list[FarmProject] = Field(default_factory=list)
    current_work: list[str] = Field(default_factory=list)
    notes: str | None = None


WorkspaceItemPayload: TypeAlias = (
    WorkspaceReportPayload | ChartItemPayload | PdfSplitItemPayload | FarmItemPayload
)


class ReportItemSummaryData(WorkspaceSchemaBase):
    slide_count: int = Field(ge=0)


class ChartItemSummaryData(WorkspaceSchemaBase):
    source_file_id: str
    chart_plan_id: str
    projection_file_id: str | None = None


class PdfSplitItemSummaryData(WorkspaceSchemaBase):
    source_file_id: str
    entry_count: int = Field(ge=0)
    archive_file_id: str
    index_file_id: str


class FarmItemSummaryData(WorkspaceSchemaBase):
    crop_count: int = Field(ge=0)
    issue_count: int = Field(ge=0)
    project_count: int = Field(ge=0)


WorkspaceCreatedItemSummaryData: TypeAlias = (
    ReportItemSummaryData
    | ChartItemSummaryData
    | PdfSplitItemSummaryData
    | FarmItemSummaryData
)


class WorkspaceCreatedItemSummary(WorkspaceSchemaBase):
    origin: Literal["created"] = "created"
    id: str
    workspace_id: str
    kind: WorkspaceCreatedItemKind
    schema_version: Literal["v1"]
    title: str
    current_revision: int = Field(ge=1)
    created_by_user_id: str
    created_by_agent_id: str | None = None
    last_edited_by_agent_id: str | None = None
    summary: WorkspaceCreatedItemSummaryData
    latest_op: str
    created_at: str
    updated_at: str


class WorkspaceCreatedItemDetail(WorkspaceCreatedItemSummary):
    payload: WorkspaceItemPayload


WorkspaceItemSummary: TypeAlias = (
    WorkspaceUploadItemSummary | WorkspaceCreatedItemSummary
)
WorkspaceItemDetail: TypeAlias = (
    WorkspaceUploadItemSummary | WorkspaceCreatedItemDetail
)


class WorkspaceItemRevisionEntry(WorkspaceSchemaBase):
    item_id: str
    revision: int = Field(ge=1)
    op: str
    payload: WorkspaceItemPayload
    summary: WorkspaceCreatedItemSummaryData
    created_by_user_id: str
    created_by_agent_id: str | None = None
    created_at: str


class ReportSetTitleOperation(WorkspaceSchemaBase):
    op: Literal["report.set_title"]
    title: str


class ReportAppendSlideOperation(WorkspaceSchemaBase):
    op: Literal["report.append_slide"]
    slide: ReportSlide


class ReportReplaceSlideOperation(WorkspaceSchemaBase):
    op: Literal["report.replace_slide"]
    slide_id: str
    slide: ReportSlide


class ReportRemoveSlideOperation(WorkspaceSchemaBase):
    op: Literal["report.remove_slide"]
    slide_id: str


class ChartSetSpecOperation(WorkspaceSchemaBase):
    op: Literal["chart.set_spec"]
    source_file_id: str
    chart_plan_id: str
    title: str
    chart: ChartPlan
    linked_report_id: str | None = None
    projection_file_id: str | None = None


class ChartSetPreviewOperation(WorkspaceSchemaBase):
    op: Literal["chart.set_preview"]
    image_data_url: str | None = None
    projection_file_id: str | None = None


class PdfSplitSetResultOperation(WorkspaceSchemaBase):
    op: Literal["pdf_split.set_result"]
    title: str
    source_file_id: str
    entries: list[PdfSplitEntry]
    archive_file_id: str
    index_file_id: str
    markdown: str


class FarmSetStateOperation(WorkspaceSchemaBase):
    op: Literal["farm.set_state"]
    farm_name: str
    location: str | None = None
    crops: list[FarmCrop] = Field(default_factory=list)
    issues: list[FarmIssue] = Field(default_factory=list)
    projects: list[FarmProject] = Field(default_factory=list)
    current_work: list[str] = Field(default_factory=list)
    notes: str | None = None


WorkspaceItemOperation: TypeAlias = (
    ReportSetTitleOperation
    | ReportAppendSlideOperation
    | ReportReplaceSlideOperation
    | ReportRemoveSlideOperation
    | ChartSetSpecOperation
    | ChartSetPreviewOperation
    | PdfSplitSetResultOperation
    | FarmSetStateOperation
)


class WorkspaceItemCreateRequest(WorkspaceSchemaBase):
    id: str
    kind: WorkspaceCreatedItemKind
    payload: WorkspaceItemPayload
    created_by_agent_id: str | None = None

    @model_validator(mode="after")
    def _payload_matches_kind(self) -> "WorkspaceItemCreateRequest":
        if self.kind == "report.v1" and not isinstance(self.payload, WorkspaceReportPayload):
            raise ValueError("report.v1 items require a report payload")
        if self.kind == "chart.v1" and not isinstance(self.payload, ChartItemPayload):
            raise ValueError("chart.v1 items require a chart payload")
        if self.kind == "pdf_split.v1" and not isinstance(
            self.payload, PdfSplitItemPayload
        ):
            raise ValueError("pdf_split.v1 items require a pdf split payload")
        if self.kind == "farm.v1" and not isinstance(self.payload, FarmItemPayload):
            raise ValueError("farm.v1 items require a farm payload")
        return self


class WorkspaceItemOperationRequest(WorkspaceSchemaBase):
    base_revision: int = Field(ge=1)
    operation: WorkspaceItemOperation
    created_by_agent_id: str | None = None


class WorkspaceListItem(WorkspaceSchemaBase):
    id: str
    app_id: WorkspaceAppId
    name: str
    active_chat_id: str | None = None
    selected_item_id: str | None = None
    current_report_item_id: str | None = None
    item_count: int = Field(ge=0)
    created_at: str
    updated_at: str


class WorkspaceCreateRequest(WorkspaceSchemaBase):
    app_id: WorkspaceAppId
    name: str
    active_chat_id: str | None = None
    selected_item_id: str | None = None
    current_report_item_id: str | None = None


class WorkspaceUpdateRequest(WorkspaceSchemaBase):
    name: str | None = None
    active_chat_id: str | None = None
    selected_item_id: str | None = None
    current_report_item_id: str | None = None


class WorkspaceState(WorkspaceSchemaBase):
    version: Literal["v4"] = "v4"
    workspace_id: str
    workspace_name: str
    app_id: WorkspaceAppId
    active_chat_id: str | None = None
    selected_item_id: str | None = None
    current_report_item_id: str | None = None
    items: list[WorkspaceItemSummary] = Field(default_factory=list)
