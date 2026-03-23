import json
import logging
from io import BytesIO
from zipfile import ZipFile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any, Literal, Mapping, Sequence, cast
from uuid import uuid4

from agents import FunctionTool, WebSearchTool, function_tool
from agents.tool import Tool
from agents.tool_context import ToolContext
from chatkit.agents import AgentContext as ChatKitAgentContext, ClientToolCall
from chatkit.types import CustomTask, ProgressUpdateEvent, Workflow
from pydantic import BaseModel, ConfigDict, model_validator

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.widgets import (
    build_feedback_saved_copy_text,
    build_feedback_saved_widget,
    build_feedback_session_copy_text,
    build_feedback_session_widget,
    build_tool_trace_copy_text,
    build_tool_trace_widget,
    format_tool_label,
)
from backend.app.chatkit.feedback_types import WorkspaceChatFeedbackRecord, FeedbackOrigin
from backend.app.chatkit.metadata import (
    AgentPlan,
    AgentPlanExecutionHint,
    PendingFeedbackSession,
    PlanExecution,
    active_plan_execution,
)
from backend.app.core.logging import (
    get_logger,
    log_event,
    summarize_mapping_keys_for_log,
    summarize_pairs_for_log,
    summarize_for_log,
    summarize_sequence_for_log,
)
from backend.app.models.chatkit import WorkspaceChatFeedback
from backend.app.schemas.stored_file import (
    DocumentEditResult,
    DocumentFieldValue,
    DocumentInspectionResult,
    DocumentSmartSplitResult,
    DocumentSplitEntry,
)
from backend.app.services.document_pdf import (
    append_pdf_bytes,
    build_dataset_appendix_pdf,
    extract_page_range_pdf,
    fill_form_fields_in_pdf,
    inspect_pdf_document,
    plan_smart_split,
    replace_text_in_pdf,
    replace_visual_region,
)
from backend.app.services.stored_file_service import StoredFileService


logger = get_logger("agents.tools")
ChatKitToolContext = ToolContext[ChatKitAgentContext[ReportAgentContext]]
class PlanExecutionHintInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    done_when: str | None = None
    preferred_tool_names: list[str] | None = None
    preferred_handoff_tool_names: list[str] | None = None

    @model_validator(mode="after")
    def _require_at_least_one_field(self) -> "PlanExecutionHintInput":
        if (
            self.done_when is None
            and not self.preferred_tool_names
            and not self.preferred_handoff_tool_names
        ):
            raise ValueError(
                "Each execution hint must include done_when, preferred_tool_names, or preferred_handoff_tool_names."
            )
        return self


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


def _tool_display_spec(
    tool_definition: Mapping[str, Any],
) -> Mapping[str, Any] | None:
    raw_display = tool_definition.get("display")
    return raw_display if isinstance(raw_display, Mapping) else None


def _summarize_tool_argument_value(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, str):
        cleaned = value.strip()
        return summarize_for_log(cleaned, limit=72) if cleaned else None
    if isinstance(value, Mapping):
        key_summary = summarize_mapping_keys_for_log(cast(Mapping[str, object], value))
        return f"keys={key_summary}" if key_summary else "object"
    if isinstance(value, Sequence) and not isinstance(value, str):
        return f"{len(value)} item{'s' if len(value) != 1 else ''}"
    return summarize_for_log(value, limit=48)


def _basename(path: str) -> str:
    name = PurePosixPath(path).name
    return name or path


def _tool_trace_target(tool_name: str, arguments: Mapping[str, object]) -> str | None:
    if tool_name == "create_dataset":
        filename = arguments.get("filename")
        if isinstance(filename, str) and filename.strip():
            return _basename(filename.strip())

    if tool_name == "create_report":
        title = arguments.get("title")
        if isinstance(title, str) and title.strip():
            return summarize_for_log(title.strip(), limit=56)
        report_id = arguments.get("report_id")
        if isinstance(report_id, str) and report_id.strip():
            return report_id.strip()

    if tool_name == "append_report_slide":
        raw_slide = arguments.get("slide")
        if isinstance(raw_slide, Mapping):
            slide_title = raw_slide.get("title")
            if isinstance(slide_title, str) and slide_title.strip():
                return summarize_for_log(slide_title.strip(), limit=56)
        report_id = arguments.get("report_id")
        if isinstance(report_id, str) and report_id.strip():
            return report_id.strip()

    if tool_name == "render_chart_from_dataset":
        chart_plan = arguments.get("chart_plan")
        if isinstance(chart_plan, Mapping):
            chart_title = chart_plan.get("title")
            if isinstance(chart_title, str) and chart_title.strip():
                return summarize_for_log(chart_title.strip(), limit=56)
        dataset_id = arguments.get("dataset_id")
        if isinstance(dataset_id, str) and dataset_id.strip():
            return dataset_id.strip()

    if tool_name == "save_farm_state":
        farm_name = arguments.get("farm_name")
        if isinstance(farm_name, str) and farm_name.strip():
            return summarize_for_log(farm_name.strip(), limit=56)

    if tool_name == "run_aggregate_query":
        query_plan = arguments.get("query_plan")
        if isinstance(query_plan, Mapping):
            dataset_id = query_plan.get("dataset_id")
            if isinstance(dataset_id, str) and dataset_id.strip():
                return dataset_id.strip()

    for key in ("report_id", "slide_id", "file_id", "dataset_id", "chart_plan_id"):
        value = arguments.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def _resolve_argument_path(
    arguments: Mapping[str, object],
    path: str,
) -> object | None:
    segments = [segment.strip() for segment in path.split(".") if segment.strip()]
    current: object = arguments
    for segment in segments:
        if not isinstance(current, Mapping):
            return None
        current = current.get(segment)
    return current


def _display_arg_label(
    path: str,
    arg_labels: Mapping[str, object] | None,
) -> str:
    if arg_labels:
        raw_label = arg_labels.get(path)
        if isinstance(raw_label, str) and raw_label.strip():
            return raw_label.strip()
    return path.split(".")[-1]


def _format_invocation_argument(
    path: str,
    arguments: Mapping[str, object],
    *,
    arg_labels: Mapping[str, object] | None = None,
) -> str | None:
    value = _resolve_argument_path(arguments, path)
    preview = _summarize_tool_argument_value(value)
    if preview is None:
        return None
    return f"{_display_arg_label(path, arg_labels)}={preview}"


def _default_invocation_argument_paths(
    tool_name: str,
    arguments: Mapping[str, object],
) -> list[str]:
    target = _tool_trace_target(tool_name, arguments)
    if target:
        return []
    return sorted(arguments.keys())[:2]


def _format_tool_invocation(
    tool_name: str,
    arguments: Mapping[str, object],
    *,
    tool_definition: Mapping[str, Any] | None = None,
) -> str:
    label = format_tool_label(tool_name)
    display = _tool_display_spec(tool_definition or {})
    if display:
        raw_label = display.get("label")
        if isinstance(raw_label, str) and raw_label.strip():
            label = raw_label.strip()

    target = _tool_trace_target(tool_name, arguments)
    raw_prominent_args = display.get("prominent_args") if display else None
    prominent_args = [
        item.strip()
        for item in raw_prominent_args
        if isinstance(item, str) and item.strip()
    ] if isinstance(raw_prominent_args, Sequence) and not isinstance(raw_prominent_args, str) else []
    raw_omit_args = display.get("omit_args") if display else None
    omit_args = {
        item.strip()
        for item in raw_omit_args
        if isinstance(item, str) and item.strip()
    } if isinstance(raw_omit_args, Sequence) and not isinstance(raw_omit_args, str) else set()
    raw_arg_labels = display.get("arg_labels") if display else None
    arg_labels = raw_arg_labels if isinstance(raw_arg_labels, Mapping) else None

    if prominent_args:
        rendered_args = [
            rendered
            for path in prominent_args
            if path not in omit_args
            if (
                rendered := _format_invocation_argument(
                    path,
                    arguments,
                    arg_labels=arg_labels,
                )
            )
            is not None
        ]
    else:
        rendered_args = [
            rendered
            for path in _default_invocation_argument_paths(tool_name, arguments)
            if path not in omit_args
            if (
                rendered := _format_invocation_argument(
                    path,
                    arguments,
                    arg_labels=arg_labels,
                )
            )
            is not None
        ]

    if rendered_args:
        return f"{label}({', '.join(rendered_args)})"
    if target:
        return f"{label}({target})"
    return f"{label}()"


async def _stream_tool_trace_widget(
    ctx: ChatKitToolContext,
    tool_name: str,
    invocation: str,
) -> None:
    if active_plan_execution(ctx.context.request_context.thread_metadata):
        return
    await ctx.context.stream_widget(
        build_tool_trace_widget(tool_name, invocation),
        copy_text=build_tool_trace_copy_text(tool_name, invocation),
    )


def _normalize_execution_hint(
    hint: PlanExecutionHintInput,
) -> AgentPlanExecutionHint:
    normalized: AgentPlanExecutionHint = {}
    if isinstance(hint.done_when, str) and hint.done_when.strip():
        normalized["done_when"] = hint.done_when.strip()
    if hint.preferred_tool_names:
        normalized["preferred_tool_names"] = [
            tool_name.strip()
            for tool_name in hint.preferred_tool_names
            if isinstance(tool_name, str) and tool_name.strip()
        ]
    if hint.preferred_handoff_tool_names:
        normalized["preferred_handoff_tool_names"] = [
            tool_name.strip()
            for tool_name in hint.preferred_handoff_tool_names
            if isinstance(tool_name, str) and tool_name.strip()
        ]
    return normalized


def _plan_task_content(
    execution_hint: AgentPlanExecutionHint | None,
    note: str | None = None,
) -> str | None:
    lines: list[str] = []
    if execution_hint:
        done_when = execution_hint.get("done_when")
        if isinstance(done_when, str) and done_when.strip():
            lines.append(f"Done when: {done_when.strip()}")
        tool_names = execution_hint.get("preferred_tool_names")
        if tool_names:
            lines.append(f"Preferred tools: {', '.join(tool_names)}")
        handoff_names = execution_hint.get("preferred_handoff_tool_names")
        if handoff_names:
            lines.append(f"Preferred handoffs: {', '.join(handoff_names)}")
    if isinstance(note, str) and note.strip():
        lines.append(f"Note: {note.strip()}")
    return "\n".join(lines) if lines else None


def _build_plan_workflow(
    plan: AgentPlan,
) -> Workflow:
    execution_hints = cast(
        list[AgentPlanExecutionHint] | None,
        plan.get("execution_hints"),
    )
    tasks = [
        CustomTask(
            title=f"{index}. {step}",
            content=_plan_task_content(
                execution_hints[index - 1] if execution_hints else None
            ),
            status_indicator="loading" if index == 1 else "none",
        )
        for index, step in enumerate(plan["planned_steps"], start=1)
    ]
    return Workflow(type="custom", tasks=tasks)


async def _latest_thread_item_id(ctx: ChatKitToolContext) -> str | None:
    page = await ctx.context.store.load_thread_items(
        ctx.context.thread.id,
        after=None,
        limit=1,
        order="desc",
        context=ctx.context.request_context,
    )
    if not page.data:
        return None
    return page.data[0].id


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


def _document_service(context: ReportAgentContext) -> StoredFileService:
    return StoredFileService(context.db)


def _document_revision_name(file_name: str, suffix: str) -> str:
    path = PurePosixPath(file_name)
    stem = path.stem or path.name or "document"
    extension = path.suffix or ".pdf"
    return f"{stem}_{suffix}{extension}"


def _normalized_feedback_origin(context: ReportAgentContext) -> FeedbackOrigin:
    origin = context.thread_metadata.get("origin")
    if origin in {"interactive", "ui_integration_test"}:
        return cast(FeedbackOrigin, origin)
    return "interactive"


def _normalize_feedback_message(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _normalize_feedback_options(value: Sequence[str]) -> list[str]:
    cleaned = [_normalize_feedback_message(item) for item in value]
    options = [item for item in cleaned if item is not None]
    if len(options) != 3:
        raise ValueError(
            "recommended_options must contain exactly three non-empty draft statements."
        )
    return options


def _normalized_user_email(context: ReportAgentContext) -> str | None:
    if isinstance(context.user_email, str) and context.user_email.strip():
        return context.user_email.strip().lower()
    return None


def _current_feedback_session(
    context: ReportAgentContext,
) -> PendingFeedbackSession | None:
    session = context.thread_metadata.get("feedback_session")
    return cast(PendingFeedbackSession, session) if isinstance(session, dict) else None


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
        await _stream_tool_trace_widget(
            ctx,
            tool_name,
            _format_tool_invocation(
                tool_name,
                arguments,
                tool_definition=tool_definition,
            ),
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


def _build_hosted_tools(
    *,
    agent_id: str,
    client_tools: Sequence[Mapping[str, Any]],
) -> list[Tool]:
    tools: list[Tool] = []

    if agent_id == "agriculture-agent":
        tools.append(
            WebSearchTool(
                search_context_size="medium",
            )
        )

    if agent_id == "document-agent":

        @function_tool(name_override="list_document_files")
        async def list_document_files_tool(
            ctx: ChatKitToolContext,
        ) -> dict[str, object]:
            """List thread-scoped document files available to the current documents thread."""
            request_context = ctx.context.request_context
            service = _document_service(request_context)
            result = await service.list_document_files(
                user_id=request_context.user_id,
                thread_id=ctx.context.thread.id,
            )
            _log_tool_start(
                request_context,
                "list_document_files",
                thread=ctx.context.thread.id,
            )
            _log_tool_end(
                request_context,
                "list_document_files",
                files=len(result.files),
            )
            return result.model_dump(mode="json")

        @function_tool(name_override="inspect_document_file")
        async def inspect_document_file_tool(
            ctx: ChatKitToolContext,
            file_id: str,
            max_pages: int | None = None,
        ) -> dict[str, object]:
            """Inspect a stored PDF and return stable locator ids for text, form fields, and visual candidates."""
            request_context = ctx.context.request_context
            service = _document_service(request_context)
            record = await service.get_document_file(
                user_id=request_context.user_id,
                thread_id=ctx.context.thread.id,
                file_id=file_id,
            )
            if record.kind != "pdf":
                raise ValueError("inspect_document_file currently requires a PDF.")
            pdf_bytes = await service.load_file_bytes(record)
            inspection = inspect_pdf_document(
                file_summary=service.serialize_document_file(record),
                pdf_bytes=pdf_bytes,
                max_pages=max_pages or get_settings().document_preview_max_pages,
            )
            _log_tool_start(
                request_context,
                "inspect_document_file",
                file=file_id,
                pages=inspection.result.page_count,
            )
            _log_tool_end(
                request_context,
                "inspect_document_file",
                locators=len(inspection.result.locators),
            )
            return inspection.result.model_dump(mode="json")

        @function_tool(name_override="replace_document_text")
        async def replace_document_text_tool(
            ctx: ChatKitToolContext,
            file_id: str,
            locator_id: str,
            replacement_text: str,
        ) -> dict[str, object]:
            """Replace text in a PDF by locator id, using direct stream replacement only when it is safe and otherwise falling back to a safe overlay."""
            request_context = ctx.context.request_context
            service = _document_service(request_context)
            record = await service.get_document_file(
                user_id=request_context.user_id,
                thread_id=ctx.context.thread.id,
                file_id=file_id,
            )
            if record.kind != "pdf":
                raise ValueError("replace_document_text currently requires a PDF.")
            pdf_bytes = await service.load_file_bytes(record)
            inspection = inspect_pdf_document(
                file_summary=service.serialize_document_file(record),
                pdf_bytes=pdf_bytes,
                max_pages=get_settings().document_preview_max_pages,
            )
            locator = inspection.text_blocks.get(locator_id)
            if locator is None:
                raise ValueError("The requested text locator was not found.")
            updated_pdf_bytes, strategy, warning = replace_text_in_pdf(
                pdf_bytes=pdf_bytes,
                locator=locator,
                replacement_text=replacement_text,
            )
            if updated_pdf_bytes is None or strategy is None:
                raise ValueError(warning or "The requested text replacement could not be applied safely.")
            revised = await service.create_document_revision(
                parent_record=record,
                file_name=_document_revision_name(record.name, "text_update"),
                file_bytes=updated_pdf_bytes,
            )
            result = DocumentEditResult(
                file=service.serialize_document_file(revised),
                parent_file_id=record.id,
                strategy_used=strategy,
                message="Created a new PDF revision with the requested text update.",
                warning=warning,
            )
            _log_tool_start(
                request_context,
                "replace_document_text",
                file=file_id,
                locator=locator_id,
            )
            _log_tool_end(
                request_context,
                "replace_document_text",
                strategy=strategy,
                file=revised.id,
            )
            return result.model_dump(mode="json")

        @function_tool(name_override="fill_document_form")
        async def fill_document_form_tool(
            ctx: ChatKitToolContext,
            file_id: str,
            field_values: list[DocumentFieldValue],
        ) -> dict[str, object]:
            """Fill PDF form fields by discovered locator id, returning unresolved locator ids explicitly when a field cannot be resolved."""
            request_context = ctx.context.request_context
            service = _document_service(request_context)
            record = await service.get_document_file(
                user_id=request_context.user_id,
                thread_id=ctx.context.thread.id,
                file_id=file_id,
            )
            if record.kind != "pdf":
                raise ValueError("fill_document_form currently requires a PDF.")
            pdf_bytes = await service.load_file_bytes(record)
            inspection = inspect_pdf_document(
                file_summary=service.serialize_document_file(record),
                pdf_bytes=pdf_bytes,
                max_pages=get_settings().document_preview_max_pages,
            )
            values_by_field_name: dict[str, str] = {}
            unresolved_locator_ids: list[str] = []
            for field_value in field_values:
                field_locator = inspection.form_fields.get(field_value.locator_id)
                if field_locator is None:
                    unresolved_locator_ids.append(field_value.locator_id)
                    continue
                values_by_field_name[field_locator.name] = field_value.value
            if not values_by_field_name:
                raise ValueError("None of the requested form field locators could be resolved.")
            updated_pdf_bytes = fill_form_fields_in_pdf(
                pdf_bytes=pdf_bytes,
                field_values=values_by_field_name,
            )
            revised = await service.create_document_revision(
                parent_record=record,
                file_name=_document_revision_name(record.name, "form_fill"),
                file_bytes=updated_pdf_bytes,
            )
            result = DocumentEditResult(
                file=service.serialize_document_file(revised),
                parent_file_id=record.id,
                strategy_used="form_fill",
                message="Created a new PDF revision with updated form field values.",
                warning=(
                    "Some requested form fields were not resolved."
                    if unresolved_locator_ids
                    else None
                ),
                unresolved_locator_ids=unresolved_locator_ids,
            )
            _log_tool_start(
                request_context,
                "fill_document_form",
                file=file_id,
                resolved=len(values_by_field_name),
                unresolved=len(unresolved_locator_ids),
            )
            _log_tool_end(
                request_context,
                "fill_document_form",
                file=revised.id,
            )
            return result.model_dump(mode="json")

        @function_tool(name_override="update_document_visual_from_dataset")
        async def update_document_visual_from_dataset_tool(
            ctx: ChatKitToolContext,
            file_id: str,
            locator_id: str,
            dataset_file_id: str,
            title: str | None = None,
            render_as: Literal["table", "chart"] = "table",
        ) -> dict[str, object]:
            """Update a chart or table candidate from a dataset file by replacing a reliable visual region when possible, otherwise appending the update at the end of the PDF."""
            request_context = ctx.context.request_context
            service = _document_service(request_context)
            record = await service.get_document_file(
                user_id=request_context.user_id,
                thread_id=ctx.context.thread.id,
                file_id=file_id,
            )
            dataset_record = await service.get_document_file(
                user_id=request_context.user_id,
                thread_id=ctx.context.thread.id,
                file_id=dataset_file_id,
            )
            if record.kind != "pdf":
                raise ValueError("update_document_visual_from_dataset requires a PDF target.")
            dataset_rows = await service.load_dataset_rows(dataset_record)
            if not dataset_rows:
                raise ValueError("The selected dataset file did not contain any usable rows.")
            pdf_bytes = await service.load_file_bytes(record)
            inspection = inspect_pdf_document(
                file_summary=service.serialize_document_file(record),
                pdf_bytes=pdf_bytes,
                max_pages=get_settings().document_preview_max_pages,
            )
            locator = inspection.visual_locators.get(locator_id)
            warning: str | None = None
            if locator is None:
                raise ValueError("The requested visual locator was not found.")
            update_title = title.strip() if isinstance(title, str) and title.strip() else f"Updated {locator.label}"
            if locator.reliability == "high":
                updated_pdf_bytes = replace_visual_region(
                    pdf_bytes=pdf_bytes,
                    locator=locator,
                    title=update_title,
                    rows=dataset_rows,
                    render_as=render_as,
                )
                strategy = "visual_replace"
            else:
                appendix_pdf_bytes = build_dataset_appendix_pdf(
                    title=update_title,
                    rows=dataset_rows,
                    render_as=render_as,
                )
                updated_pdf_bytes = append_pdf_bytes(
                    base_pdf_bytes=pdf_bytes,
                    appendix_pdf_bytes=appendix_pdf_bytes,
                )
                strategy = "visual_append"
                warning = (
                    "The located visual anchor was not reliable enough for in-place replacement, so the updated visual was appended to the end of the PDF."
                )
            revised = await service.create_document_revision(
                parent_record=record,
                file_name=_document_revision_name(record.name, "visual_update"),
                file_bytes=updated_pdf_bytes,
            )
            result = DocumentEditResult(
                file=service.serialize_document_file(revised),
                parent_file_id=record.id,
                strategy_used=strategy,
                message="Created a new PDF revision with the requested visual update.",
                warning=warning,
            )
            _log_tool_start(
                request_context,
                "update_document_visual_from_dataset",
                file=file_id,
                dataset=dataset_file_id,
                locator=locator_id,
            )
            _log_tool_end(
                request_context,
                "update_document_visual_from_dataset",
                strategy=strategy,
                file=revised.id,
            )
            return result.model_dump(mode="json")

        @function_tool(name_override="append_document_appendix_from_dataset")
        async def append_document_appendix_from_dataset_tool(
            ctx: ChatKitToolContext,
            file_id: str,
            dataset_file_id: str,
            title: str,
            render_as: Literal["table", "chart"] = "table",
        ) -> dict[str, object]:
            """Append a table or chart appendix generated from a thread-scoped dataset file."""
            request_context = ctx.context.request_context
            service = _document_service(request_context)
            record = await service.get_document_file(
                user_id=request_context.user_id,
                thread_id=ctx.context.thread.id,
                file_id=file_id,
            )
            dataset_record = await service.get_document_file(
                user_id=request_context.user_id,
                thread_id=ctx.context.thread.id,
                file_id=dataset_file_id,
            )
            if record.kind != "pdf":
                raise ValueError("append_document_appendix_from_dataset requires a PDF target.")
            dataset_rows = await service.load_dataset_rows(dataset_record)
            appendix_pdf_bytes = build_dataset_appendix_pdf(
                title=title.strip(),
                rows=dataset_rows,
                render_as=render_as,
            )
            pdf_bytes = await service.load_file_bytes(record)
            updated_pdf_bytes = append_pdf_bytes(
                base_pdf_bytes=pdf_bytes,
                appendix_pdf_bytes=appendix_pdf_bytes,
            )
            revised = await service.create_document_revision(
                parent_record=record,
                file_name=_document_revision_name(record.name, "appendix"),
                file_bytes=updated_pdf_bytes,
            )
            result = DocumentEditResult(
                file=service.serialize_document_file(revised),
                parent_file_id=record.id,
                strategy_used="appendix_append",
                message="Created a new PDF revision with the dataset appendix appended.",
            )
            _log_tool_start(
                request_context,
                "append_document_appendix_from_dataset",
                file=file_id,
                dataset=dataset_file_id,
            )
            _log_tool_end(
                request_context,
                "append_document_appendix_from_dataset",
                file=revised.id,
            )
            return result.model_dump(mode="json")

        @function_tool(name_override="smart_split_document")
        async def smart_split_document_tool(
            ctx: ChatKitToolContext,
            file_id: str,
            goal: str | None = None,
        ) -> dict[str, object]:
            """Split a PDF into useful thread-scoped derived files, plus a ZIP bundle and markdown index."""
            del goal
            request_context = ctx.context.request_context
            service = _document_service(request_context)
            record = await service.get_document_file(
                user_id=request_context.user_id,
                thread_id=ctx.context.thread.id,
                file_id=file_id,
            )
            if record.kind != "pdf":
                raise ValueError("smart_split_document currently requires a PDF.")
            pdf_bytes = await service.load_file_bytes(record)
            inspection = inspect_pdf_document(
                file_summary=service.serialize_document_file(record),
                pdf_bytes=pdf_bytes,
                max_pages=get_settings().document_preview_max_pages,
            )
            split_plan = plan_smart_split(inspection=inspection)
            archive_buffer = BytesIO()
            markdown_lines = [f"# Split Index for {record.name}", ""]
            entries: list[DocumentSplitEntry] = []
            with ZipFile(archive_buffer, mode="w") as archive:
                for index, split_range in enumerate(split_plan, start=1):
                    split_bytes = extract_page_range_pdf(
                        pdf_bytes=pdf_bytes,
                        start_page=split_range.start_page,
                        end_page=split_range.end_page,
                    )
                    part_name = _document_revision_name(record.name, f"part_{index}")
                    part_record = await service.create_document_revision(
                        parent_record=record,
                        file_name=part_name,
                        file_bytes=split_bytes,
                    )
                    archive.writestr(part_name, split_bytes)
                    markdown_lines.extend(
                        [
                            f"## {split_range.title}",
                            f"- Pages: {split_range.start_page}-{split_range.end_page}",
                            f"- File id: {part_record.id}",
                            "",
                        ]
                    )
                    entries.append(
                        DocumentSplitEntry(
                            file=service.serialize_document_file(part_record),
                            title=split_range.title,
                            start_page=split_range.start_page,
                            end_page=split_range.end_page,
                            page_count=split_range.page_count,
                        )
                    )
                markdown = "\n".join(markdown_lines).strip() + "\n"
                archive.writestr("index.md", markdown.encode("utf-8"))

            index_record = await service.create_document_revision(
                parent_record=record,
                file_name=f"{PurePosixPath(record.name).stem or 'document'}_index.md",
                file_bytes=markdown.encode("utf-8"),
                mime_type="text/markdown",
            )
            archive_record = await service.create_document_revision(
                parent_record=record,
                file_name=f"{PurePosixPath(record.name).stem or 'document'}_split.zip",
                file_bytes=archive_buffer.getvalue(),
                mime_type="application/zip",
            )
            result = DocumentSmartSplitResult(
                source_file=service.serialize_document_file(record),
                archive_file=service.serialize_document_file(archive_record),
                index_file=service.serialize_document_file(index_record),
                entries=entries,
                markdown=markdown,
            )
            _log_tool_start(
                request_context,
                "smart_split_document",
                file=file_id,
                entries=len(entries),
            )
            _log_tool_end(
                request_context,
                "smart_split_document",
                archive=archive_record.id,
                index=index_record.id,
            )
            return result.model_dump(mode="json")

        @function_tool(name_override="delete_document_file")
        async def delete_document_file_tool(
            ctx: ChatKitToolContext,
            file_id: str,
        ) -> dict[str, object]:
            """Delete a thread-scoped document file record."""
            request_context = ctx.context.request_context
            service = _document_service(request_context)
            result = await service.delete_document_file(
                user_id=request_context.user_id,
                thread_id=ctx.context.thread.id,
                file_id=file_id,
            )
            _log_tool_start(
                request_context,
                "delete_document_file",
                file=file_id,
            )
            _log_tool_end(
                request_context,
                "delete_document_file",
                file=file_id,
            )
            return result.model_dump(mode="json")

        tools.extend(
            [
                list_document_files_tool,
                inspect_document_file_tool,
                replace_document_text_tool,
                fill_document_form_tool,
                update_document_visual_from_dataset_tool,
                append_document_appendix_from_dataset_tool,
                smart_split_document_tool,
                delete_document_file_tool,
            ]
        )

    return tools


def build_agent_tools(
    context: ReportAgentContext,
    *,
    agent_id: str,
    client_tools: Sequence[Mapping[str, Any]],
) -> list[Tool]:
    tools: list[Tool] = []
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
            f"Name Current Thread(title={summarize_for_log(cleaned_title, limit=72)})",
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
        execution_hints: list[PlanExecutionHintInput] | None = None,
    ) -> dict[str, object]:
        """Write down a concise plan, optionally add per-step execution hints, and continue executing it immediately with more tool calls."""
        request_context = ctx.context.request_context
        cleaned_focus = focus.strip()
        cleaned_steps = [step.strip() for step in planned_steps if step.strip()]
        cleaned_success_criteria = [
            item.strip() for item in success_criteria or [] if item.strip()
        ]
        cleaned_follow_on_tool_hints = [
            item.strip() for item in follow_on_tool_hints or [] if item.strip()
        ]
        cleaned_execution_hints = [
            _normalize_execution_hint(hint) for hint in execution_hints or []
        ]
        if cleaned_execution_hints and len(cleaned_execution_hints) != len(cleaned_steps):
            raise ValueError(
                "execution_hints must align one-to-one with planned_steps."
            )
        _log_tool_start(
            request_context,
            "make_plan",
            focus=summarize_for_log(cleaned_focus, limit=160),
            plan=summarize_pairs_for_log(
                (
                    ("steps", len(cleaned_steps)),
                    ("success", len(cleaned_success_criteria)),
                    ("next", summarize_sequence_for_log(cleaned_follow_on_tool_hints)),
                    ("hints", len(cleaned_execution_hints)),
                )
            ),
        )
        latest_item_id = await _latest_thread_item_id(ctx)
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
        if cleaned_execution_hints:
            plan["execution_hints"] = cleaned_execution_hints
        existing_execution = active_plan_execution(request_context.thread_metadata)
        if (
            existing_execution is not None
            and ctx.context.workflow_item is not None
            and ctx.context.workflow_item.id == existing_execution["workflow_item_id"]
        ):
            await ctx.context.end_workflow()
        request_context.thread_metadata["plan"] = plan
        if (
            "render_chart_from_dataset" in cleaned_follow_on_tool_hints
            or agent_id == "chart-agent"
        ):
            request_context.thread_metadata["chart_plan"] = plan
        await ctx.context.start_workflow(_build_plan_workflow(plan))
        workflow_item = ctx.context.workflow_item
        if workflow_item is None:
            raise RuntimeError("Plan workflow failed to initialize.")
        plan_execution: PlanExecution = {
            "plan_id": plan["id"],
            "status": "active",
            "workflow_item_id": workflow_item.id,
            "current_step_index": 0,
            "attempts_by_step": [0 for _ in cleaned_steps],
            "step_notes": [None for _ in cleaned_steps],
        }
        if latest_item_id is not None:
            plan_execution["step_started_after_item_id"] = latest_item_id
        request_context.thread_metadata["plan_execution"] = plan_execution
        ctx.context.thread.metadata = dict(request_context.thread_metadata)
        await ctx.context.stream(
            ProgressUpdateEvent(
                text=(
                    f"Plan saved with {len(cleaned_steps)} step(s). Execution workflow started; continue carrying out step 1 now."
                )
            )
        )
        _log_tool_end(
            request_context,
            "make_plan",
            plan=summarize_pairs_for_log(
                (
                    ("id", plan["id"]),
                    ("steps", len(cleaned_steps)),
                    ("success", len(cleaned_success_criteria)),
                    ("workflow", workflow_item.id),
                )
            ),
        )
        return {
            "plan_id": plan["id"],
            "plan": plan,
            "plan_execution": plan_execution,
            "report_id": request_context.report_id,
        }

    tools.extend([name_current_thread_tool, make_plan_tool])
    tools.extend(_build_hosted_tools(agent_id=agent_id, client_tools=client_tools))
    hosted_tool_names = {tool.name for tool in tools}

    if agent_id == "feedback-agent":

        @function_tool(name_override="get_feedback")
        async def get_feedback_tool(
            ctx: ChatKitToolContext,
            recommended_options: list[str],
            inferred_sentiment: Literal["positive", "negative"] | None = None,
            explicit_feedback: str | None = None,
        ) -> dict[str, object]:
            """Present a feedback widget for the latest assistant response, then wait for the user to confirm it."""
            request_context = ctx.context.request_context
            item_ids = await _latest_assistant_item_ids(ctx)
            if not item_ids:
                raise ValueError(
                    "There is no assistant response in this thread yet to attach feedback to."
                )
            cleaned_options = _normalize_feedback_options(recommended_options)
            cleaned_feedback = _normalize_feedback_message(explicit_feedback)
            session: PendingFeedbackSession = {
                "session_id": f"fbs_{uuid4().hex}",
                "item_ids": item_ids,
                "recommended_options": cleaned_options,
                "message_draft": cleaned_feedback,
                "inferred_sentiment": inferred_sentiment,
                "mode": "confirmation" if cleaned_feedback else "recommendations",
            }
            request_context.thread_metadata["feedback_session"] = session
            ctx.context.thread.metadata = dict(request_context.thread_metadata)
            _log_tool_start(
                request_context,
                "get_feedback",
                session=summarize_pairs_for_log(
                    (
                        ("id", session["session_id"]),
                        ("items", summarize_sequence_for_log(item_ids)),
                        ("mode", session["mode"]),
                        ("sentiment", inferred_sentiment),
                    )
                ),
            )
            await ctx.context.stream(
                ProgressUpdateEvent(
                    text=(
                        "Opening a feedback confirmation form for the latest assistant response."
                        if cleaned_feedback
                        else "Opening a structured feedback form for the latest assistant response."
                    )
                )
            )
            await ctx.context.stream_widget(
                build_feedback_session_widget(session),
                copy_text=build_feedback_session_copy_text(session),
            )
            _log_tool_end(
                request_context,
                "get_feedback",
                session=summarize_pairs_for_log(
                    (
                        ("id", session["session_id"]),
                        ("items", summarize_sequence_for_log(item_ids)),
                    )
                ),
            )
            return {
                "session_id": session["session_id"],
                "chat_id": ctx.context.thread.id,
                "item_ids": item_ids,
                "status": "waiting_for_user",
                "message": "The user has been presented a feedback widget; wait for a response.",
            }

        @function_tool(name_override="send_feedback")
        async def send_feedback_tool(
            ctx: ChatKitToolContext,
            message: str,
            sentiment: Literal["positive", "negative"],
            item_ids: list[str] | None = None,
            chat_id: str | None = None,
        ) -> dict[str, object]:
            """Persist confirmed feedback for the current chat, linked to the latest assistant response by default."""
            request_context = ctx.context.request_context
            cleaned_message = _normalize_feedback_message(message)
            if cleaned_message is None:
                raise ValueError("message must be a non-empty string.")
            session = _current_feedback_session(request_context)
            target_item_ids = [
                item.strip()
                for item in item_ids or []
                if isinstance(item, str) and item.strip()
            ]
            if not target_item_ids and session is not None:
                target_item_ids = list(session["item_ids"])
            if not target_item_ids:
                target_item_ids = await _latest_assistant_item_ids(ctx)
            if not target_item_ids:
                raise ValueError(
                    "There is no assistant response available to attach feedback to."
                )
            target_chat_id = (
                chat_id.strip()
                if isinstance(chat_id, str) and chat_id.strip()
                else ctx.context.thread.id
            )
            feedback = WorkspaceChatFeedback(
                id=f"fb_{uuid4().hex}",
                chat_id=target_chat_id,
                item_ids_json=target_item_ids,
                user_email=_normalized_user_email(request_context),
                kind=sentiment,
                label=None,
                message=cleaned_message,
                origin=_normalized_feedback_origin(request_context),
            )
            request_context.db.add(feedback)
            await request_context.db.commit()
            request_context.thread_metadata.pop("feedback_session", None)
            ctx.context.thread.metadata = dict(request_context.thread_metadata)
            record = WorkspaceChatFeedbackRecord(
                id=feedback.id,
                chat_id=feedback.chat_id,
                item_ids=list(feedback.item_ids_json),
                user_email=feedback.user_email,
                kind=feedback.kind,
                message=feedback.message,
                origin=feedback.origin,
            )
            _log_tool_start(
                request_context,
                "send_feedback",
                feedback=summarize_pairs_for_log(
                    (
                        ("chat", target_chat_id),
                        ("sentiment", sentiment),
                        ("items", summarize_sequence_for_log(target_item_ids)),
                    )
                ),
            )
            await ctx.context.stream_widget(
                build_feedback_saved_widget(record),
                copy_text=build_feedback_saved_copy_text(record),
            )
            _log_tool_end(
                request_context,
                "send_feedback",
                feedback=summarize_pairs_for_log(
                    (
                        ("id", feedback.id),
                        ("chat", target_chat_id),
                        ("sentiment", sentiment),
                    )
                ),
            )
            return record.model_dump(mode="json")

        tools.extend([get_feedback_tool, send_feedback_tool])

    for tool_name in tool_names:
        if tool_name in hosted_tool_names:
            continue
        tool_definition = registered_tool_map.get(tool_name)
        if tool_definition is None:
            continue
        tools.append(_build_client_tool_proxy(tool_definition))

    return tools
