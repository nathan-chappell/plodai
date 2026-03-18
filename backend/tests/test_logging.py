import asyncio
import logging
from io import StringIO
from types import SimpleNamespace

from backend.app.agents.tools import _log_tool_end, _log_tool_start
from backend.app.chatkit.server import (
    ClientToolResultConverter,
    _summarize_client_tool_result_for_log,
)
from backend.app.core.logging import (
    EVENT_FIELDS_ATTR,
    EVENT_NAME_ATTR,
    _build_plain_formatter,
    get_logger,
    log_event,
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
        "respond.end",
        thread_id="thr_123",
        response_id="resp_456",
        output_tokens=42,
    )

    output = stream.getvalue()
    assert "respond.end" in output
    assert "\n > thread_id=thr_123" in output
    assert "\n > response_id=resp_456" in output
    assert "\n > output_tokens=42" in output


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
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_build_plain_formatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

    try:
        _log_tool_start(context, "run_aggregate_query", dataset_id="sales_csv")
        _log_tool_end(context, "run_aggregate_query", mode="client_tool_call")
    finally:
        logger.removeHandler(handler)

    captured = stream.getvalue()
    assert "tool.start" in captured
    assert "tool.end" in captured
    assert "report_id=rep_123" in captured
    assert "user_id=user_456" in captured
    assert "tool_name=run_aggregate_query" in captured
    assert "dataset_id=sales_csv" in captured


def test_client_tool_output_received_log_uses_summaries() -> None:
    openai_client = _StubOpenAIClient()
    converter = ClientToolResultConverter(openai_client, {})
    stream = StringIO()
    logger = logging.getLogger("report_foundry.chatkit.server")
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_build_plain_formatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
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
    assert "call_id=call_123" in captured
    assert "tool_name=render_chart_from_file" in captured
    assert "status=completed" in captured
    assert "result_keys=file_input,imageDataUrl,row_count,rows" in captured
    assert "row_count=3" in captured
    assert "rows=1" in captured
    assert "has_image=true" in captured
    assert "has_file_input=true" in captured
    assert "file_input_keys=file_data,filename" in captured
    assert "top-secret" not in captured
    assert "bGFrZS1kYXRh" not in captured


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


def test_get_logger_builds_namespaced_loggers() -> None:
    assert get_logger("").name == "report_foundry"
    assert get_logger("chatkit.server").name == "report_foundry.chatkit.server"
