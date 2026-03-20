import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Mapping, Sequence, cast
from uuid import uuid4

from agents import FunctionTool, function_tool
from agents.tool_context import ToolContext
from chatkit.agents import AgentContext as ChatKitAgentContext, ClientToolCall
from chatkit.types import ProgressUpdateEvent

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.widgets import (
    build_feedback_capture_copy_text,
    build_feedback_capture_widget,
    build_plan_copy_text,
    build_plan_widget,
    build_tool_trace_copy_text,
    build_tool_trace_widget,
)
from backend.app.chatkit.feedback_types import ChatItemFeedbackRecord, FeedbackOrigin
from backend.app.chatkit.metadata import AgentPlan
from backend.app.chatkit.usage import empty_usage_totals
from backend.app.core.logging import (
    get_logger,
    log_event,
    summarize_mapping_keys_for_log,
    summarize_pairs_for_log,
    summarize_for_log,
    summarize_sequence_for_log,
)
from backend.app.models.chatkit import ChatItemFeedback


logger = get_logger("agents.tools")
ChatKitToolContext = ToolContext[ChatKitAgentContext[ReportAgentContext]]
DEMO_VALIDATOR_CAPABILITY_ID = "demo-validator-agent"
DEMO_VALIDATOR_COST_SNAPSHOT_METADATA_KEY = "demo_validator_cost_snapshot"
DEMO_VALIDATOR_COST_SNAPSHOT_PROGRESS_PREFIX = "DEMO_VALIDATOR_COST_SNAPSHOT "


@dataclass(frozen=True, kw_only=True)
class ToolSchemaLogSummary:
    signature: str
    schema_line: str
    enum_line: str | None
    schema_chars: int


def _ordered_schema_properties(
    params_json_schema: Mapping[str, Any],
) -> tuple[list[str], Mapping[str, Any], set[str]]:
    properties = params_json_schema.get("properties")
    if not isinstance(properties, Mapping):
        return ([], {}, set())
    property_names = [
        name.strip()
        for name in properties.keys()
        if isinstance(name, str) and name.strip()
    ]
    required_value = params_json_schema.get("required")
    required_entries = (
        required_value
        if isinstance(required_value, Sequence) and not isinstance(required_value, str)
        else ()
    )
    required_names = {
        name
        for name in required_entries
        if isinstance(name, str) and name in property_names
    }
    return (property_names, properties, required_names)


def _require_closed_tool_parameters_schema(
    tool_name: str,
    params_json_schema: Mapping[str, Any],
) -> tuple[list[str], Mapping[str, Any], set[str]]:
    schema_type = params_json_schema.get("type")
    if schema_type != "object":
        raise ValueError(
            f"Client tool {tool_name} must use an object parameter schema, got {schema_type!r}."
        )
    if not isinstance(params_json_schema.get("properties"), Mapping):
        raise ValueError(f"Client tool {tool_name} is missing parameter properties.")
    property_names, properties, required_names = _ordered_schema_properties(
        params_json_schema
    )
    if params_json_schema.get("additionalProperties") is not False:
        raise ValueError(
            f"Client tool {tool_name} must set parameters.additionalProperties to false."
        )
    return (property_names, properties, required_names)


def _format_schema_literal(value: object) -> str:
    try:
        return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
    except TypeError:
        return summarize_for_log(value, limit=32)


def _format_enum_hint(property_name: str, property_schema: object) -> str | None:
    if not isinstance(property_schema, Mapping):
        return None
    enum_values = property_schema.get("enum")
    if not isinstance(enum_values, Sequence) or isinstance(enum_values, str):
        return None
    values = list(enum_values)
    if not values:
        return None
    preview = [_format_schema_literal(value) for value in values[:3]]
    if len(values) == 1:
        return f"{property_name}={preview[0]}"
    joined_preview = "|".join(preview)
    if len(values) > 3:
        joined_preview += "|..."
    return f"{property_name}={{" + joined_preview + "}}"


def describe_tool_signature(
    tool_name: str,
    params_json_schema: Mapping[str, Any] | None,
) -> str:
    if not isinstance(params_json_schema, Mapping):
        return f"{tool_name}(...)"
    property_names, _, required_names = _ordered_schema_properties(params_json_schema)
    if not property_names:
        return f"{tool_name}()"
    signature_parameters = [
        name if name in required_names else f"{name}?" for name in property_names
    ]
    return f"{tool_name}({', '.join(signature_parameters)})"


def summarize_client_tool_schema_for_log(
    tool_name: str,
    params_json_schema: Mapping[str, Any],
    *,
    strict_json_schema: bool,
) -> ToolSchemaLogSummary:
    property_names, properties, required_names = _require_closed_tool_parameters_schema(
        tool_name,
        params_json_schema,
    )
    required_parameters = [name for name in property_names if name in required_names]
    optional_parameters = [
        f"{name}?" for name in property_names if name not in required_names
    ]
    schema_parts = [
        "schema=closed",
        f"strict={'true' if strict_json_schema else 'false'}",
    ]
    if required_parameters:
        schema_parts.append(f"required={','.join(required_parameters)}")
    if optional_parameters:
        schema_parts.append(f"optional={','.join(optional_parameters)}")
    if not property_names:
        schema_parts.append("params=none")
    enum_hints = [
        enum_hint
        for property_name in property_names
        if (
            enum_hint := _format_enum_hint(property_name, properties.get(property_name))
        )
        is not None
    ]
    schema_json = json.dumps(
        params_json_schema,
        sort_keys=True,
        separators=(",", ":"),
    )
    return ToolSchemaLogSummary(
        signature=describe_tool_signature(tool_name, params_json_schema),
        schema_line=" ".join(schema_parts),
        enum_line=f"enums={'; '.join(enum_hints)}" if enum_hints else None,
        schema_chars=len(schema_json),
    )


def _log_client_tool_schema(
    tool_name: str,
    params_json_schema: Mapping[str, Any],
    *,
    strict_json_schema: bool,
) -> None:
    summary = summarize_client_tool_schema_for_log(
        tool_name,
        params_json_schema,
        strict_json_schema=strict_json_schema,
    )
    rendered_lines = [
        summary.signature,
        summary.schema_line,
        *([summary.enum_line] if summary.enum_line else []),
    ]
    log_event(
        logger,
        logging.DEBUG,
        "tool.schema_compiled",
        rendered=rendered_lines,
        dedupe=True,
        size=f"{summary.schema_chars} chars",
    )
    if summary.schema_chars > 4500:
        log_event(
            logger,
            logging.WARNING,
            "tool.schema_near_limit",
            rendered=rendered_lines,
            dedupe=True,
            size=f"{summary.schema_chars} chars",
        )


def _log_tool_start(
    context: ReportAgentContext,
    tool_name: str,
    **details: object,
) -> None:
    rendered_lines = [
        f"{tool_name} [{summarize_pairs_for_log((('user', context.user_id), ('report', context.report_id))) or 'context=unknown'}]",
        *[
            line
            for key, value in details.items()
            if (line := summarize_pairs_for_log(((key, value),))) is not None
        ],
    ]
    log_event(
        logger,
        logging.INFO,
        "tool.start",
        rendered=rendered_lines,
    )


def _log_tool_end(
    context: ReportAgentContext,
    tool_name: str,
    **details: object,
) -> None:
    rendered_lines = [
        f"{tool_name} [{summarize_pairs_for_log((('user', context.user_id), ('report', context.report_id))) or 'context=unknown'}]",
        *[
            line
            for key, value in details.items()
            if (line := summarize_pairs_for_log(((key, value),))) is not None
        ],
    ]
    log_event(
        logger,
        logging.INFO,
        "tool.end",
        rendered=rendered_lines,
    )


def get_client_tool_names(
    client_tools: Sequence[Mapping[str, Any]],
) -> list[str]:
    return [
        name.strip()
        for tool in client_tools
        if isinstance((name := tool.get("name")), str) and name.strip()
    ]


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
    if tool_name in {"list_csv_files", "list_chartable_files", "list_pdf_files"}:
        details: list[str] = []
        prefix = arguments.get("prefix")
        if isinstance(prefix, str) and prefix.strip():
            details.append(f"Prefix: {prefix.strip()}")
        include_samples = arguments.get("includeSamples")
        label = (
            "CSV workspace listing"
            if tool_name == "list_csv_files"
            else "PDF workspace listing"
            if tool_name == "list_pdf_files"
            else "chartable workspace listing"
        )
        if include_samples is True:
            return (f"Queued a {label} with samples.", details)
        return (f"Queued a {label}.", details)

    if tool_name == "list_reports":
        return ("Queued a report listing request.", [])

    if tool_name == "get_report":
        return (
            "Queued a report read.",
            [f"Report: {arguments.get('report_id') or 'unknown'}"],
        )

    if tool_name == "create_report":
        details = []
        if isinstance(arguments.get("title"), str) and arguments["title"].strip():
            details.append(f"Title: {arguments['title'].strip()}")
        if (
            isinstance(arguments.get("report_id"), str)
            and arguments["report_id"].strip()
        ):
            details.append(f"Requested id: {arguments['report_id'].strip()}")
        return ("Queued a report creation.", details)

    if tool_name == "append_report_slide":
        details = [f"Report: {arguments.get('report_id') or 'unknown'}"]
        raw_slide = arguments.get("slide")
        if isinstance(raw_slide, Mapping):
            details.append(f"Layout: {raw_slide.get('layout') or 'unknown'}")
            if isinstance(raw_slide.get("title"), str) and raw_slide["title"].strip():
                details.append(f"Title: {raw_slide['title'].strip()}")
        return ("Queued a report slide append.", details)

    if tool_name == "remove_report_slide":
        return (
            "Queued a report slide removal.",
            [
                f"Report: {arguments.get('report_id') or 'unknown'}",
                f"Slide: {arguments.get('slide_id') or 'unknown'}",
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
        details = [f"Path: {arguments.get('path') or 'unknown'}"]
        query_plan = arguments.get("query_plan")
        if isinstance(query_plan, Mapping):
            details.extend(
                _tool_summary_from_query_plan(cast(Mapping[str, object], query_plan))
            )
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


def _get_thread_usage_snapshot(context: ReportAgentContext) -> dict[str, int | float]:
    usage = empty_usage_totals()
    raw_usage = context.thread_metadata.get("usage")
    if isinstance(raw_usage, Mapping):
        usage["input_tokens"] = int(raw_usage.get("input_tokens", 0))
        usage["output_tokens"] = int(raw_usage.get("output_tokens", 0))
        usage["cost_usd"] = round(float(raw_usage.get("cost_usd", 0.0)), 8)
    return usage


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


async def _latest_assistant_item_ids(ctx: ChatKitToolContext) -> list[str]:
    page = await ctx.context.store.load_thread_items(
        ctx.context.thread.id,
        after=None,
        limit=40,
        order="desc",
        context=ctx.context.request_context,
    )
    for item in page.data:
        if item.type == "assistant_message":
            return [item.id]
    return []


def _normalized_feedback_origin(context: ReportAgentContext) -> FeedbackOrigin:
    origin = context.thread_metadata.get("origin")
    if origin in {"interactive", "ui_integration_test"}:
        return cast(FeedbackOrigin, origin)
    return "interactive"


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
    _log_client_tool_schema(
        tool_name,
        params_json_schema,
        strict_json_schema=strict_json_schema,
    )

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
        _log_tool_start(
            request_context,
            tool_name,
            request=summarize_pairs_for_log(
                (
                    ("mode", "client_proxy"),
                    ("args", summarize_mapping_keys_for_log(arguments) or "none"),
                )
            ),
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
        _log_tool_end(request_context, tool_name, result="client_tool_call")
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
    client_tools: Sequence[Mapping[str, Any]],
) -> list[FunctionTool]:
    tools: list[FunctionTool] = []
    tool_names = get_client_tool_names(client_tools)
    registered_tool_map = {
        name.strip(): tool_definition
        for tool_definition in client_tools
        if isinstance((name := tool_definition.get("name")), str) and name.strip()
    }

    @function_tool(name_override="name_current_thread")
    async def name_current_thread_tool(
        ctx: ChatKitToolContext,
        title: str,
    ) -> dict[str, str]:
        """Rename the current thread to a concise, descriptive title for the current investigation."""
        request_context = ctx.context.request_context
        cleaned_title = title.strip()
        _log_tool_start(
            request_context,
            "name_current_thread",
            title=summarize_for_log(cleaned_title, limit=96),
        )
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
        _log_tool_end(
            request_context,
            "name_current_thread",
            title=summarize_for_log(cleaned_title, limit=96),
        )
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
            focus=summarize_for_log(cleaned_focus, limit=160),
            plan=summarize_pairs_for_log(
                (
                    ("steps", len(cleaned_steps)),
                    ("success", len(cleaned_success_criteria)),
                    ("next", summarize_sequence_for_log(cleaned_follow_on_tool_hints)),
                )
            ),
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
        if (
            "render_chart_from_file" in cleaned_follow_on_tool_hints
            or capability_id == "chart-agent"
        ):
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
        _log_tool_end(
            request_context,
            "make_plan",
            plan=summarize_pairs_for_log(
                (
                    ("id", plan["id"]),
                    ("steps", len(cleaned_steps)),
                    ("success", len(cleaned_success_criteria)),
                )
            ),
        )
        return {
            "plan_id": plan["id"],
            "plan": plan,
            "report_id": request_context.report_id,
        }

    @function_tool(name_override="get_current_thread_cost")
    async def get_current_thread_cost_tool(
        ctx: ChatKitToolContext,
    ) -> dict[str, object]:
        """Validator pricing tool. Returns the pre-response thread usage totals; copy usage.cost_usd exactly into COST_USD."""
        request_context = ctx.context.request_context
        usage = _get_thread_usage_snapshot(request_context)
        result = {
            "thread_id": ctx.context.thread.id,
            "scope": "before_current_turn",
            "usage": usage,
        }
        _log_tool_start(
            request_context,
            "get_current_thread_cost",
            scope="before_current_turn",
            usage=summarize_pairs_for_log(
                (
                    ("input", usage["input_tokens"]),
                    ("output", usage["output_tokens"]),
                    ("cost_usd", usage["cost_usd"]),
                )
            ),
        )
        request_context.thread_metadata[DEMO_VALIDATOR_COST_SNAPSHOT_METADATA_KEY] = (
            result
        )
        await ctx.context.stream(
            ProgressUpdateEvent(
                text=f"{DEMO_VALIDATOR_COST_SNAPSHOT_PROGRESS_PREFIX}{json.dumps(result, ensure_ascii=True)}"
            )
        )
        ctx.context.thread.metadata = {
            **dict(ctx.context.thread.metadata),
            DEMO_VALIDATOR_COST_SNAPSHOT_METADATA_KEY: result,
        }
        _log_tool_end(
            request_context,
            "get_current_thread_cost",
            thread_id=ctx.context.thread.id,
            usage=summarize_pairs_for_log(
                (
                    ("input", usage["input_tokens"]),
                    ("output", usage["output_tokens"]),
                    ("cost_usd", usage["cost_usd"]),
                )
            ),
        )
        return result

    if capability_id == DEMO_VALIDATOR_CAPABILITY_ID:
        return [get_current_thread_cost_tool]

    tools.extend([name_current_thread_tool, make_plan_tool])

    if capability_id == "feedback-agent":

        @function_tool(name_override="start_feedback_capture_for_latest_response")
        async def start_feedback_capture_for_latest_response_tool(
            ctx: ChatKitToolContext,
            kind: Literal["positive", "negative"] | None = None,
            label: Literal["ui", "tools", "behavior"] | None = None,
            message: str | None = None,
        ) -> dict[str, object]:
            """Create a feedback draft for the latest assistant response and show a feedback widget in the thread."""
            request_context = ctx.context.request_context
            item_ids = await _latest_assistant_item_ids(ctx)
            if not item_ids:
                raise ValueError(
                    "There is no assistant response in this thread yet to attach feedback to."
                )
            cleaned_message = (
                message.strip()
                if isinstance(message, str) and message.strip()
                else None
            )
            feedback = ChatItemFeedback(
                id=f"fb_{uuid4().hex}",
                thread_id=ctx.context.thread.id,
                item_ids_json=item_ids,
                user_email=(
                    request_context.user_email.strip().lower()
                    if isinstance(request_context.user_email, str)
                    and request_context.user_email.strip()
                    else None
                ),
                kind=kind,
                label=label,
                message=cleaned_message,
                origin=_normalized_feedback_origin(request_context),
            )
            request_context.db.add(feedback)
            await request_context.db.commit()
            record = ChatItemFeedbackRecord(
                id=feedback.id,
                thread_id=feedback.thread_id,
                item_ids=list(feedback.item_ids_json),
                user_email=feedback.user_email,
                kind=feedback.kind,
                label=feedback.label,
                message=feedback.message,
                origin=feedback.origin,
            )
            _log_tool_start(
                request_context,
                "start_feedback_capture_for_latest_response",
                feedback=summarize_pairs_for_log(
                    (
                        ("items", summarize_sequence_for_log(item_ids)),
                        ("kind", kind),
                        ("label", label),
                    )
                ),
            )
            await ctx.context.stream(
                ProgressUpdateEvent(
                    text="Opening a structured feedback form for the latest assistant response."
                )
            )
            await ctx.context.stream_widget(
                build_feedback_capture_widget(record),
                copy_text=build_feedback_capture_copy_text(record),
            )
            _log_tool_end(
                request_context,
                "start_feedback_capture_for_latest_response",
                feedback=summarize_pairs_for_log(
                    (
                        ("id", feedback.id),
                        ("items", summarize_sequence_for_log(item_ids)),
                    )
                ),
            )
            return {
                "feedback_id": feedback.id,
                "thread_id": feedback.thread_id,
                "item_ids": item_ids,
            }

        tools.append(start_feedback_capture_for_latest_response_tool)

    for tool_name in tool_names:
        tool_definition = registered_tool_map.get(tool_name)
        if tool_definition is None:
            continue
        tools.append(_build_client_tool_proxy(tool_definition))

    return tools
