from agents import RunContextWrapper, function_tool
from chatkit.types import ProgressUpdateEvent

from app.agents.context import ReportAgentContext
from app.agents.query_models import ChartPlan, ToolQueryPlan


def _ctx(wrapper: RunContextWrapper[ReportAgentContext]) -> ReportAgentContext:
    return wrapper.context


async def _emit_progress(context: ReportAgentContext, text: str) -> None:
    if context.emit_event is not None:
        await context.emit_event(ProgressUpdateEvent(text=text))


@function_tool
async def list_accessible_datasets(context: RunContextWrapper[ReportAgentContext]) -> dict:
    """List the datasets currently available to analyze, including safe schema details and a small sample."""
    request_context = _ctx(context)
    await _emit_progress(request_context, "Inspecting available datasets.")
    return {
        "datasets": [
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
        "query_plan_schema": request_context.query_plan_schema,
    }


@function_tool
async def inspect_dataset_schema(
    context: RunContextWrapper[ReportAgentContext],
    dataset_id: str,
) -> dict:
    """Inspect one dataset before writing a query plan so columns and numeric fields are used correctly."""
    request_context = _ctx(context)
    await _emit_progress(request_context, f"Inspecting schema for {dataset_id}.")
    dataset = request_context.get_dataset(dataset_id)
    return {
        "dataset_id": dataset_id,
        "columns": dataset.columns if dataset else [],
        "numeric_columns": dataset.numeric_columns if dataset else [],
        "row_count": dataset.row_count if dataset else 0,
        "sample_rows": dataset.sample_rows[:5] if dataset else [],
    }


@function_tool
async def run_aggregate_query(
    context: RunContextWrapper[ReportAgentContext],
    query_plan: ToolQueryPlan,
) -> dict:
    """Validate a structured row/filter/group/aggregate query plan for client-side execution."""
    request_context = _ctx(context)
    await _emit_progress(request_context, "Validating an aggregate query plan.")
    validated_plan = request_context.validate_query_plan(query_plan.model_dump(by_alias=True))
    return {
        "status": "validated",
        "query_plan": validated_plan,
        "note": "The frontend should execute this plan against loaded CSV rows and return aggregate results only.",
    }


@function_tool
async def request_chart_render(
    context: RunContextWrapper[ReportAgentContext],
    query_id: str,
    chart_plan: ChartPlan,
) -> dict:
    """Ask the client to render a chart from a validated query result and optionally send back an image."""
    request_context = _ctx(context)
    await _emit_progress(request_context, f"Requesting chart render for {query_id}.")
    return {
        "query_id": query_id,
        "chart_plan": chart_plan.model_dump(by_alias=True),
        "report_id": request_context.report_id,
        "note": "Frontend should render the chart locally from structured results and may return an image for model inspection.",
    }


@function_tool
async def append_report_section(
    context: RunContextWrapper[ReportAgentContext],
    title: str,
    markdown: str,
) -> dict:
    """Append a markdown narrative section to the in-progress report."""
    request_context = _ctx(context)
    await _emit_progress(request_context, f"Appending report section: {title}.")
    return {
        "title": title,
        "markdown": markdown,
        "report_id": request_context.report_id,
        "note": "Persist this narrative section as a report artifact when the report assembly flow is finalized.",
    }


@function_tool
async def name_current_thread(
    context: RunContextWrapper[ReportAgentContext],
    title: str,
) -> dict:
    """Rename the current thread to a concise, descriptive title for the investigation."""
    request_context = _ctx(context)
    cleaned_title = title.strip()
    request_context.requested_thread_title = cleaned_title
    request_context.thread_metadata["title"] = cleaned_title
    await _emit_progress(request_context, f"Renaming thread to: {cleaned_title}.")
    return {
        "title": cleaned_title,
        "report_id": request_context.report_id,
        "note": "Use short, specific titles that reflect the investigation focus.",
    }
