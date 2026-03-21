import asyncio
import json
from datetime import UTC, datetime
from types import SimpleNamespace

from agents.tool_context import ToolContext
from chatkit.types import (
    CustomSummary,
    HiddenContextItem,
    ProgressUpdateEvent,
    ThreadItemDoneEvent,
    Workflow,
    WorkflowItem,
)

import backend.app.chatkit.streaming as streaming_module
from backend.app.agents.context import ReportAgentContext
from backend.app.agents.tools import build_agent_tools
from backend.app.chatkit.metadata import active_plan_execution, parse_thread_metadata
from backend.app.chatkit.streaming import stream_agent_response_with_plan_workflow


class _StubPlanStore:
    def __init__(self, latest_item_id: str | None = "item_before_plan") -> None:
        self.latest_item_id = latest_item_id

    async def load_thread_items(self, *args, **kwargs):
        del args, kwargs
        data = []
        if self.latest_item_id is not None:
            data.append(SimpleNamespace(id=self.latest_item_id))
        return SimpleNamespace(data=data)


class _StubPlanChatKitContext:
    def __init__(
        self,
        request_context: ReportAgentContext,
        *,
        workflow_item: WorkflowItem | None = None,
    ) -> None:
        self.request_context = request_context
        self.store = _StubPlanStore()
        self.thread = SimpleNamespace(id="thread_123", metadata={})
        self.workflow_item = workflow_item
        self.stream_events: list[object] = []
        self.widget_calls: list[tuple[object, str | None]] = []
        self.started_workflows: list[Workflow] = []
        self.ended_workflows: list[tuple[object | None, bool]] = []
        self._workflow_counter = 0

    async def start_workflow(self, workflow: Workflow) -> None:
        self._workflow_counter += 1
        self.started_workflows.append(workflow)
        self.workflow_item = WorkflowItem(
            id=f"workflow_{self._workflow_counter}",
            thread_id=self.thread.id,
            created_at=datetime.now(UTC),
            workflow=workflow,
        )

    async def end_workflow(
        self,
        summary: object | None = None,
        expanded: bool = False,
    ) -> None:
        self.ended_workflows.append((summary, expanded))
        self.workflow_item = None

    async def stream(self, event: object) -> None:
        self.stream_events.append(event)

    async def stream_widget(self, widget: object, copy_text: str | None = None) -> None:
        self.widget_calls.append((widget, copy_text))


class _StubWorkflowStore:
    def __init__(self, workflow_item: WorkflowItem) -> None:
        self.workflow_item = workflow_item
        self.load_item_calls: list[tuple[str, str]] = []

    async def load_item(self, thread_id: str, item_id: str, context: object):
        del context
        self.load_item_calls.append((thread_id, item_id))
        return self.workflow_item


async def _collect_events(async_iterator):
    return [event async for event in async_iterator]


def _make_make_plan_tool():
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
    )
    return context, next(
        compiled_tool
        for compiled_tool in build_agent_tools(
            context,
            agent_id="report-agent",
            client_tools=[],
        )
        if compiled_tool.name == "make_plan"
    )


def test_parse_thread_metadata_keeps_plan_execution_and_execution_hints() -> None:
    metadata = parse_thread_metadata(
        {
            "plan": {
                "id": "plan_123",
                "focus": "Investigate the revenue drop",
                "planned_steps": ["Inspect the dataset", "Run the aggregate query"],
                "success_criteria": ["Explain the strongest variance"],
                "execution_hints": [
                    {
                        "done_when": "The dataset inventory has been reviewed.",
                        "preferred_tool_names": ["list_datasets"],
                    },
                    {
                        "done_when": "The grouped totals are available.",
                        "preferred_tool_names": ["run_aggregate_query"],
                        "preferred_handoff_tool_names": ["delegate_to_chart_agent"],
                    },
                ],
            },
            "plan_execution": {
                "plan_id": "plan_123",
                "status": "active",
                "workflow_item_id": "workflow_123",
                "current_step_index": 0,
                "attempts_by_step": [0, 0],
                "step_notes": [None, None],
                "step_started_after_item_id": "item_123",
            },
        }
    )

    assert metadata["plan"]["execution_hints"][0] == {
        "done_when": "The dataset inventory has been reviewed.",
        "preferred_tool_names": ["list_datasets"],
    }
    assert metadata["plan"]["execution_hints"][1] == {
        "done_when": "The grouped totals are available.",
        "preferred_tool_names": ["run_aggregate_query"],
        "preferred_handoff_tool_names": ["delegate_to_chart_agent"],
    }
    assert active_plan_execution(metadata) == {
        "plan_id": "plan_123",
        "status": "active",
        "workflow_item_id": "workflow_123",
        "current_step_index": 0,
        "attempts_by_step": [0, 0],
        "step_notes": [None, None],
        "step_started_after_item_id": "item_123",
    }


def test_parse_thread_metadata_rejects_extra_fields_in_plan_execution_shapes() -> None:
    invalid_execution_metadata = parse_thread_metadata(
        {
            "plan_execution": {
                "plan_id": "plan_123",
                "status": "active",
                "workflow_item_id": "workflow_123",
                "current_step_index": 0,
                "attempts_by_step": [0],
                "step_notes": [None],
                "unexpected": "nope",
            }
        }
    )
    invalid_hint_metadata = parse_thread_metadata(
        {
            "plan": {
                "id": "plan_123",
                "focus": "Investigate the revenue drop",
                "planned_steps": ["Inspect the dataset"],
                "execution_hints": [
                    {
                        "done_when": "The dataset inventory has been reviewed.",
                        "unexpected": "nope",
                    }
                ],
            }
        }
    )

    assert "plan_execution" not in invalid_execution_metadata
    assert "plan" not in invalid_hint_metadata


def test_make_plan_tool_starts_workflow_and_persists_execution_state() -> None:
    request_context, tool = _make_make_plan_tool()
    chatkit_context = _StubPlanChatKitContext(request_context)
    ctx = ToolContext(
        context=chatkit_context,
        tool_name="make_plan",
        tool_call_id="call_123",
        tool_arguments=json.dumps(
            {
                "focus": "Investigate the revenue drop",
                "planned_steps": ["Inspect the dataset", "Run the aggregate query"],
                "success_criteria": ["Explain the strongest variance"],
                "execution_hints": [
                    {
                        "done_when": "The dataset inventory has been reviewed.",
                        "preferred_tool_names": ["list_datasets"],
                    },
                    {
                        "done_when": "The grouped totals are available.",
                        "preferred_tool_names": ["run_aggregate_query"],
                    },
                ],
            }
        ),
    )

    result = asyncio.run(
        tool.on_invoke_tool(
            ctx,
            json.dumps(
                {
                    "focus": "Investigate the revenue drop",
                    "planned_steps": ["Inspect the dataset", "Run the aggregate query"],
                    "success_criteria": ["Explain the strongest variance"],
                    "execution_hints": [
                        {
                            "done_when": "The dataset inventory has been reviewed.",
                            "preferred_tool_names": ["list_datasets"],
                        },
                        {
                            "done_when": "The grouped totals are available.",
                            "preferred_tool_names": ["run_aggregate_query"],
                        },
                    ],
                }
            ),
        )
    )

    assert chatkit_context.widget_calls == []
    assert len(chatkit_context.started_workflows) == 1
    workflow = chatkit_context.started_workflows[0]
    assert workflow.tasks[0].status_indicator == "loading"
    assert workflow.tasks[1].status_indicator == "none"
    assert workflow.tasks[0].content == (
        "Done when: The dataset inventory has been reviewed.\n"
        "Preferred tools: list_datasets"
    )
    assert result["plan_execution"]["status"] == "active"
    assert result["plan_execution"]["workflow_item_id"] == "workflow_1"
    assert request_context.thread_metadata["plan_execution"]["step_started_after_item_id"] == (
        "item_before_plan"
    )
    assert chatkit_context.thread.metadata["plan_execution"]["workflow_item_id"] == (
        "workflow_1"
    )
    assert len(chatkit_context.stream_events) == 1
    assert isinstance(chatkit_context.stream_events[0], ProgressUpdateEvent)
    assert "Execution workflow started" in chatkit_context.stream_events[0].text


def test_make_plan_tool_replaces_active_workflow_execution() -> None:
    request_context, tool = _make_make_plan_tool()
    request_context.thread_metadata["plan_execution"] = {
        "plan_id": "plan_old",
        "status": "active",
        "workflow_item_id": "workflow_old",
        "current_step_index": 0,
        "attempts_by_step": [0],
        "step_notes": [None],
    }
    chatkit_context = _StubPlanChatKitContext(
        request_context,
        workflow_item=WorkflowItem(
            id="workflow_old",
            thread_id="thread_123",
            created_at=datetime.now(UTC),
            workflow=Workflow(type="custom", tasks=[]),
        ),
    )
    ctx = ToolContext(
        context=chatkit_context,
        tool_name="make_plan",
        tool_call_id="call_456",
        tool_arguments=json.dumps(
            {
                "focus": "Investigate the revenue drop",
                "planned_steps": ["Inspect the dataset"],
            }
        ),
    )

    result = asyncio.run(
        tool.on_invoke_tool(
            ctx,
            json.dumps(
                {
                    "focus": "Investigate the revenue drop",
                    "planned_steps": ["Inspect the dataset"],
                }
            ),
        )
    )

    assert chatkit_context.ended_workflows == [(None, False)]
    assert result["plan_execution"]["workflow_item_id"] == "workflow_1"
    assert request_context.thread_metadata["plan_execution"]["workflow_item_id"] == (
        "workflow_1"
    )


def test_stream_wrapper_keeps_active_plan_workflow_open(monkeypatch) -> None:
    stored_workflow_item = WorkflowItem(
        id="workflow_plan",
        thread_id="thread_123",
        created_at=datetime.now(UTC),
        workflow=Workflow(type="custom", tasks=[]),
    )
    store = _StubWorkflowStore(stored_workflow_item)
    context = SimpleNamespace(
        request_context=SimpleNamespace(
            thread_metadata={
                "plan_execution": {
                    "plan_id": "plan_123",
                    "status": "active",
                    "workflow_item_id": "workflow_plan",
                    "current_step_index": 0,
                    "attempts_by_step": [0],
                    "step_notes": [None],
                }
            }
        ),
        workflow_item=None,
        store=store,
        thread=SimpleNamespace(id="thread_123"),
    )

    async def _fake_stream(ctx, result):
        del ctx, result
        workflow_done_item = stored_workflow_item.model_copy(deep=True)
        workflow_done_item.workflow.summary = CustomSummary(
            title="Finished",
            icon="check-circle",
        )
        workflow_done_item.workflow.expanded = True
        yield ThreadItemDoneEvent(item=workflow_done_item)
        yield ThreadItemDoneEvent(
            item=HiddenContextItem(
                id="hidden_123",
                thread_id="thread_123",
                created_at=datetime.now(UTC),
                content={"kind": "plan_handoff"},
            )
        )

    monkeypatch.setattr(streaming_module, "sdk_stream_agent_response", _fake_stream)

    events = asyncio.run(
        _collect_events(
            stream_agent_response_with_plan_workflow(context, SimpleNamespace())
        )
    )

    assert store.load_item_calls == [("thread_123", "workflow_plan")]
    assert len(events) == 1
    assert isinstance(events[0], ThreadItemDoneEvent)
    assert events[0].item.type == "hidden_context_item"
    assert context.workflow_item is not None
    assert context.workflow_item.id == "workflow_plan"
    assert context.workflow_item.workflow.summary is None
    assert context.workflow_item.workflow.expanded is False
