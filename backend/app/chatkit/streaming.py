from __future__ import annotations

from collections.abc import AsyncIterator

from agents.result import RunResultStreaming
from chatkit.agents import AgentContext, stream_agent_response as sdk_stream_agent_response
from chatkit.store import NotFoundError
from chatkit.types import ThreadItemDoneEvent, ThreadStreamEvent, WorkflowItem

from backend.app.chatkit.metadata import active_plan_execution


async def _restore_plan_workflow_item[TContext](
    context: AgentContext[TContext],
) -> None:
    execution = active_plan_execution(context.request_context.thread_metadata)
    if execution is None:
        return
    if (
        context.workflow_item is not None
        and context.workflow_item.id == execution["workflow_item_id"]
    ):
        return

    try:
        item = await context.store.load_item(
            context.thread.id,
            execution["workflow_item_id"],
            context.request_context,
        )
    except NotFoundError:
        return

    if isinstance(item, WorkflowItem):
        context.workflow_item = item


async def stream_agent_response_with_plan_workflow[TContext](
    context: AgentContext[TContext],
    result: RunResultStreaming,
) -> AsyncIterator[ThreadStreamEvent]:
    await _restore_plan_workflow_item(context)

    async for event in sdk_stream_agent_response(context, result):
        execution = active_plan_execution(context.request_context.thread_metadata)
        if (
            execution is not None
            and isinstance(event, ThreadItemDoneEvent)
            and isinstance(event.item, WorkflowItem)
            and event.item.id == execution["workflow_item_id"]
        ):
            restored_item = event.item.model_copy(deep=True)
            restored_item.workflow.summary = None
            restored_item.workflow.expanded = False
            context.workflow_item = restored_item
            continue

        yield event
