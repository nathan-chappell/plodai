import asyncio
import json
from types import SimpleNamespace

from agents.tool_context import ToolContext

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.tools import (
    DEMO_VALIDATOR_CAPABILITY_ID,
    DEMO_VALIDATOR_COST_SNAPSHOT_METADATA_KEY,
    DEMO_VALIDATOR_COST_SNAPSHOT_PROGRESS_PREFIX,
    _build_client_tool_proxy,
    build_agent_tools,
)


class _StubChatKitContext:
    def __init__(self) -> None:
        self.request_context = ReportAgentContext(
            report_id="report_123",
            user_id="user_123",
            user_email=None,
            db=None,
        )
        self.client_tool_call = None
        self.stream_events: list[object] = []
        self.widget_calls: list[tuple[object, str | None]] = []
        self.thread = SimpleNamespace(id="thread_123", metadata={})

    async def stream(self, event: object) -> None:
        self.stream_events.append(event)

    async def stream_widget(self, widget: object, copy_text: str | None = None) -> None:
        self.widget_calls.append((widget, copy_text))


def test_client_tool_proxy_streams_widget_without_progress_event() -> None:
    tool = _build_client_tool_proxy(
        {
            "name": "list_csv_files",
            "description": "List CSV files.",
            "parameters": {
                "type": "object",
                "properties": {
                    "includeSamples": {
                        "type": "boolean",
                    }
                },
                "additionalProperties": False,
            },
            "strict": True,
        }
    )
    chatkit_context = _StubChatKitContext()
    ctx = SimpleNamespace(context=chatkit_context)

    result = asyncio.run(tool.on_invoke_tool(ctx, json.dumps({"includeSamples": True})))

    assert chatkit_context.stream_events == []
    assert len(chatkit_context.widget_calls) == 1
    widget, copy_text = chatkit_context.widget_calls[0]
    assert widget["type"] == "Card"
    assert "status" not in widget
    assert copy_text == (
        "List Csv Files\n"
        "Queued a CSV workspace listing with samples."
    )
    assert result == {
        "name": "list_csv_files",
        "arguments": {"includeSamples": True},
    }


def test_demo_validator_cost_tool_returns_pre_turn_usage_snapshot() -> None:
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
        thread_metadata={
            "usage": {
                "input_tokens": 120,
                "output_tokens": 30,
                "cost_usd": 0.00123456,
            }
        },
    )
    tool = build_agent_tools(
        context,
        capability_id=DEMO_VALIDATOR_CAPABILITY_ID,
        client_tools=[],
    )[0]
    chatkit_context = _StubChatKitContext()
    chatkit_context.request_context = context
    ctx = ToolContext(
        context=chatkit_context,
        tool_name="get_current_thread_cost",
        tool_call_id="call_123",
        tool_arguments="{}",
    )

    result = asyncio.run(tool.on_invoke_tool(ctx, "{}"))

    assert result == {
        "thread_id": "thread_123",
        "scope": "before_current_turn",
        "usage": {
            "input_tokens": 120,
            "output_tokens": 30,
            "cost_usd": 0.00123456,
        },
    }
    assert chatkit_context.thread.metadata[
        DEMO_VALIDATOR_COST_SNAPSHOT_METADATA_KEY
    ] == result
    assert context.thread_metadata[DEMO_VALIDATOR_COST_SNAPSHOT_METADATA_KEY] == result
    assert len(chatkit_context.stream_events) == 1
    assert chatkit_context.stream_events[0].text == (
        f"{DEMO_VALIDATOR_COST_SNAPSHOT_PROGRESS_PREFIX}"
        '{"thread_id": "thread_123", "scope": "before_current_turn", "usage": {"input_tokens": 120, "output_tokens": 30, "cost_usd": 0.00123456}}'
    )


def test_demo_validator_cost_tool_defaults_to_zero_usage_when_missing() -> None:
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
    )
    tool = build_agent_tools(
        context,
        capability_id=DEMO_VALIDATOR_CAPABILITY_ID,
        client_tools=[],
    )[0]
    chatkit_context = _StubChatKitContext()
    chatkit_context.request_context = context
    ctx = ToolContext(
        context=chatkit_context,
        tool_name="get_current_thread_cost",
        tool_call_id="call_123",
        tool_arguments="{}",
    )

    result = asyncio.run(tool.on_invoke_tool(ctx, "{}"))

    assert result == {
        "thread_id": "thread_123",
        "scope": "before_current_turn",
        "usage": {
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd": 0.0,
        },
    }
