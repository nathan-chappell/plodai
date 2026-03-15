import json
from typing import Any, Literal, Mapping

from agents import FunctionTool, function_tool
from agents.tool_context import ToolContext
from chatkit.agents import AgentContext as ChatKitAgentContext, ClientToolCall
from chatkit.types import ClientEffectEvent, ProgressUpdateEvent

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.query_models import ChartPlan
from backend.app.chatkit.metadata import AnalysisPlan
from backend.app.core.logging import get_logger, summarize_for_log


logger = get_logger("agents.tools")
ChatKitToolContext = ToolContext[ChatKitAgentContext[ReportAgentContext]]


def _log_tool_start(
    context: ReportAgentContext,
    tool_name: str,
    **details: object,
) -> None:
    detail_text = " ".join(
        f"{key}={summarize_for_log(value)}" for key, value in details.items()
    )
    logger.info(
        f"tool.start name={tool_name} report_id={context.report_id} user_id={context.user_id} {detail_text}"
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
        f"tool.end name={tool_name} report_id={context.report_id} user_id={context.user_id} {detail_text}"
    )


def get_client_tool_names(context: ReportAgentContext) -> list[str]:
    registered_tool_names = [
        name for tool in context.client_tools if (name := tool.get("name"))
    ]
    if registered_tool_names:
        return registered_tool_names
    return [
        "list_attached_csv_files",
        "run_aggregate_query",
        "request_chart_render",
    ]


def _build_client_tool_proxy(tool_definition: Mapping[str, Any]) -> FunctionTool:
    tool_name = str(tool_definition.get("name", "")).strip()
    if not tool_name:
        raise ValueError("Client tool definition must include a name.")

    description = str(tool_definition.get("description", "")).strip() or (
        f"Ask the client to execute the '{tool_name}' tool locally."
    )
    params_json_schema = tool_definition.get("parameters")
    if not isinstance(params_json_schema, dict):
        params_json_schema = {
            "type": "object",
            "properties": {},
            "additionalProperties": True,
        }
    strict_json_schema = bool(tool_definition.get("strict", True))

    async def on_invoke_tool(ctx: ChatKitToolContext, input_json: str) -> Any:
        request_context = ctx.context.request_context
        try:
            arguments = json.loads(input_json) if input_json else {}
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid client tool arguments for {tool_name}.") from exc
        if not isinstance(arguments, dict):
            raise ValueError(
                f"Client tool {tool_name} expects object arguments, got {type(arguments).__name__}."
            )
        _log_tool_start(request_context, tool_name, mode="client_proxy")
        await ctx.context.stream(
            ProgressUpdateEvent(text=f"Requesting client tool {tool_name}.")
        )
        client_tool_call = ClientToolCall(name=tool_name, arguments=arguments)
        ctx.context.client_tool_call = client_tool_call
        _log_tool_end(request_context, tool_name, mode="client_tool_call")
        return client_tool_call.model_dump(mode="json")

    return FunctionTool(
        name=tool_name,
        description=description,
        params_json_schema=params_json_schema,
        on_invoke_tool=on_invoke_tool,
        strict_json_schema=strict_json_schema,
    )


def build_report_tools(context: ReportAgentContext) -> list[FunctionTool]:
    tools: list[FunctionTool] = []

    @function_tool(name_override="name_current_thread")
    async def name_current_thread_tool(
        ctx: ChatKitToolContext,
        title: str,
    ) -> dict:
        """Rename the current thread to a concise, descriptive title for the investigation."""
        request_context = ctx.context.request_context
        cleaned_title = title.strip()
        _log_tool_start(request_context, "name_current_thread", title=cleaned_title)
        request_context.thread_metadata["title"] = cleaned_title
        ctx.context.thread.title = cleaned_title
        ctx.context.thread.metadata = dict(request_context.thread_metadata)
        await ctx.context.stream(
            ProgressUpdateEvent(text=f"Renaming thread to: {cleaned_title}.")
        )
        result = {
            "thread_title": cleaned_title,
            "report_id": request_context.report_id,
        }
        _log_tool_end(request_context, "name_current_thread", title=cleaned_title)
        return result

    @function_tool(name_override="plan_analysis")
    async def plan_analysis_tool(
        ctx: ChatKitToolContext,
        focus: str,
        planned_steps: list[str],
        chart_opportunities: list[str] | None = None,
        success_criteria: list[str] | None = None,
    ) -> dict:
        """Write down a concise analysis plan, then continue the investigation by executing the planned tool calls."""
        request_context = ctx.context.request_context
        cleaned_focus = focus.strip()
        cleaned_steps = [step.strip() for step in planned_steps if step.strip()]
        cleaned_chart_opportunities = [
            item.strip() for item in chart_opportunities or [] if item.strip()
        ]
        cleaned_success_criteria = [
            item.strip() for item in success_criteria or [] if item.strip()
        ]
        _log_tool_start(
            request_context,
            "plan_analysis",
            focus=cleaned_focus,
            planned_steps=len(cleaned_steps),
            chart_opportunities=len(cleaned_chart_opportunities),
            success_criteria=len(cleaned_success_criteria),
        )
        plan: AnalysisPlan = {
            "focus": cleaned_focus,
            "planned_steps": cleaned_steps,
        }
        if cleaned_chart_opportunities:
            plan["chart_opportunities"] = cleaned_chart_opportunities
        if cleaned_success_criteria:
            plan["success_criteria"] = cleaned_success_criteria
        # Reserved for future UI display and to keep lighter models oriented mid-investigation.
        request_context.thread_metadata["analysis_plan"] = plan
        ctx.context.thread.metadata = dict(request_context.thread_metadata)
        await ctx.context.stream(
            ProgressUpdateEvent(
                text=f"Analysis plan saved with {len(cleaned_steps)} planned steps. Continue executing it now."
            )
        )
        result = {
            "analysis_plan": plan,
            "report_id": request_context.report_id,
        }
        _log_tool_end(
            request_context,
            "plan_analysis",
            planned_steps=len(cleaned_steps),
        )
        return result

    @function_tool(name_override="append_report_section")
    async def append_report_section_tool(
        ctx: ChatKitToolContext,
        title: str,
        markdown: str,
    ) -> dict:
        """Append a markdown narrative section to the in-progress report."""
        request_context = ctx.context.request_context
        _log_tool_start(
            request_context,
            "append_report_section",
            title=title,
            markdown_chars=len(markdown),
        )
        await ctx.context.stream(
            ProgressUpdateEvent(text=f"Appending report section: {title}."),
        )
        await ctx.context.stream(
            ClientEffectEvent(
                name="report_section_appended",
                data={
                    "type": "report_section_appended",
                    "title": title,
                    "markdown": markdown,
                },
            )
        )
        result = {
            "title": title,
            "markdown": markdown,
            "report_id": request_context.report_id,
        }
        _log_tool_end(
            request_context,
            "append_report_section",
            title=title,
            markdown_chars=len(markdown),
        )
        return result

    tools.extend(
        [
            name_current_thread_tool,
            plan_analysis_tool,
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
        ctx: ChatKitToolContext,
        dataset_id: DatasetIdLiteral,  # pyright: ignore[reportInvalidTypeForm]
    ) -> dict:
        """Inspect one CSV file before writing a query plan so columns and numeric fields are used correctly."""
        request_context = ctx.context.request_context
        _log_tool_start(
            request_context, "inspect_csv_file_schema", dataset_id=dataset_id
        )
        await ctx.context.stream(
            ProgressUpdateEvent(text=f"Inspecting schema for CSV file {dataset_id}.")
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

    if context.client_tools:
        tools.extend(
            _build_client_tool_proxy(tool_definition)
            for tool_definition in context.client_tools
        )
        return tools

    @function_tool(name_override="list_attached_csv_files")
    async def list_attached_csv_files_tool(
        ctx: ChatKitToolContext,
    ) -> dict:
        """List the CSV files currently available to analyze by asking the client for its local file inventory."""
        request_context = ctx.context.request_context
        _log_tool_start(
            request_context,
            "list_attached_csv_files",
            known_csv_file_count=len(request_context.available_datasets),
        )
        await ctx.context.stream(
            ProgressUpdateEvent(
                text="Requesting the current CSV file inventory from the client."
            )
        )
        client_tool_call = ClientToolCall(
            name="list_attached_csv_files",
            arguments={"includeSamples": True},
        )
        ctx.context.client_tool_call = client_tool_call
        _log_tool_end(
            request_context,
            "list_attached_csv_files",
            mode="client_tool_call",
        )
        return client_tool_call.model_dump(mode="json")

    @function_tool(name_override="run_aggregate_query")
    async def run_aggregate_query_tool(
        ctx: ChatKitToolContext,
        query_plan: query_plan_model,  # pyright: ignore[reportInvalidTypeForm]
    ) -> dict:
        """Validate a structured row/filter/group/aggregate query plan, then ask the client to execute it against local CSV rows."""
        request_context = ctx.context.request_context
        validated_plan = query_plan.model_dump(by_alias=True)
        _log_tool_start(
            request_context,
            "run_aggregate_query",
            dataset_id=validated_plan.get("dataset_id"),
            group_by=len(validated_plan.get("group_by") or []),
            aggregates=[
                measure.get("op") for measure in validated_plan.get("aggregates") or []
            ],
        )
        await ctx.context.stream(
            ProgressUpdateEvent(text="Validating an aggregate query plan.")
        )
        client_tool_call = ClientToolCall(
            name="run_aggregate_query",
            arguments={"query_plan": validated_plan},
        )
        ctx.context.client_tool_call = client_tool_call
        _log_tool_end(
            request_context,
            "run_aggregate_query",
            dataset_id=validated_plan.get("dataset_id"),
            aggregate_count=len(validated_plan.get("aggregates") or []),
            mode="client_tool_call",
        )
        return client_tool_call.model_dump(mode="json")

    @function_tool(name_override="request_chart_render")
    async def request_chart_render_tool(
        ctx: ChatKitToolContext,
        query_id: str,
        query_plan: query_plan_model,  # pyright: ignore[reportInvalidTypeForm]
        chart_plan: ChartPlan,
    ) -> dict:
        """Validate the query plan, then ask the client to render a chart locally and optionally send back an image."""
        request_context = ctx.context.request_context
        validated_plan = query_plan.model_dump(by_alias=True)
        raw_chart_plan = chart_plan.model_dump(by_alias=True)
        _log_tool_start(
            request_context,
            "request_chart_render",
            query_id=query_id,
            dataset_id=validated_plan.get("dataset_id"),
            chart_type=raw_chart_plan.get("type"),
            title=raw_chart_plan.get("title"),
        )
        await ctx.context.stream(
            ProgressUpdateEvent(text=f"Requesting chart render for query {query_id}.")
        )
        client_tool_call = ClientToolCall(
            name="request_chart_render",
            arguments={
                "query_id": query_id,
                "query_plan": validated_plan,
                "chart_plan": raw_chart_plan,
            },
        )
        ctx.context.client_tool_call = client_tool_call
        _log_tool_end(
            request_context,
            "request_chart_render",
            query_id=query_id,
            series_count=len(raw_chart_plan.get("series") or []),
            mode="client_tool_call",
        )
        return client_tool_call.model_dump(mode="json")

    tools.extend(
        [
            list_attached_csv_files_tool,
            inspect_csv_file_schema_tool,
            run_aggregate_query_tool,
            request_chart_render_tool,
        ]
    )
    return tools
