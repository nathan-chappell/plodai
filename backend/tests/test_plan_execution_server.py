import asyncio
import logging
from datetime import UTC, datetime
from types import MethodType, SimpleNamespace

from chatkit.types import (
    CustomTask,
    ProgressUpdateEvent,
    ThreadItemDoneEvent,
    ThreadMetadata,
    Workflow,
    WorkflowItem,
)

import backend.app.chatkit.server as server_module
from backend.app.agents.context import ReportAgentContext
from backend.app.chatkit.metadata import active_plan_execution, parse_chat_metadata
from backend.app.chatkit.server import ClientWorkspaceChatKitServer, PlanStepJudgeResult


class _StubThreadItemsPage(SimpleNamespace):
    data: list[object]
    after: str | None
    has_more: bool


class _StubStore:
    def __init__(
        self,
        *,
        items: list[object] | None = None,
        workflow_item: WorkflowItem | None = None,
    ) -> None:
        self.items = list(
            items
            or [SimpleNamespace(id="assistant_prev", type="assistant_message")]
        )
        self.workflow_item = workflow_item

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: object,
    ) -> _StubThreadItemsPage:
        del thread_id, context
        items = list(self.items)
        if after is not None:
            try:
                after_index = next(
                    index
                    for index, item in enumerate(items)
                    if getattr(item, "id", None) == after
                )
            except StopIteration:
                filtered = items
            else:
                filtered = items[after_index + 1 :]
        else:
            filtered = items
        if order == "desc":
            filtered = list(reversed(filtered))
        selected = filtered[:limit]
        return _StubThreadItemsPage(
            data=selected,
            after=selected[-1].id if selected else None,
            has_more=False,
        )

    async def load_item(self, thread_id: str, item_id: str, context: object):
        del thread_id, context
        if self.workflow_item is not None and self.workflow_item.id == item_id:
            return self.workflow_item
        raise RuntimeError("Workflow item not found.")

    def generate_item_id(self, item_type: str, thread: object, context: object) -> str:
        del thread, context
        return f"{item_type}_generated"

    def generate_thread_id(self, context: object) -> str:
        del context
        return "thread_generated"


class _StubConverter:
    async def to_agent_input(self, pending_items: list[object]):
        del pending_items
        return []


class _FakeRunResult:
    def __init__(self, *, response_id: str, conversation_id: str) -> None:
        self.last_response_id = response_id
        self.conversation_id = conversation_id
        self.context_wrapper = SimpleNamespace(usage=None)


async def _collect_events(async_iterator):
    return [event async for event in async_iterator]


def _agent_bundle() -> dict[str, object]:
    return {
        "root_agent_id": "report-agent",
        "agents": [
            {
                "agent_id": "report-agent",
                "agent_name": "Report",
                "instructions": "Execute the plan.",
                "client_tools": [],
                "delegation_targets": [],
            }
        ],
    }


def _plan_metadata() -> dict[str, object]:
    return {
        "openai_conversation_id": "conv_123",
        "plan": {
            "id": "plan_123",
            "focus": "Analyze the workspace data",
            "planned_steps": ["Run the analysis"],
            "success_criteria": ["Finish the analysis"],
            "execution_hints": [
                {
                    "done_when": "The analysis has actually been completed.",
                    "preferred_tool_names": ["run_aggregate_query"],
                }
            ],
        },
        "plan_execution": {
            "plan_id": "plan_123",
            "status": "active",
            "workflow_item_id": "workflow_plan",
            "current_step_index": 0,
            "attempts_by_step": [0],
            "step_notes": [None],
            "step_started_after_item_id": "item_before_step",
        },
    }


def _workflow_item() -> WorkflowItem:
    return WorkflowItem(
        id="workflow_plan",
        thread_id="thread_123",
        created_at=datetime.now(UTC),
        workflow=Workflow(
            type="custom",
            tasks=[
                CustomTask(
                    title="1. Run the analysis",
                    status_indicator="loading",
                )
            ],
        ),
    )


def _thread(metadata: dict[str, object]) -> ThreadMetadata:
    return ThreadMetadata(
        id="thread_123",
        title="Plan thread",
        created_at=datetime.now(UTC),
        status={"type": "active"},
        metadata=metadata,
    )


def _context(metadata: dict[str, object]) -> ReportAgentContext:
    parsed_metadata = parse_chat_metadata(metadata)
    return ReportAgentContext(
        report_id="thread_123",
        user_id="user_123",
        user_email=None,
        db=None,
        request_metadata=dict(parsed_metadata),
        thread_metadata=dict(parsed_metadata),
        agent_bundle=_agent_bundle(),
    )


def _server(store: _StubStore) -> ClientWorkspaceChatKitServer:
    server = object.__new__(ClientWorkspaceChatKitServer)
    server.settings = SimpleNamespace(openai_max_retries=0)
    server.db = None
    server.openai_client = SimpleNamespace()
    server._uploaded_file_ids = {}
    server.store = store
    server.converter = _StubConverter()
    server.logger = logging.getLogger("report_foundry.tests.plan_execution_server")
    return server


def _patch_server_runtime(
    monkeypatch,
    *,
    run_inputs: list[object],
    set_client_tool_call: bool = False,
) -> None:
    monkeypatch.setattr(
        server_module,
        "resolve_thread_runtime_state",
        lambda thread, context: SimpleNamespace(
            metadata=parse_chat_metadata(thread.metadata)
        ),
    )
    monkeypatch.setattr(
        server_module,
        "build_registered_agent",
        lambda context, model=None: SimpleNamespace(name="Fake Agent", model=model),
    )
    monkeypatch.setattr(server_module, "accumulate_usage", lambda current, usage, *, model: current)
    monkeypatch.setattr(server_module, "calculate_usage_cost_usd", lambda model, usage: 0.0)

    async def _noop_record_cost_event(**kwargs):
        del kwargs
        return None

    monkeypatch.setattr(
        server_module.CreditService,
        "record_cost_event",
        _noop_record_cost_event,
    )

    response_counter = {"value": 0}

    def _run_streamed(agent, agent_input, **kwargs):
        del agent, kwargs
        run_inputs.append(agent_input)
        response_counter["value"] += 1
        return _FakeRunResult(
            response_id=f"resp_{response_counter['value']}",
            conversation_id="conv_123",
        )

    monkeypatch.setattr(server_module.Runner, "run_streamed", _run_streamed)

    async def _fake_stream(agent_context, result):
        del result
        if set_client_tool_call:
            agent_context.client_tool_call = SimpleNamespace(name="list_datasets")
        if False:
            yield None

    monkeypatch.setattr(
        server_module,
        "stream_agent_response_with_plan_workflow",
        _fake_stream,
    )


def test_plan_execution_respond_completes_on_first_judge(monkeypatch) -> None:
    metadata = _plan_metadata()
    thread = _thread(metadata)
    context = _context(metadata)
    store = _StubStore(workflow_item=_workflow_item())
    server = _server(store)
    run_inputs: list[object] = []
    _patch_server_runtime(monkeypatch, run_inputs=run_inputs)

    async def _judge(self, **kwargs):
        del self, kwargs
        return PlanStepJudgeResult(
            complete=True,
            explanation="The analysis is complete.",
        )

    server._judge_plan_step = MethodType(_judge, server)

    events = asyncio.run(_collect_events(server.respond(thread, None, context)))
    progress_texts = [
        event.text for event in events if isinstance(event, ProgressUpdateEvent)
    ]

    assert run_inputs == [[]]
    assert "plan_execution" not in thread.metadata
    assert "plan_execution" not in context.thread_metadata
    assert progress_texts == ["Plan execution finished."]
    assert "Note: The analysis is complete." in store.workflow_item.workflow.tasks[0].content
    assert any(
        isinstance(event, ThreadItemDoneEvent) and event.item.type == "workflow"
        for event in events
    )


def test_plan_execution_respond_retries_then_completes(monkeypatch) -> None:
    metadata = _plan_metadata()
    thread = _thread(metadata)
    context = _context(metadata)
    store = _StubStore(workflow_item=_workflow_item())
    server = _server(store)
    run_inputs: list[object] = []
    _patch_server_runtime(monkeypatch, run_inputs=run_inputs)
    judge_results = iter(
        [
            PlanStepJudgeResult(
                complete=False,
                explanation="The step is not done yet.",
            ),
            PlanStepJudgeResult(
                complete=True,
                explanation="The retry completed the analysis.",
            ),
        ]
    )

    async def _judge(self, **kwargs):
        del self, kwargs
        return next(judge_results)

    server._judge_plan_step = MethodType(_judge, server)

    events = asyncio.run(_collect_events(server.respond(thread, None, context)))
    progress_texts = [
        event.text for event in events if isinstance(event, ProgressUpdateEvent)
    ]

    assert run_inputs[0] == []
    assert isinstance(run_inputs[1], str)
    assert "Judge feedback from the previous attempt: The step is not done yet." in run_inputs[1]
    assert len(run_inputs) == 2
    assert "plan_execution" not in thread.metadata
    assert progress_texts == [
        "Retrying step 1/1.",
        "Plan execution finished.",
    ]
    assert "Note: The retry completed the analysis." in store.workflow_item.workflow.tasks[0].content


def test_plan_execution_respond_advances_after_failed_retry(monkeypatch) -> None:
    metadata = _plan_metadata()
    thread = _thread(metadata)
    context = _context(metadata)
    store = _StubStore(workflow_item=_workflow_item())
    server = _server(store)
    run_inputs: list[object] = []
    _patch_server_runtime(monkeypatch, run_inputs=run_inputs)
    judge_results = iter(
        [
            PlanStepJudgeResult(
                complete=False,
                explanation="The step is not done yet.",
            ),
            PlanStepJudgeResult(
                complete=False,
                explanation="The step is still not done after retry.",
            ),
        ]
    )

    async def _judge(self, **kwargs):
        del self, kwargs
        return next(judge_results)

    server._judge_plan_step = MethodType(_judge, server)

    events = asyncio.run(_collect_events(server.respond(thread, None, context)))
    progress_texts = [
        event.text for event in events if isinstance(event, ProgressUpdateEvent)
    ]

    assert len(run_inputs) == 2
    assert "plan_execution" not in thread.metadata
    assert progress_texts == [
        "Retrying step 1/1.",
        "Plan execution finished after the final step advanced.",
    ]
    assert (
        "Note: The step is still not done after retry."
        in store.workflow_item.workflow.tasks[0].content
    )


def test_plan_execution_waits_for_client_tool_output_before_judging(
    monkeypatch,
) -> None:
    metadata = _plan_metadata()
    thread = _thread(metadata)
    context = _context(metadata)
    store = _StubStore(workflow_item=_workflow_item())
    server = _server(store)
    run_inputs: list[object] = []
    _patch_server_runtime(
        monkeypatch,
        run_inputs=run_inputs,
        set_client_tool_call=True,
    )
    judge_call_count = {"value": 0}

    async def _judge(self, **kwargs):
        del self, kwargs
        judge_call_count["value"] += 1
        return PlanStepJudgeResult(
            complete=True,
            explanation="This should not be used.",
        )

    server._judge_plan_step = MethodType(_judge, server)

    events = asyncio.run(_collect_events(server.respond(thread, None, context)))

    assert run_inputs == [[]]
    assert judge_call_count["value"] == 0
    assert active_plan_execution(thread.metadata) is not None
    assert events == []


class _StatusCodeError(Exception):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"status={status_code}")
        self.status_code = status_code


def test_should_retry_exception_skips_non_retryable_4xx() -> None:
    server = object.__new__(ClientWorkspaceChatKitServer)

    assert (
        ClientWorkspaceChatKitServer._should_retry_exception(
            server,
            _StatusCodeError(400),
        )
        is False
    )
    assert (
        ClientWorkspaceChatKitServer._should_retry_exception(
            server,
            _StatusCodeError(422),
        )
        is False
    )


def test_should_retry_exception_keeps_retryable_status_codes() -> None:
    server = object.__new__(ClientWorkspaceChatKitServer)

    assert (
        ClientWorkspaceChatKitServer._should_retry_exception(
            server,
            _StatusCodeError(429),
        )
        is True
    )
    assert (
        ClientWorkspaceChatKitServer._should_retry_exception(
            server,
            _StatusCodeError(500),
        )
        is True
    )
    assert (
        ClientWorkspaceChatKitServer._should_retry_exception(
            server,
            RuntimeError("network jitter"),
        )
        is True
    )
