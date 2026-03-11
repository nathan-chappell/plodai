from datetime import datetime

from pydantic import BaseModel, Field


class DatasetSummary(BaseModel):
    id: str
    name: str
    row_count: int
    columns: list[str]
    sample_rows: list[dict] = Field(default_factory=list)


class ToolEvent(BaseModel):
    tool: str
    detail: str


class ReportSection(BaseModel):
    id: str
    title: str
    markdown: str


class ReportChart(BaseModel):
    id: str
    title: str
    chart_type: str
    spec: dict
    image_data_url: str | None = None
    query_id: str | None = None


class CreateReportRequest(BaseModel):
    prompt: str
    datasets: list[DatasetSummary]


class CreateReportResponse(BaseModel):
    id: str
    status: str
    sections: list[ReportSection]
    charts: list[ReportChart]
    tool_log: list[ToolEvent]


class ReportResponse(CreateReportResponse):
    prompt: str
    uploaded_files: list[dict]
    created_at: datetime
    updated_at: datetime
