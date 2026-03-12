from typing import Literal

from agents import FunctionTool, RunContextWrapper, function_tool
from chatkit.agents import ClientToolCall
from chatkit.types import ProgressUpdateEvent

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.query_models import ChartPlan
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


async def _list_attached_csv_files_impl(
    request_context: ReportAgentContext,
) -> ClientToolCall:
    _log_tool_start(
        request_context,
        "list_attached_csv_files",
        known_csv_file_count=len(request_context.available_datasets),
    )
    await _emit_progress(request_context, "Requesting the current CSV file inventory from the client.")
    result = ClientToolCall(
        name="list_attached_csv_files",
        arguments={"includeSamples": True},
    )
    _log_tool_end(
        request_context,
        "list_attached_csv_files",
        mode="client_tool_call",
    )
    return result


async def _inspect_csv_file_schema_impl(
    request_context: ReportAgentContext,
    dataset_id: str,
) -> dict:
    _log_tool_start(request_context, "inspect_csv_file_schema", dataset_id=dataset_id)
    await _emit_progress(
        request_context, f"Inspecting schema for CSV file {dataset_id}."
    )
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


async def _run_aggregate_query_impl(
    request_context: ReportAgentContext,
    query_plan,
) -> ClientToolCall:
    raw_query_plan = query_plan.model_dump(by_alias=True)
    _log_tool_start(
        request_context,
        "run_aggregate_query",
        dataset_id=raw_query_plan.get("dataset_id"),
        group_by=len(raw_query_plan.get("group_by") or []),
        aggregates=[
            measure.get("op") for measure in raw_query_plan.get("aggregates") or []
        ],
    )
    await _emit_progress(request_context, "Validating an aggregate query plan.")
    validated_plan = request_context.validate_query_plan(raw_query_plan)
    result = ClientToolCall(
        name="run_aggregate_query",
        arguments={"query_plan": validated_plan},
    )
    _log_tool_end(
        request_context,
        "run_aggregate_query",
        dataset_id=validated_plan.get("dataset_id"),
        aggregate_count=len(validated_plan.get("aggregates") or []),
        mode="client_tool_call",
    )
    return result


async def _request_chart_render_impl(
    request_context: ReportAgentContext,
    query_id: str,
    query_plan,
    chart_plan: ChartPlan,
) -> ClientToolCall:
    raw_query_plan = query_plan.model_dump(by_alias=True)
    validated_plan = request_context.validate_query_plan(raw_query_plan)
    raw_chart_plan = chart_plan.model_dump(by_alias=True)
    _log_tool_start(
        request_context,
        "request_chart_render",
        query_id=query_id,
        dataset_id=validated_plan.get("dataset_id"),
        chart_type=raw_chart_plan.get("type"),
        title=raw_chart_plan.get("title"),
    )
    await _emit_progress(
        request_context, f"Requesting chart render for query {query_id}."
    )
    result = ClientToolCall(
        name="request_chart_render",
        arguments={
            "query_id": query_id,
            "query_plan": validated_plan,
            "chart_plan": raw_chart_plan,
        },
    )
    _log_tool_end(
        request_context,
        "request_chart_render",
        query_id=query_id,
        series_count=len(raw_chart_plan.get("series") or []),
        mode="client_tool_call",
    )
    return result


async def _append_report_section_impl(
    request_context: ReportAgentContext,
    title: str,
    markdown: str,
) -> dict:
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


async def _name_current_thread_impl(
    request_context: ReportAgentContext,
    title: str,
) -> dict:
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


def build_report_tools(context: ReportAgentContext) -> list[FunctionTool]:
    tools: list[FunctionTool] = []

    @function_tool(name_override="name_current_thread")
    async def name_current_thread_tool(
        wrapper: RunContextWrapper[ReportAgentContext],
        title: str,
    ) -> dict:
        """Rename the current thread to a concise, descriptive title for the investigation."""
        return await _name_current_thread_impl(_ctx(wrapper), title)

    @function_tool(name_override="list_attached_csv_files")
    async def list_attached_csv_files_tool(
        wrapper: RunContextWrapper[ReportAgentContext],
    ) -> ClientToolCall:
        """List the CSV files currently available to analyze by asking the client for its local file inventory."""
        return await _list_attached_csv_files_impl(_ctx(wrapper))

    @function_tool(name_override="append_report_section")
    async def append_report_section_tool(
        wrapper: RunContextWrapper[ReportAgentContext],
        title: str,
        markdown: str,
    ) -> dict:
        """Append a markdown narrative section to the in-progress report."""
        return await _append_report_section_impl(_ctx(wrapper), title, markdown)

    tools.extend(
        [
            name_current_thread_tool,
            list_attached_csv_files_tool,
            append_report_section_tool,
        ]
    )

    if not context.available_datasets:
        return tools

    query_plan_model = context.query_plan_model
    if query_plan_model is None:
        raise RuntimeError("Query plan model must be built before constructing tools.")

    dataset_ids = tuple(dataset.id for dataset in context.available_datasets)
    DatasetIdLiteral = Literal[*dataset_ids]

    @function_tool(name_override="inspect_csv_file_schema")
    async def inspect_csv_file_schema_tool(
        wrapper: RunContextWrapper[ReportAgentContext],
        dataset_id: DatasetIdLiteral,  # pyright: ignore[reportInvalidTypeForm]
    ) -> dict:
        """Inspect one CSV file before writing a query plan so columns and numeric fields are used correctly."""
        return await _inspect_csv_file_schema_impl(_ctx(wrapper), dataset_id)

    @function_tool(name_override="run_aggregate_query")
    async def run_aggregate_query_tool(
        wrapper: RunContextWrapper[ReportAgentContext],
        query_plan: query_plan_model,  # pyright: ignore[reportInvalidTypeForm]
    ) -> ClientToolCall:
        """Validate a structured row/filter/group/aggregate query plan, then ask the client to execute it against local CSV rows."""
        return await _run_aggregate_query_impl(_ctx(wrapper), query_plan)

    @function_tool(name_override="request_chart_render")
    async def request_chart_render_tool(
        wrapper: RunContextWrapper[ReportAgentContext],
        query_id: str,
        query_plan: query_plan_model,  # pyright: ignore[reportInvalidTypeForm]
        chart_plan: ChartPlan,
    ) -> ClientToolCall:
        """Validate the query plan, then ask the client to render a chart locally and optionally send back an image."""
        return await _request_chart_render_impl(
            _ctx(wrapper), query_id, query_plan, chart_plan
        )

    tools.extend(
        [
            inspect_csv_file_schema_tool,
            run_aggregate_query_tool,
            request_chart_render_tool,
        ]
    )
    return tools
