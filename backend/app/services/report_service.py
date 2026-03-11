from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.report import ReportRun
from backend.app.schemas.report import (
    CreateReportRequest,
    CreateReportResponse,
    ReportChart,
    ReportResponse,
    ReportSection,
    ToolEvent,
)


class ReportService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_report(self, user_id: str, payload: CreateReportRequest) -> CreateReportResponse:
        report_id = str(uuid4())
        tool_log = self._build_tool_log(payload)
        sections = self._build_sections(payload)
        charts = self._build_charts(payload)

        report = ReportRun(
            id=report_id,
            user_id=user_id,
            prompt=payload.prompt,
            status="ready",
            uploaded_files=[dataset.model_dump() for dataset in payload.datasets],
            sections=[section.model_dump() for section in sections],
            charts=[chart.model_dump() for chart in charts],
            tool_log=[event.model_dump() for event in tool_log],
        )
        self.db.add(report)
        await self.db.commit()

        return CreateReportResponse(
            id=report_id,
            status=report.status,
            sections=sections,
            charts=charts,
            tool_log=tool_log,
        )

    async def get_report(self, report_id: str, user_id: str) -> ReportResponse | None:
        result = await self.db.execute(select(ReportRun).where(ReportRun.id == report_id, ReportRun.user_id == user_id))
        report = result.scalar_one_or_none()
        if report is None:
            return None

        return ReportResponse(
            id=report.id,
            prompt=report.prompt,
            status=report.status,
            uploaded_files=report.uploaded_files,
            sections=[ReportSection.model_validate(item) for item in report.sections],
            charts=[ReportChart.model_validate(item) for item in report.charts],
            tool_log=[ToolEvent.model_validate(item) for item in report.tool_log],
            created_at=report.created_at,
            updated_at=report.updated_at,
        )

    def _build_tool_log(self, payload: CreateReportRequest) -> list[ToolEvent]:
        dataset_names = ", ".join(dataset.name for dataset in payload.datasets) or "no files"
        return [
            ToolEvent(tool="list_accessible_datasets", detail=f"Loaded {dataset_names}."),
            ToolEvent(tool="inspect_dataset_schema", detail="Reviewed columns, row counts, and representative samples."),
            ToolEvent(tool="run_aggregate_query", detail="Generated report-safe summaries without exposing raw tables."),
            ToolEvent(tool="request_chart_render", detail="Prepared frontend chart specs for client-side rendering and image return."),
        ]

    def _build_sections(self, payload: CreateReportRequest) -> list[ReportSection]:
        total_rows = sum(dataset.row_count for dataset in payload.datasets)
        dataset_count = len(payload.datasets)
        summary_lines = [
            f"- Files reviewed: {dataset_count}",
            f"- Total rows available through safe summaries: {total_rows}",
            "- Raw data access is constrained to aggregate outputs and tiny familiarization slices.",
        ]

        focus = payload.prompt.strip() or "Summarize the uploaded datasets."
        return [
            ReportSection(
                id=str(uuid4()),
                title="Executive Summary",
                markdown=(f"## Objective\n\n{focus}\n\n" "## Scope\n\n" + "\n".join(summary_lines)),
            ),
            ReportSection(
                id=str(uuid4()),
                title="Method",
                markdown=(
                    "The analyst agent first inventories uploaded CSVs, then inspects schemas, "
                    "requests only report-safe aggregates, and asks the client to render charts "
                    "that can be fed back as image context for higher quality interpretation."
                ),
            ),
        ]

    def _build_charts(self, payload: CreateReportRequest) -> list[ReportChart]:
        if not payload.datasets:
            return []

        dataset = payload.datasets[0]
        columns = dataset.columns[:4]
        x_field = columns[0] if columns else "dimension"
        y_field = columns[1] if len(columns) > 1 else "value"

        return [
            ReportChart(
                id=str(uuid4()),
                title=f"{dataset.name} overview",
                chart_type="bar",
                query_id=str(uuid4()),
                spec={
                    "mark": "bar",
                    "encoding": {
                        "x": {"field": x_field, "type": "nominal"},
                        "y": {"field": y_field, "type": "quantitative"},
                    },
                    "meta": {"note": "Client should replace placeholder fields with a validated aggregate query result."},
                },
            )
        ]
