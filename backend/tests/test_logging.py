import asyncio
import logging
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.agents.agent_builder import _build_agent_graph
from backend.app.agents.context import ReportAgentContext
from backend.app.agents.tools import (
    _log_tool_end,
    _log_tool_start,
    summarize_client_tool_schema_for_log,
)
from backend.app.chatkit.server import (
    ClientWorkspaceChatKitServer,
    ClientToolResultConverter,
    _summarize_client_tool_result_for_log,
    _usage_line,
)
from backend.app.core.logging import (
    COMPILE_LOG_DEDUPE_WINDOW_SECONDS,
    _build_plain_formatter,
    clear_log_event_dedupe_cache,
    configure_logging,
    get_logger,
    log_event,
    resolve_chatkit_log_level,
    resolve_external_log_level,
    resolve_log_level,
    resolve_openai_log_level,
    resolve_pydantic_log_level,
    resolve_quiet_library_log_level,
    resolve_sqlalchemy_log_level,
)


class _StubFilesClient:
    def __init__(self) -> None:
        self.calls: list[tuple[object, str]] = []

    async def create(self, *, file: object, purpose: str):
        self.calls.append((file, purpose))
        return SimpleNamespace(id="file_uploaded_123")


class _StubOpenAIClient:
    def __init__(self) -> None:
        self.files = _StubFilesClient()


def test_event_formatter_renders_multiline_fields() -> None:
    stream = StringIO()
    logger = logging.getLogger("report_foundry.tests.logging.formatter")
    logger.handlers.clear()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_build_plain_formatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    log_event(
        logger,
        logging.INFO,
        "agent.capability_compiled",
        rendered=[
            "Feedback Agent(Chart Agent):",
            "- create_report(title)",
        ],
        thread_id="thr_123",
        status="ready",
    )

    output = stream.getvalue()
    assert "agent.capability_compiled" in output
    assert "\n > Feedback Agent(Chart Agent):" in output
    assert "\n > - create_report(title)" in output
    assert "\n > thread_id=thr_123" in output
    assert "\n > status=ready" in output


def test_event_formatter_omits_empty_fields_and_preserves_legacy_messages() -> None:
    stream = StringIO()
    logger = logging.getLogger("report_foundry.tests.logging.legacy")
    logger.handlers.clear()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_build_plain_formatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    log_event(
        logger,
        logging.INFO,
        "tool.start",
        tool_name="render_chart_from_file",
        empty_string="",
        none_value=None,
        false_value=False,
    )
    logger.warning("legacy warning")

    output = stream.getvalue()
    assert "\n > empty_string=" not in output
    assert "\n > none_value=" not in output
    assert "\n > false_value=false" in output
    assert "legacy warning" in output


def test_client_tool_result_summary_strips_blob_content() -> None:
    summary = _summarize_client_tool_result_for_log(
        {
            "row_count": 3,
            "rows": [{"revenue": 1}, {"revenue": 2}],
            "imageDataUrl": "data:image/png;base64,very-secret",
            "file_input": {
                "filename": "derived.json",
                "file_data": "c2VjcmV0LXBheWxvYWQ=",
            },
            "created_file": {
                "id": "file_123",
                "kind": "json",
                "name": "derived.json",
            },
        }
    )

    assert summary["row_count"] == 3
    assert summary["rows"] == 2
    assert summary["has_image"] is True
    assert summary["has_file_input"] is True
    assert summary["created_file_kind"] == "json"
    assert summary["created_file_id"] == "file_123"
    assert "very-secret" not in str(summary)
    assert "c2VjcmV0LXBheWxvYWQ=" not in str(summary)


def test_tool_start_and_end_logs_are_structured() -> None:
    context = SimpleNamespace(report_id="rep_123", user_id="user_456")
    stream = StringIO()
    logger = logging.getLogger("report_foundry.agents.tools")
    logger.handlers.clear()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_build_plain_formatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    try:
        _log_tool_start(context, "run_aggregate_query", dataset_id="sales_csv")
        _log_tool_end(context, "run_aggregate_query", mode="client_tool_call")
    finally:
        logger.removeHandler(handler)

    captured = stream.getvalue()
    assert "tool.start" in captured
    assert "tool.end" in captured
    assert "run_aggregate_query [user=user_456 report=rep_123]" in captured
    assert "dataset_id=sales_csv" in captured


def test_client_tool_output_received_log_uses_summaries() -> None:
    openai_client = _StubOpenAIClient()
    converter = ClientToolResultConverter(openai_client, {})
    stream = StringIO()
    logger = logging.getLogger("report_foundry.chatkit.server")
    logger.handlers.clear()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_build_plain_formatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    item = SimpleNamespace(
        status="completed",
        output={
            "row_count": 3,
            "rows": [{"region": "West"}],
            "imageDataUrl": "data:image/png;base64,top-secret",
            "file_input": {
                "filename": "derived.csv",
                "file_data": "bGFrZS1kYXRh",
            },
        },
        call_id="call_123",
        name="render_chart_from_file",
    )

    try:
        result = asyncio.run(converter.client_tool_call_to_input(item))
    finally:
        logger.removeHandler(handler)
    assert result is not None
    assert openai_client.files.calls
    rich_output = result[0]["output"]
    assert rich_output[1] == {
        "type": "input_image",
        "image_url": "data:image/png;base64,top-secret",
        "detail": "high",
    }
    assert rich_output[2] == {
        "type": "input_file",
        "file_id": "file_uploaded_123",
    }
    captured = stream.getvalue()
    assert "tool.output.received" in captured
    assert "render_chart_from_file [id=call_123 status=completed]" in captured
    assert "result=keys=file_input,imageDataUrl,row_count,rows" in captured
    assert "row_count=3" in captured
    assert "rows=1" in captured
    assert "has_image=true" in captured
    assert "has_file_input=true" in captured
    assert "file_input_keys=file_data,filename" in captured
    assert "top-secret" not in captured
    assert "bGFrZS1kYXRh" not in captured


def test_conversation_validation_log_uses_single_logs_link() -> None:
    async def _list_items(_: str):
        return [
            SimpleNamespace(type="message"),
            SimpleNamespace(type="function_call", call_id="call_1"),
            SimpleNamespace(type="function_call_output", call_id="call_1"),
            SimpleNamespace(type="function_call", call_id="call_2"),
        ]

    stream = StringIO()
    logger = logging.getLogger("report_foundry.chatkit.server")
    logger.handlers.clear()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_build_plain_formatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    server = SimpleNamespace(
        _list_conversation_items=_list_items,
        logger=logger,
    )

    try:
        dangling = asyncio.run(
            ClientWorkspaceChatKitServer._find_dangling_tool_calls(
                server,
                "conv_123",
            )
        )
    finally:
        logger.removeHandler(handler)

    assert [item.call_id for item in dangling] == ["call_2"]
    captured = stream.getvalue()
    assert "conversation.validate" in captured
    assert "logs=https://platform.openai.com/logs/conv_123" in captured
    assert "conv=conv_123" not in captured
    assert "conversation_id=" not in captured
    assert "conversation_logs=" not in captured


def test_respond_end_log_uses_logs_link_and_compact_usage() -> None:
    stream = StringIO()
    logger = logging.getLogger("report_foundry.chatkit.server")
    logger.handlers.clear()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_build_plain_formatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

    try:
        log_event(
            logger,
            logging.INFO,
            "respond.end",
            logs="https://platform.openai.com/logs/resp_123",
            context="user=user_123 thread=thr_456",
            usage=_usage_line(
                {
                    "input_tokens": 12,
                    "output_tokens": 34,
                    "cost_usd": 0.005,
                },
                model="gpt-4.1-mini",
            ),
        )
    finally:
        logger.removeHandler(handler)

    captured = stream.getvalue()
    assert "respond.end" in captured
    assert "\n > logs=https://platform.openai.com/logs/resp_123" in captured
    assert "\n > context=user=user_123 thread=thr_456" in captured
    assert "\n > usage=model=gpt-4.1-mini input=12 output=34 cost_usd=0.005" in captured
    assert "\n > conv=" not in captured
    assert "\n > model=gpt-4.1-mini" not in captured
    assert captured.index("\n > logs=") < captured.index("\n > context=")
    assert captured.index("\n > context=") < captured.index("\n > usage=")


def test_client_tool_converter_uses_uploaded_file_ids() -> None:
    openai_client = _StubOpenAIClient()
    converter = ClientToolResultConverter(openai_client, {})

    result = asyncio.run(
        converter.client_tool_result_to_input(
            {
                "file_input": {
                    "filename": "derived.csv",
                    "mime_type": "text/csv",
                    "file_data": "Y29sdW1uCnZhbHVlCg==",
                }
            },
            call_id="call_upload",
            tool_name="create_csv_file",
        )
    )

    assert result is not None
    rich_output = result[0]["output"]
    assert rich_output[1] == {
        "type": "input_file",
        "file_id": "file_uploaded_123",
    }
    assert openai_client.files.calls == [
        (
            ("derived.csv", b"column\nvalue\n", "text/csv"),
            "user_data",
        )
    ]


def test_configure_logging_keeps_debug_selective() -> None:
    root_logger = logging.getLogger()
    openai_logger = logging.getLogger("openai")
    openai_agents_logger = logging.getLogger("openai.agents")
    chatkit_logger = logging.getLogger("chatkit")
    pydantic_logger = logging.getLogger("pydantic")
    httpcore_logger = logging.getLogger("httpcore.http11")
    sqlalchemy_logger = logging.getLogger("sqlalchemy")
    sqlalchemy_engine_logger = logging.getLogger("sqlalchemy.engine")
    previous_levels = {
        root_logger: root_logger.level,
        openai_logger: openai_logger.level,
        openai_agents_logger: openai_agents_logger.level,
        chatkit_logger: chatkit_logger.level,
        pydantic_logger: pydantic_logger.level,
        httpcore_logger: httpcore_logger.level,
        sqlalchemy_logger: sqlalchemy_logger.level,
        sqlalchemy_engine_logger: sqlalchemy_engine_logger.level,
    }

    try:
        configure_logging(logging.DEBUG)
        assert root_logger.level == logging.INFO
        assert openai_logger.level == logging.DEBUG
        assert openai_agents_logger.level == logging.DEBUG
        assert chatkit_logger.level == logging.DEBUG
        assert pydantic_logger.level == logging.DEBUG
        assert httpcore_logger.level == logging.WARNING
        assert sqlalchemy_logger.level == logging.WARNING
        assert sqlalchemy_engine_logger.level == logging.WARNING
    finally:
        for logger_obj, previous_level in previous_levels.items():
            logger_obj.setLevel(previous_level)


def test_get_logger_builds_namespaced_loggers() -> None:
    assert get_logger("").name == "report_foundry"
    assert get_logger("chatkit.server").name == "report_foundry.chatkit.server"


def test_log_event_dedupes_rendered_compile_events_for_five_minutes() -> None:
    clear_log_event_dedupe_cache()
    stream = StringIO()
    logger = logging.getLogger("report_foundry.tests.logging.dedupe")
    logger.handlers.clear()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_build_plain_formatter())
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    try:
        with patch(
            "backend.app.core.logging.time.monotonic",
            side_effect=[100.0, 200.0, 100.0 + COMPILE_LOG_DEDUPE_WINDOW_SECONDS + 1.0],
        ):
            log_event(
                logger,
                logging.DEBUG,
                "tool.schema_compiled",
                rendered=[
                    "create_report(title)",
                    "schema=closed strict=true required=title",
                ],
                dedupe=True,
            )
            log_event(
                logger,
                logging.DEBUG,
                "tool.schema_compiled",
                rendered=[
                    "create_report(title)",
                    "schema=closed strict=true required=title",
                ],
                dedupe=True,
            )
            log_event(
                logger,
                logging.DEBUG,
                "tool.schema_compiled",
                rendered=[
                    "create_report(title)",
                    "schema=closed strict=true required=title",
                ],
                dedupe=True,
            )
    finally:
        clear_log_event_dedupe_cache()

    output = stream.getvalue()
    assert output.count("tool.schema_compiled") == 2


def test_client_tool_schema_summary_surfaces_closed_required_optional_and_enum() -> (
    None
):
    summary = summarize_client_tool_schema_for_log(
        "inspect_pdf_file",
        {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "string",
                    "enum": ["demo-board-pack"],
                },
                "max_pages": {"type": "integer"},
            },
            "required": ["file_id"],
            "additionalProperties": False,
        },
        strict_json_schema=True,
    )

    assert summary.signature == "inspect_pdf_file(file_id, max_pages?)"
    assert summary.schema_line == (
        "schema=closed strict=true required=file_id optional=max_pages?"
    )
    assert summary.enum_line == 'enums=file_id="demo-board-pack"'
    assert summary.schema_chars > 0


def test_client_tool_schema_summary_rejects_non_closed_object_schema() -> None:
    try:
        summarize_client_tool_schema_for_log(
            "bad_tool",
            {
                "type": "object",
                "properties": {},
            },
            strict_json_schema=True,
        )
    except ValueError as exc:
        assert "additionalProperties" in str(exc)
    else:
        raise AssertionError("Expected non-closed client schema to fail")


def test_agent_compile_log_renders_human_readable_tool_block() -> None:
    clear_log_event_dedupe_cache()
    tool_provider_bundle = {
        "root_tool_provider_id": "report-agent",
        "tool_providers": [
            {
                "tool_provider_id": "report-agent",
                "agent_name": "Report Agent",
                "instructions": "Manage reports and delegate specialist work.",
                "client_tools": [
                    {
                        "type": "function",
                        "name": "create_report",
                        "description": "Create a report.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                            },
                            "required": ["title"],
                            "additionalProperties": False,
                        },
                        "strict": True,
                    }
                ],
                "delegation_targets": [
                    {
                        "tool_provider_id": "chart-agent",
                        "tool_name": "delegate_to_chart_agent",
                        "description": "Delegate chart work.",
                    }
                ],
            },
            {
                "tool_provider_id": "chart-agent",
                "agent_name": "Chart Agent",
                "instructions": "Render charts.",
                "client_tools": [],
                "delegation_targets": [],
            },
        ],
    }
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
        tool_provider_bundle=tool_provider_bundle,
    )
    stream = StringIO()
    logger = logging.getLogger("report_foundry.agents.agent_builder")
    logger.handlers.clear()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_build_plain_formatter())
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    try:
        _build_agent_graph(
            context,
            tool_provider_bundle=tool_provider_bundle,
            model=None,
        )
    finally:
        clear_log_event_dedupe_cache()

    output = stream.getvalue()
    assert "agent.tool_provider_compiled" in output
    assert "\n > Report Agent(Chart Agent):" in output
    assert "\n > - name_current_thread(title)" in output
    assert "\n > - make_plan(" in output
    assert "\n > - create_report(title)" in output


def test_resolve_log_level_defaults_and_parses_names() -> None:
    assert resolve_log_level(None) == logging.INFO
    assert resolve_log_level("") == logging.INFO
    assert resolve_log_level("debug") == logging.DEBUG
    assert resolve_log_level("WARNING") == logging.WARNING
    assert resolve_log_level("not-a-level") == logging.INFO


def test_resolve_external_log_level_clamps_debug_to_info() -> None:
    assert resolve_external_log_level(logging.DEBUG) == logging.INFO
    assert resolve_external_log_level(logging.INFO) == logging.INFO
    assert resolve_external_log_level(logging.WARNING) == logging.WARNING


def test_resolve_openai_log_level_matches_app_level() -> None:
    assert resolve_openai_log_level(logging.DEBUG) == logging.DEBUG
    assert resolve_openai_log_level(logging.INFO) == logging.INFO
    assert resolve_openai_log_level(logging.WARNING) == logging.WARNING


def test_resolve_chatkit_log_level_matches_app_level() -> None:
    assert resolve_chatkit_log_level(logging.DEBUG) == logging.DEBUG
    assert resolve_chatkit_log_level(logging.INFO) == logging.INFO
    assert resolve_chatkit_log_level(logging.WARNING) == logging.WARNING


def test_resolve_pydantic_log_level_matches_app_level() -> None:
    assert resolve_pydantic_log_level(logging.DEBUG) == logging.DEBUG
    assert resolve_pydantic_log_level(logging.INFO) == logging.INFO
    assert resolve_pydantic_log_level(logging.WARNING) == logging.WARNING


def test_resolve_quiet_library_log_level_clamps_to_warning() -> None:
    assert resolve_quiet_library_log_level(logging.DEBUG) == logging.WARNING
    assert resolve_quiet_library_log_level(logging.INFO) == logging.WARNING
    assert resolve_quiet_library_log_level(logging.WARNING) == logging.WARNING
    assert resolve_quiet_library_log_level(logging.ERROR) == logging.ERROR


def test_resolve_sqlalchemy_log_level_clamps_to_warning() -> None:
    assert resolve_sqlalchemy_log_level(logging.DEBUG) == logging.WARNING
    assert resolve_sqlalchemy_log_level(logging.INFO) == logging.WARNING
    assert resolve_sqlalchemy_log_level(logging.WARNING) == logging.WARNING
    assert resolve_sqlalchemy_log_level(logging.ERROR) == logging.ERROR
