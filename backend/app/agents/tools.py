from agents import RunContextWrapper, function_tool
from chatkit.types import ProgressUpdateEvent

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.query_models import ChartPlan, ToolQueryPlan
from backend.app.core.logging import get_logger, summarize_for_log


logger = get_logger("agents.tools")


def _ctx(wrapper: RunContextWrapper[ReportAgentContext]) -> ReportAgentContext:
    return wrapper.context


def _log_tool_start(
    context: ReportAgentContext,
    tool_name: str,
    **details: object,
) -> None:
    detail_text = " ".join(
        f"{key}={summarize_for_log(value)}" for key, value in details.items()
    )
    logger.info(
        "tool.start name=%s report_id=%s user_email=%s %s",
        tool_name,
        context.report_id,
        context.user_email,
        detail_text,
    )


def _log_tool_end(
    context: ReportAgentContext,
    tool_name: str,
    **details: object,
) -> None:
    detail_text = " ".join(
        f"{key}={summarize_for_log(value)}" for key, value in details.items()
    )
    logger.info(
        "tool.end name=%s report_id=%s user_email=%s %s",
        tool_name,
        context.report_id,
        context.user_email,
        detail_text,
    )


async def _emit_progress(context: ReportAgentContext, text: str) -> None:
    if context.emit_event is not None:
        await context.emit_event(ProgressUpdateEvent(text=text))


@function_tool
async def list_attached_csv_files(context: RunContextWrapper[ReportAgentContext]) -> dict:
    """List the CSV files currently available to analyze, including safe schema details and a small sample."""
    request_context = _ctx(context)
    _log_tool_start(
        request_context,
        "list_attached_csv_files",
        csv_file_count=len(request_context.available_datasets),
    )
    await _emit_progress(request_context, "Inspecting available CSV files.")
    result = {
        "csv_files": [
            {
                "id": dataset.id,
                "name": dataset.name,
                "columns": dataset.columns,
                "numeric_columns": dataset.numeric_columns,
                "row_count": dataset.row_count,
                "sample_rows": dataset.sample_rows[:5],
            }
            for dataset in request_context.available_datasets
        ],
    }
    _log_tool_end(
        request_context,
        "list_attached_csv_files",
        returned_csv_file_ids=[dataset["id"] for dataset in result["csv_files"]],
    )
    return result


@function_tool
async def inspect_csv_file_schema(
    context: RunContextWrapper[ReportAgentContext],
    dataset_id: str,
) -> dict:
    """Inspect one CSV file before writing a query plan so columns and numeric fields are used correctly."""
    request_context = _ctx(context)
    _log_tool_start(request_context, "inspect_csv_file_schema", dataset_id=dataset_id)
    await _emit_progress(request_context, f"Inspecting schema for CSV file {dataset_id}.")
    dataset = request_context.get_dataset(dataset_id)
    result = {
        "dataset_id": dataset_id,
        "columns": dataset.columns if dataset else [],
        "numeric_columns": dataset.numeric_columns if dataset else [],
        "row_count": dataset.row_count if dataset else 0,
        "sample_rows": dataset.sample_rows[:5] if dataset else [],
    }
    _log_tool_end(
        request_context,
        "inspect_csv_file_schema",
        found=bool(dataset),
        column_count=len(result["columns"]),
        numeric_count=len(result["numeric_columns"]),
    )
    return result


@function_tool
async def run_aggregate_query(
    context: RunContextWrapper[ReportAgentContext],
    query_plan: ToolQueryPlan,
) -> dict:
    """Validate a structured row/filter/group/aggregate query plan for client-side execution against a CSV file."""
    request_context = _ctx(context)
    raw_query_plan = query_plan.model_dump(by_alias=True)
    _log_tool_start(
        request_context,
        "run_aggregate_query",
        dataset_id=raw_query_plan.get("dataset_id"),
        group_by=len(raw_query_plan.get("group_by") or []),
        aggregates=[measure.get("op") for measure in raw_query_plan.get("aggregates") or []],
    )
    await _emit_progress(request_context, "Validating an aggregate query plan.")
    validated_plan = request_context.validate_query_plan(raw_query_plan)
    result = {
        "status": "validated",
        "query_plan": validated_plan,
        "note": "The frontend should execute this plan against loaded CSV rows and return aggregate results only.",
    }
    _log_tool_end(
        request_context,
        "run_aggregate_query",
        dataset_id=validated_plan.get("dataset_id"),
        aggregate_count=len(validated_plan.get("aggregates") or []),
        sort_fields=[sort_spec.get("field") for sort_spec in validated_plan.get("sort") or []],
    )
    return result


@function_tool
async def request_chart_render(
    context: RunContextWrapper[ReportAgentContext],
    query_id: str,
    chart_plan: ChartPlan,
) -> dict:
    """Ask the client to render a chart from a validated CSV query result and optionally send back an image."""
    request_context = _ctx(context)
    raw_chart_plan = chart_plan.model_dump(by_alias=True)
    _log_tool_start(
        request_context,
        "request_chart_render",
        query_id=query_id,
        chart_type=raw_chart_plan.get("type"),
        title=raw_chart_plan.get("title"),
    )
    await _emit_progress(request_context, f"Requesting chart render for query {query_id}.")
    result = {
        "query_id": query_id,
        "chart_plan": raw_chart_plan,
        "report_id": request_context.report_id,
        "note": "Frontend should render the chart locally from structured results and may return an image for model inspection.",
    }
    _log_tool_end(
        request_context,
        "request_chart_render",
        query_id=query_id,
        series_count=len(raw_chart_plan.get("series") or []),
    )
    return result


@function_tool
async def append_report_section(
    context: RunContextWrapper[ReportAgentContext],
    title: str,
    markdown: str,
) -> dict:
    """Append a markdown narrative section to the in-progress report."""
    request_context = _ctx(context)
    _log_tool_start(
        request_context,
        "append_report_section",
        title=title,
        markdown_chars=len(markdown),
    )
    await _emit_progress(request_context, f"Appending report section: {title}.")
    result = {
        "title": title,
        "markdown": markdown,
        "report_id": request_context.report_id,
        "note": "Persist this narrative section as a report artifact when the report assembly flow is finalized.",
    }
    _log_tool_end(
        request_context,
        "append_report_section",
        title=title,
        markdown_chars=len(markdown),
    )
    return result


@function_tool
async def name_current_thread(
    context: RunContextWrapper[ReportAgentContext],
    title: str,
) -> dict:
    """Rename the current thread to a concise, descriptive title for the investigation."""
    request_context = _ctx(context)
    cleaned_title = title.strip()
    _log_tool_start(request_context, "name_current_thread", title=cleaned_title)
    request_context.requested_thread_title = cleaned_title
    request_context.thread_metadata["title"] = cleaned_title
    await _emit_progress(request_context, f"Renaming thread to: {cleaned_title}.")
    result = {
        "title": cleaned_title,
        "report_id": request_context.report_id,
        "note": "Use short, specific titles that reflect the investigation focus.",
    }
    _log_tool_end(request_context, "name_current_thread", title=cleaned_title)
    return result


