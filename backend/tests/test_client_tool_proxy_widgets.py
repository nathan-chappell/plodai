import asyncio
import json
from types import SimpleNamespace

from agents.tool_context import ToolContext

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.tools import (
    _build_client_tool_proxy,
    build_agent_tools,
)


class _StubStore:
    async def load_thread_items(self, *args, **kwargs):
        del args, kwargs
        return SimpleNamespace(
            data=[SimpleNamespace(type="assistant_message", id="msg_123")]
        )


class _StubChatKitContext:
    def __init__(self) -> None:
        self.request_context = ReportAgentContext(
            report_id="report_123",
            user_id="user_123",
            user_email=None,
            db=None,
        )
        self.store = _StubStore()
        self.client_tool_call = None
        self.stream_events: list[object] = []
        self.widget_calls: list[tuple[object, str | None]] = []
        self.thread = SimpleNamespace(id="thread_123", metadata={})

    async def stream(self, event: object) -> None:
        self.stream_events.append(event)

    async def stream_widget(self, widget: object, copy_text: str | None = None) -> None:
        self.widget_calls.append((widget, copy_text))


def _collect_text_values(children: list[dict[str, object]]) -> list[str]:
    values: list[str] = []
    for child in children:
        value = child.get("value")
        if isinstance(value, str):
            values.append(value)
        nested_children = child.get("children")
        if isinstance(nested_children, list):
            values.extend(
                _collect_text_values(
                    [nested for nested in nested_children if isinstance(nested, dict)]
                )
            )
    return values


def test_client_tool_proxy_streams_widget_without_progress_event() -> None:
    tool = _build_client_tool_proxy(
        {
            "name": "list_datasets",
            "description": "List datasets.",
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
    text_values = _collect_text_values(widget["children"])
    assert "List Datasets(includeSamples=true)" in text_values
    assert copy_text == "List Datasets(includeSamples=true)"
    assert result == {
        "name": "list_datasets",
        "arguments": {"includeSamples": True},
    }


def test_client_tool_proxy_titles_create_csv_with_output_filename() -> None:
    tool = _build_client_tool_proxy(
        {
            "name": "create_dataset",
            "description": "Create a dataset.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string"},
                    "format": {"type": "string"},
                    "query_plan": {
                        "type": "object",
                        "properties": {
                            "dataset_id": {"type": "string"},
                        },
                        "required": ["dataset_id"],
                        "additionalProperties": False,
                    },
                },
                "required": ["filename", "format", "query_plan"],
                "additionalProperties": False,
            },
            "strict": True,
            "display": {
                "label": "Create Dataset",
                "prominent_args": ["filename", "format", "query_plan.dataset_id"],
                "arg_labels": {
                    "filename": "file",
                    "format": "format",
                    "query_plan.dataset_id": "dataset",
                },
            },
        }
    )
    chatkit_context = _StubChatKitContext()
    ctx = SimpleNamespace(context=chatkit_context)

    asyncio.run(
        tool.on_invoke_tool(
            ctx,
            json.dumps(
                {
                    "filename": "aggregated_sales_by_month_category.csv",
                    "format": "csv",
                    "query_plan": {
                        "dataset_id": "tour-sales-fixture",
                    },
                }
            ),
        )
    )

    widget, copy_text = chatkit_context.widget_calls[0]
    text_values = _collect_text_values(widget["children"])
    assert (
        "Create Dataset(file=aggregated_sales_by_month_category.csv, format=csv, dataset=tour-sales-fixture)"
        in text_values
    )
    assert copy_text == (
        "Create Dataset(file=aggregated_sales_by_month_category.csv, format=csv, dataset=tour-sales-fixture)"
    )


def test_feedback_get_feedback_tool_streams_widget_and_wait_state() -> None:
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
    )
    tool = next(
        compiled_tool
        for compiled_tool in build_agent_tools(
            context,
            agent_id="feedback-agent",
            client_tools=[],
        )
        if compiled_tool.name == "get_feedback"
    )
    chatkit_context = _StubChatKitContext()
    chatkit_context.request_context = context
    ctx = ToolContext(
        context=chatkit_context,
        tool_name="get_feedback",
        tool_call_id="call_123",
        tool_arguments=json.dumps(
            {
                "recommended_options": [
                    "The chart never appeared.",
                    "The explanation stopped too early.",
                    "The result was helpful overall.",
                ],
                "inferred_sentiment": "negative",
            }
        ),
    )

    result = asyncio.run(
        tool.on_invoke_tool(
            ctx,
            json.dumps(
                {
                    "recommended_options": [
                        "The chart never appeared.",
                        "The explanation stopped too early.",
                        "The result was helpful overall.",
                    ],
                    "inferred_sentiment": "negative",
                }
            ),
        )
    )

    assert result["status"] == "waiting_for_user"
    assert result["item_ids"] == ["msg_123"]
    assert context.thread_metadata["feedback_session"]["item_ids"] == ["msg_123"]
    assert context.thread_metadata["feedback_session"]["inferred_sentiment"] == "negative"
    assert len(chatkit_context.stream_events) == 1
    assert len(chatkit_context.widget_calls) == 1
    widget, copy_text = chatkit_context.widget_calls[0]
    assert widget["confirm"]["action"]["type"] == "submit_feedback_session"
    assert widget["cancel"]["action"]["type"] == "cancel_feedback_session"
    assert copy_text == "Feedback form for msg_123."


def test_document_agent_uses_client_proxy_tools_without_server_pdf_hosting() -> None:
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
    )
    tools = build_agent_tools(
        context,
        agent_id="document-agent",
        client_tools=[
            {
                "name": "inspect_document_file",
                "description": "Inspect a document in the browser.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "file_id": {"type": "string"},
                    },
                    "required": ["file_id"],
                    "additionalProperties": False,
                },
                "strict": True,
            }
        ],
    )

    assert [tool.name for tool in tools] == [
        "name_current_thread",
        "make_plan",
        "inspect_document_file",
    ]
