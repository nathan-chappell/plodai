import json
from datetime import UTC, datetime
from typing import Any, Literal, Mapping, Sequence, cast
from uuid import uuid4

from agents import FunctionTool, function_tool
from agents.tool_context import ToolContext
from chatkit.agents import AgentContext as ChatKitAgentContext, ClientToolCall
from chatkit.types import ClientEffectEvent, ProgressUpdateEvent

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.query_models import ChartPlan
from backend.app.agents.widgets import (
    build_plan_copy_text,
    build_plan_widget,
    build_tool_trace_copy_text,
    build_tool_trace_widget,
)
from backend.app.chatkit.metadata import AgentPlan
from backend.app.core.logging import get_logger, summarize_for_log


logger = get_logger("agents.tools")
ChatKitToolContext = ToolContext[ChatKitAgentContext[ReportAgentContext]]
AgentRole = Literal["csv-agent", "chart-agent", "pdf-agent", "report-agent"]


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


def get_client_tool_names(
    context: ReportAgentContext,
) -> list[str]:
    return [name for tool in context.client_tools if (name := tool.get("name"))]


def _tool_summary_from_query_plan(query_plan: Mapping[str, object]) -> list[str]:
    return [
        f"Dataset: {query_plan.get('dataset_id') or 'unknown'}",
        f"Group by: {len(cast(list[object], query_plan.get('group_by') or []))}",
        f"Aggregates: {len(cast(list[object], query_plan.get('aggregates') or []))}",
        *(
            [f"Limit: {limit}"]
            if isinstance((limit := query_plan.get("limit")), int)
            else []
        ),
    ]


def _summarize_client_tool_request(
    tool_name: str,
    arguments: Mapping[str, object],
) -> tuple[str, list[str]]:
    if tool_name in {"list_workspace_files", "list_attached_csv_files", "list_chartable_files"}:
        include_samples = arguments.get("includeSamples")
        return (
            "Queued a workspace inventory request.",
            [
                (
                    f"Include samples: {'yes' if include_samples else 'no'}"
                    if isinstance(include_samples, bool)
                    else "Using default inventory options."
                )
            ],
        )

    if tool_name == "inspect_chartable_file_schema":
        return (
            "Queued a chartable schema inspection.",
            [f"File: {arguments.get('file_id') or 'unknown'}"],
        )

    if tool_name == "inspect_pdf_file":
        details = [f"File: {arguments.get('file_id') or 'unknown'}"]
        if isinstance(arguments.get("max_pages"), int):
            details.append(f"Max pages: {arguments['max_pages']}")
        return ("Queued a PDF inspection.", details)

    if tool_name == "get_pdf_page_range":
        return (
            "Queued a PDF page extraction.",
            [
                f"File: {arguments.get('file_id') or 'unknown'}",
                f"Pages: {arguments.get('start_page') or '?'}-{arguments.get('end_page') or '?'}",
            ],
        )

    if tool_name == "smart_split_pdf":
        details = [f"File: {arguments.get('file_id') or 'unknown'}"]
        if isinstance(arguments.get("goal"), str) and arguments["goal"].strip():
            details.append(f"Goal: {arguments['goal'].strip()}")
        return ("Queued a smart PDF split.", details)

    if tool_name == "run_aggregate_query":
        query_plan = arguments.get("query_plan")
        if isinstance(query_plan, Mapping):
            return (
                "Queued a grouped aggregate query.",
                _tool_summary_from_query_plan(cast(Mapping[str, object], query_plan)),
            )

    if tool_name in {"create_csv_file", "create_json_file"}:
        details = [f"Filename: {arguments.get('filename') or 'unknown'}"]
        query_plan = arguments.get("query_plan")
        if isinstance(query_plan, Mapping):
            details.extend(_tool_summary_from_query_plan(cast(Mapping[str, object], query_plan)))
        return ("Queued a derived artifact build.", details)

    if tool_name == "render_chart_from_file":
        chart_plan = arguments.get("chart_plan")
        details = [f"File: {arguments.get('file_id') or 'unknown'}"]
        if isinstance(chart_plan, Mapping):
            details.append(f"Chart: {chart_plan.get('type') or 'unknown'}")
        if isinstance(arguments.get("x_key"), str):
            details.append(f"X key: {arguments['x_key']}")
        if isinstance(arguments.get("y_key"), str) and arguments["y_key"].strip():
            details.append(f"Y key: {arguments['y_key']}")
        return ("Queued a chart render.", details)

    argument_fields = ", ".join(sorted(arguments.keys())) if arguments else "none"
    return (
        "Queued for client-side execution.",
        [f"Argument fields: {argument_fields}"],
    )


async def _stream_tool_trace_widget(
    ctx: ChatKitToolContext,
    tool_name: str,
    summary: str,
    details: Sequence[str] | None = None,
) -> None:
    clean_details = [detail.strip() for detail in details or [] if detail.strip()]
    await ctx.context.stream_widget(
        build_tool_trace_widget(tool_name, summary, clean_details),
        copy_text=build_tool_trace_copy_text(tool_name, summary, clean_details),
    )


def _build_client_tool_proxy(tool_definition: Mapping[str, Any]) -> FunctionTool:
    tool_name = str(tool_definition.get("name", "")).strip()
    if not tool_name:
        raise ValueError("Client tool definition must include a name.")

    description = str(tool_definition.get("description", "")).strip() or (
        f"Ask the client to execute the '{tool_name}' tool locally."
    )
    params_json_schema = tool_definition.get("parameters")
    if not isinstance(params_json_schema, dict):
        raise ValueError(f"Client tool {tool_name} is missing a strict JSON schema.")
    strict_json_schema = bool(tool_definition.get("strict", True))
    if not strict_json_schema:
        raise ValueError(f"Client tool {tool_name} must use strict JSON schema mode.")

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
        trace_summary, trace_details = _summarize_client_tool_request(
            tool_name,
            arguments,
        )
        await _stream_tool_trace_widget(
            ctx,
            tool_name,
            trace_summary,
            trace_details,
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


def build_agent_tools(
    context: ReportAgentContext,
    *,
    capability_id: str,
    allow_append_report_section: bool = False,
) -> list[FunctionTool]:
    tools: list[FunctionTool] = []
    tool_names = set(get_client_tool_names(context))
    registered_tool_map = {
        name.strip(): tool_definition
        for tool_definition in context.client_tools
        if isinstance((name := tool_definition.get("name")), str) and name.strip()
    }
    built_client_tool_names: set[str] = set()

    @function_tool(name_override="name_current_thread")
    async def name_current_thread_tool(
        ctx: ChatKitToolContext,
        title: str,
    ) -> dict[str, str]:
        """Rename the current thread to a concise, descriptive title for the current investigation."""
        request_context = ctx.context.request_context
        cleaned_title = title.strip()
        _log_tool_start(request_context, "name_current_thread", title=cleaned_title)
        request_context.thread_metadata["title"] = cleaned_title
        ctx.context.thread.title = cleaned_title
        ctx.context.thread.metadata = dict(request_context.thread_metadata)
        await ctx.context.stream(
            ProgressUpdateEvent(text=f"Renaming thread to: {cleaned_title}.")
        )
        await _stream_tool_trace_widget(
            ctx,
            "name_current_thread",
            "Updated the thread title.",
            [f"Title: {cleaned_title}"],
        )
        result = {
            "thread_title": cleaned_title,
            "report_id": request_context.report_id,
        }
        _log_tool_end(request_context, "name_current_thread", title=cleaned_title)
        return result

    @function_tool(name_override="make_plan")
    async def make_plan_tool(
        ctx: ChatKitToolContext,
        focus: str,
        planned_steps: list[str],
        success_criteria: list[str] | None = None,
        follow_on_tool_hints: list[str] | None = None,
    ) -> dict[str, object]:
        """Write down a concise plan, then continue executing it immediately with more tool calls."""
        request_context = ctx.context.request_context
        cleaned_focus = focus.strip()
        cleaned_steps = [step.strip() for step in planned_steps if step.strip()]
        cleaned_success_criteria = [
            item.strip() for item in success_criteria or [] if item.strip()
        ]
        cleaned_follow_on_tool_hints = [
            item.strip() for item in follow_on_tool_hints or [] if item.strip()
        ]
        _log_tool_start(
            request_context,
            "make_plan",
            focus=cleaned_focus,
            planned_steps=len(cleaned_steps),
            success_criteria=len(cleaned_success_criteria),
            follow_on_tool_hints=len(cleaned_follow_on_tool_hints),
        )
        plan: AgentPlan = {
            "id": f"plan_{uuid4().hex}",
            "focus": cleaned_focus,
            "planned_steps": cleaned_steps,
            "created_at": datetime.now(UTC).isoformat(),
        }
        if cleaned_success_criteria:
            plan["success_criteria"] = cleaned_success_criteria
        if cleaned_follow_on_tool_hints:
            plan["follow_on_tool_hints"] = cleaned_follow_on_tool_hints
        request_context.thread_metadata["plan"] = plan
        if "render_chart_from_file" in cleaned_follow_on_tool_hints or capability_id == "chart-agent":
            request_context.thread_metadata["chart_plan"] = plan
        ctx.context.thread.metadata = dict(request_context.thread_metadata)
        await ctx.context.stream(
            ProgressUpdateEvent(
                text=(
                    f"Plan saved with {len(cleaned_steps)} step(s). Continue executing it now "
                    "with more tool calls instead of stopping."
                )
            )
        )
        await ctx.context.stream_widget(
            build_plan_widget(plan),
            copy_text=build_plan_copy_text(plan),
        )
        _log_tool_end(request_context, "make_plan", plan_id=plan["id"])
        return {
            "plan_id": plan["id"],
            "plan": plan,
            "report_id": request_context.report_id,
        }

    tools.extend([name_current_thread_tool, make_plan_tool])

    if allow_append_report_section:

        @function_tool(name_override="append_report_section")
        async def append_report_section_tool(
            ctx: ChatKitToolContext,
            title: str,
            markdown: str,
        ) -> dict[str, str]:
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
            await _stream_tool_trace_widget(
                ctx,
                "append_report_section",
                "Added narrative to the in-progress report.",
                [f"Section: {title}", f"Markdown length: {len(markdown)} chars"],
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

        tools.append(append_report_section_tool)

    if context.available_datasets:
        dataset_ids = tuple(dataset.id for dataset in context.available_datasets)
        DatasetIdLiteral = Literal[*dataset_ids]

        @function_tool(name_override="inspect_csv_file_schema")
        async def inspect_csv_file_schema_tool(
            ctx: ChatKitToolContext,
            dataset_id: DatasetIdLiteral,  # pyright: ignore[reportInvalidTypeForm]
        ) -> dict[str, object]:
            """Inspect one CSV file before writing or revising a query plan."""
            request_context = ctx.context.request_context
            _log_tool_start(
                request_context, "inspect_csv_file_schema", dataset_id=dataset_id
            )
            await ctx.context.stream(
                ProgressUpdateEvent(text=f"Inspecting schema for CSV file {dataset_id}.")
            )
            await _stream_tool_trace_widget(
                ctx,
                "inspect_csv_file_schema",
                "Inspecting one CSV schema.",
                [f"Dataset: {dataset_id}"],
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

        tools.append(inspect_csv_file_schema_tool)

    if context.available_chartable_files:
        file_ids = tuple(file.id for file in context.available_chartable_files)
        ChartableFileIdLiteral = Literal[*file_ids]

        @function_tool(name_override="inspect_chartable_file_schema")
        async def inspect_chartable_file_schema_tool(
            ctx: ChatKitToolContext,
            file_id: ChartableFileIdLiteral,  # pyright: ignore[reportInvalidTypeForm]
        ) -> dict[str, object]:
            """Inspect a CSV or JSON chartable artifact before building a chart plan."""
            request_context = ctx.context.request_context
            _log_tool_start(
                request_context, "inspect_chartable_file_schema", file_id=file_id
            )
            file = request_context.get_file(file_id)
            columns: list[str] = []
            numeric_columns: list[str] = []
            row_count = 0
            sample_rows: list[dict[str, Any]] = []
            kind = None
            if file is not None:
                kind = file.kind
                if file.kind == "csv" and file.csv is not None:
                    columns = list(file.csv.columns)
                    numeric_columns = list(file.csv.numeric_columns)
                    row_count = file.csv.row_count
                    sample_rows = list(file.csv.sample_rows[:5])
                elif file.kind == "json" and file.json is not None:
                    columns = list(file.json.columns)
                    numeric_columns = list(file.json.numeric_columns)
                    row_count = file.json.row_count
                    sample_rows = list(file.json.sample_rows[:5])
            result = {
                "file_id": file_id,
                "kind": kind,
                "columns": columns,
                "numeric_columns": numeric_columns,
                "row_count": row_count,
                "sample_rows": sample_rows,
            }
            await _stream_tool_trace_widget(
                ctx,
                "inspect_chartable_file_schema",
                "Inspecting a chartable artifact schema.",
                [f"File: {file_id}", f"Kind: {kind or 'unknown'}"],
            )
            _log_tool_end(
                request_context,
                "inspect_chartable_file_schema",
                found=bool(file),
                column_count=len(columns),
            )
            return result

        tools.append(inspect_chartable_file_schema_tool)

    query_plan_model = context.query_plan_model
    if query_plan_model is not None and "run_aggregate_query" in tool_names:

        @function_tool(name_override="run_aggregate_query")
        async def run_aggregate_query_tool(
            ctx: ChatKitToolContext,
            query_plan: query_plan_model,  # pyright: ignore[reportInvalidTypeForm]
        ) -> dict[str, object]:
            """Validate a structured row/filter/group/aggregate query plan, then ask the client to execute it."""
            request_context = ctx.context.request_context
            validated_plan = query_plan.model_dump(by_alias=True)
            _log_tool_start(
                request_context,
                "run_aggregate_query",
                dataset_id=validated_plan.get("dataset_id"),
                group_by=len(validated_plan.get("group_by") or []),
            )
            await ctx.context.stream(
                ProgressUpdateEvent(text="Validating an aggregate query plan.")
            )
            await _stream_tool_trace_widget(
                ctx,
                "run_aggregate_query",
                "Validated a grouped aggregate query plan.",
                [
                    f"Dataset: {validated_plan.get('dataset_id') or 'unknown'}",
                    f"Group by: {len(validated_plan.get('group_by') or [])}",
                    f"Aggregates: {len(validated_plan.get('aggregates') or [])}",
                ],
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
                mode="client_tool_call",
            )
            return client_tool_call.model_dump(mode="json")

        tools.append(run_aggregate_query_tool)
        built_client_tool_names.add("run_aggregate_query")

    for materialize_tool_name in ("create_csv_file", "create_json_file"):
        if query_plan_model is None or materialize_tool_name not in tool_names:
            continue

        def build_materialize_query_result_tool(tool_name: str) -> FunctionTool:
            @function_tool(name_override=tool_name)
            async def materialize_query_result_tool(
                ctx: ChatKitToolContext,
                filename: str,
                query_plan: query_plan_model,  # pyright: ignore[reportInvalidTypeForm]
            ) -> dict[str, object]:
                """Validate a query plan, then ask the client to materialize the result rows as a file."""
                request_context = ctx.context.request_context
                cleaned_filename = filename.strip()
                validated_plan = query_plan.model_dump(by_alias=True)
                _log_tool_start(
                    request_context,
                    tool_name,
                    filename=cleaned_filename,
                    dataset_id=validated_plan.get("dataset_id"),
                )
                await ctx.context.stream(
                    ProgressUpdateEvent(
                        text=f"Creating derived artifact {cleaned_filename}."
                    )
                )
                await _stream_tool_trace_widget(
                    ctx,
                    tool_name,
                    "Preparing a derived artifact from a query result.",
                    [
                        f"Filename: {cleaned_filename}",
                        f"Dataset: {validated_plan.get('dataset_id') or 'unknown'}",
                    ],
                )
                client_tool_call = ClientToolCall(
                    name=tool_name,
                    arguments={
                        "filename": cleaned_filename,
                        "query_plan": validated_plan,
                    },
                )
                ctx.context.client_tool_call = client_tool_call
                _log_tool_end(
                    request_context,
                    tool_name,
                    filename=cleaned_filename,
                    mode="client_tool_call",
                )
                return client_tool_call.model_dump(mode="json")

            return materialize_query_result_tool

        tools.append(build_materialize_query_result_tool(materialize_tool_name))
        built_client_tool_names.add(materialize_tool_name)

    if "render_chart_from_file" in tool_names:

        @function_tool(name_override="render_chart_from_file")
        async def render_chart_from_file_tool(
            ctx: ChatKitToolContext,
            file_id: str,
            chart_plan_id: str,
            chart_plan: ChartPlan,
            x_key: str,
            y_key: str | None = None,
            series_key: str | None = None,
        ) -> dict[str, object]:
            """Render a chart from a chartable CSV or JSON artifact after the chart has been planned."""
            request_context = ctx.context.request_context
            active_plan = request_context.thread_metadata.get("plan")
            if active_plan is None or active_plan.get("id") != chart_plan_id:
                raise ValueError(
                    "render_chart_from_file requires a current chart plan id from the latest make_plan call."
                )
            raw_chart_plan = chart_plan.model_dump(by_alias=True)
            _log_tool_start(
                request_context,
                "render_chart_from_file",
                file_id=file_id,
                chart_plan_id=chart_plan_id,
                chart_type=raw_chart_plan.get("type"),
            )
            await ctx.context.stream(
                ProgressUpdateEvent(text=f"Requesting chart render for file {file_id}.")
            )
            await _stream_tool_trace_widget(
                ctx,
                "render_chart_from_file",
                "Queued a chart render on the client.",
                [
                    f"File: {file_id}",
                    f"Chart: {raw_chart_plan.get('type') or 'unknown'}",
                    f"X key: {x_key}",
                    f"Y key: {y_key or 'auto'}",
                ],
            )
            client_tool_call = ClientToolCall(
                name="render_chart_from_file",
                arguments={
                    "file_id": file_id,
                    "chart_plan_id": chart_plan_id,
                    "chart_plan": raw_chart_plan,
                    "x_key": x_key,
                    "y_key": y_key,
                    "series_key": series_key,
                },
            )
            ctx.context.client_tool_call = client_tool_call
            _log_tool_end(
                request_context,
                "render_chart_from_file",
                file_id=file_id,
                mode="client_tool_call",
            )
            return client_tool_call.model_dump(mode="json")

        tools.append(render_chart_from_file_tool)
        built_client_tool_names.add("render_chart_from_file")

    for tool_name, tool_definition in registered_tool_map.items():
        if tool_name in built_client_tool_names:
            continue
        tools.append(_build_client_tool_proxy(tool_definition))

    return tools
