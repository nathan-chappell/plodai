from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import AsyncIterator, Mapping, Sequence
from datetime import datetime
from typing import Any, cast

from agents import (
    InputGuardrailTripwireTriggered,
    OutputGuardrailTripwireTriggered,
    RunResultStreaming,
)
from chatkit.agents import (
    AgentContext,
    ResponseStreamConverter,
    StreamingThoughtTracker,
    _AsyncQueueIterator,
    _DEFAULT_RESPONSE_STREAM_CONVERTER,
    _EventWrapper,
    _convert_annotation,
    _convert_content,
    _merge_generators,
)
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageContentPartAdded,
    AssistantMessageContentPartAnnotationAdded,
    AssistantMessageContentPartDone,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    ClientToolCallItem,
    DurationSummary,
    GeneratedImage,
    GeneratedImageItem,
    GeneratedImageUpdated,
    ProgressUpdateEvent,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemRemovedEvent,
    ThreadItemUpdatedEvent,
    ThreadStreamEvent,
    ThoughtTask,
    Workflow,
    WorkflowItem,
    WorkflowTaskAdded,
    WorkflowTaskUpdated,
)

TOOL_PROGRESS_TEXT_LIMIT = 48
TOOL_PROGRESS_ARG_LIMIT = 2


def format_tool_call_progress_summary(name: str, arguments: object | None = None) -> str:
    normalized_name = name.strip() if isinstance(name, str) else ""
    if not normalized_name:
        return "tool_call(...)"

    parsed_arguments = _coerce_mapping(arguments)
    if normalized_name == "get_farm_record":
        return "get_farm_record()"
    if normalized_name == "name_current_thread":
        if parsed_arguments is None:
            return "name_current_thread()"
        title = _normalize_text(parsed_arguments.get("title"))
        if title is None:
            return "name_current_thread(...)"
        return f'name_current_thread("{_truncate_text(title)}")'
    if normalized_name == "save_farm_record":
        return _format_save_farm_record_summary(parsed_arguments)

    if parsed_arguments is None:
        return f"{normalized_name}()"
    argument_parts = _compact_argument_parts(parsed_arguments)
    if argument_parts:
        return f"{normalized_name}({', '.join(argument_parts)})"
    return f"{normalized_name}(...)"


def format_tool_search_progress_summary(arguments: object | None = None) -> str:
    query = _extract_search_query(arguments)
    if query is None:
        return "web_search(...)"
    return f'web_search("{_truncate_text(query)}")'


def _format_save_farm_record_summary(arguments: Mapping[str, object] | None) -> str:
    if arguments is None:
        return "save_farm_record()"

    record = _coerce_mapping(arguments.get("record"))
    if record is None:
        return "save_farm_record(...)"

    parts: list[str] = []
    farm_name = _normalize_text(record.get("farm_name"))
    if farm_name is not None:
        parts.append(f'farm_name="{_truncate_text(farm_name)}"')

    crops = record.get("crops")
    if isinstance(crops, Sequence) and not isinstance(crops, str | bytes | bytearray):
        parts.append(f"crops={len(crops)}")

    orders = record.get("orders")
    if isinstance(orders, Sequence) and not isinstance(orders, str | bytes | bytearray):
        parts.append(f"orders={len(orders)}")

    if parts:
        return f"save_farm_record({', '.join(parts)})"
    return "save_farm_record(...)"


def _compact_argument_parts(arguments: Mapping[str, object]) -> list[str]:
    parts: list[str] = []
    for key, value in arguments.items():
        if len(parts) >= TOOL_PROGRESS_ARG_LIMIT:
            break
        if not isinstance(key, str) or not key.strip():
            continue
        rendered = _render_primitive_argument(value)
        if rendered is None:
            continue
        parts.append(f"{key.strip()}={rendered}")
    return parts


def _render_primitive_argument(value: object) -> str | None:
    if isinstance(value, str):
        normalized = _normalize_text(value)
        if normalized is None:
            return None
        return f'"{_truncate_text(normalized)}"'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    return None


def _normalize_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split())
    return normalized or None


def _truncate_text(value: str, *, limit: int = TOOL_PROGRESS_TEXT_LIMIT) -> str:
    if len(value) <= limit:
        return value
    return f"{value[: limit - 3]}..."


def _coerce_mapping(value: object) -> dict[str, object] | None:
    if value is None:
        return None
    if isinstance(value, Mapping):
        return {
            str(key): cast(object, mapping_value)
            for key, mapping_value in value.items()
            if isinstance(key, str)
        }
    if hasattr(value, "model_dump"):
        dumped = value.model_dump(exclude_unset=True)
        return _coerce_mapping(dumped)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return _coerce_mapping(parsed)
    return None


def _extract_search_query(value: object) -> str | None:
    return _extract_search_query_inner(value, depth=0)


def _extract_search_query_inner(value: object, *, depth: int) -> str | None:
    if depth > 3:
        return None

    if isinstance(value, str):
        normalized = _normalize_text(value)
        if normalized is not None and depth > 0:
            return normalized
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return _extract_search_query_inner(parsed, depth=depth + 1)

    if hasattr(value, "model_dump"):
        dumped = value.model_dump(exclude_unset=True)
        return _extract_search_query_inner(dumped, depth=depth + 1)

    if isinstance(value, Mapping):
        for key in ("query", "q", "pattern"):
            candidate = value.get(key)
            normalized = _normalize_text(candidate)
            if normalized is not None:
                return normalized
        for key in ("search_query", "action", "queries", "items", "tool_input"):
            candidate = value.get(key)
            query = _extract_search_query_inner(candidate, depth=depth + 1)
            if query is not None:
                return query
        for candidate in value.values():
            query = _extract_search_query_inner(candidate, depth=depth + 1)
            if query is not None:
                return query
        return None

    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        for candidate in value:
            query = _extract_search_query_inner(candidate, depth=depth + 1)
            if query is not None:
                return query
    return None


def _get_mapping_or_attr(value: object, key: str) -> object | None:
    if isinstance(value, Mapping):
        return value.get(key)
    return getattr(value, key, None)


def _tool_search_key(raw_item: object) -> str | None:
    for key in ("call_id", "id"):
        value = _get_mapping_or_attr(raw_item, key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _build_tool_progress_event(
    item: object,
    *,
    search_summaries: dict[str, str],
    event_name: str,
) -> ProgressUpdateEvent | None:
    raw_item = getattr(item, "raw_item", None)
    raw_item_type = _get_mapping_or_attr(raw_item, "type")

    if event_name == "tool_search_called":
        summary = format_tool_search_progress_summary(
            _get_mapping_or_attr(raw_item, "arguments")
        )
        if key := _tool_search_key(raw_item):
            search_summaries[key] = summary
        return ProgressUpdateEvent(text=f"Using {summary}.")

    if event_name == "tool_search_output_created":
        summary = None
        if key := _tool_search_key(raw_item):
            summary = search_summaries.pop(key, None)
        summary = summary or "web_search(...)"
        return ProgressUpdateEvent(text=f"Finished {summary}.")

    if event_name != "tool_called":
        return None

    if raw_item_type == "web_search_call":
        action = _get_mapping_or_attr(raw_item, "action")
        return ProgressUpdateEvent(
            text=f"Using {format_tool_search_progress_summary(action)}."
        )

    if raw_item_type != "function_call":
        return None

    tool_name = _get_mapping_or_attr(raw_item, "name")
    if not isinstance(tool_name, str) or not tool_name.strip():
        return None

    summary = format_tool_call_progress_summary(
        tool_name,
        _get_mapping_or_attr(raw_item, "arguments"),
    )
    return ProgressUpdateEvent(text=f"Using {summary}.")


async def stream_agent_response_with_tool_progress(
    context: AgentContext[Any],
    result: RunResultStreaming,
    *,
    converter: ResponseStreamConverter = _DEFAULT_RESPONSE_STREAM_CONVERTER,
) -> AsyncIterator[ThreadStreamEvent]:
    current_item_id = None
    current_tool_call = None
    ctx = context
    thread = context.thread
    queue_iterator = _AsyncQueueIterator(context._events)
    produced_items = set()
    streaming_thought: None | StreamingThoughtTracker = None
    search_summaries: dict[str, str] = {}
    item_annotation_count: defaultdict[str, defaultdict[int, int]] = defaultdict(
        lambda: defaultdict(int)
    )

    items = await context.store.load_thread_items(
        thread.id, None, 2, "desc", context.request_context
    )
    last_item = items.data[0] if len(items.data) > 0 else None
    second_last_item = items.data[1] if len(items.data) > 1 else None

    if last_item and last_item.type == "workflow":
        ctx.workflow_item = last_item
    elif (
        last_item
        and last_item.type == "client_tool_call"
        and second_last_item
        and second_last_item.type == "workflow"
    ):
        ctx.workflow_item = second_last_item

    def end_workflow(item: WorkflowItem) -> ThreadItemDoneEvent:
        if item == ctx.workflow_item:
            ctx.workflow_item = None
        delta = datetime.now() - item.created_at
        duration = int(delta.total_seconds())
        if item.workflow.summary is None:
            item.workflow.summary = DurationSummary(duration=duration)
        item.workflow.expanded = False
        return ThreadItemDoneEvent(item=item)

    try:
        async for event in _merge_generators(result.stream_events(), queue_iterator):
            if isinstance(event, _EventWrapper):
                event = event.event
                if event.type == "thread.item.added" or event.type == "thread.item.done":
                    if (
                        ctx.workflow_item
                        and ctx.workflow_item.id != event.item.id
                        and event.item.type != "client_tool_call"
                        and event.item.type != "hidden_context_item"
                    ):
                        yield end_workflow(ctx.workflow_item)

                    if event.type == "thread.item.added" and event.item.type == "workflow":
                        ctx.workflow_item = event.item

                    produced_items.add(event.item.id)
                yield event
                continue

            if event.type == "run_item_stream_event":
                if progress_event := _build_tool_progress_event(
                    event.item,
                    search_summaries=search_summaries,
                    event_name=event.name,
                ):
                    yield progress_event

                event = event.item
                raw_item = event.raw_item
                raw_item_type = _get_mapping_or_attr(raw_item, "type")
                raw_item_call_id = _get_mapping_or_attr(raw_item, "call_id")
                raw_item_id = _get_mapping_or_attr(raw_item, "id")

                if event.type == "tool_call_item" and raw_item_type == "function_call":
                    current_tool_call = raw_item_call_id if isinstance(raw_item_call_id, str) else None
                    current_item_id = raw_item_id if isinstance(raw_item_id, str) else None
                    if current_item_id:
                        produced_items.add(current_item_id)
                continue

            if event.type != "raw_response_event":
                continue

            event = event.data
            if event.type == "response.content_part.added":
                if event.part.type == "reasoning_text":
                    continue
                content = await _convert_content(event.part, converter)
                yield ThreadItemUpdatedEvent(
                    item_id=event.item_id,
                    update=AssistantMessageContentPartAdded(
                        content_index=event.content_index,
                        content=content,
                    ),
                )
            elif event.type == "response.output_text.delta":
                yield ThreadItemUpdatedEvent(
                    item_id=event.item_id,
                    update=AssistantMessageContentPartTextDelta(
                        content_index=event.content_index,
                        delta=event.delta,
                    ),
                )
            elif event.type == "response.output_text.done":
                yield ThreadItemUpdatedEvent(
                    item_id=event.item_id,
                    update=AssistantMessageContentPartDone(
                        content_index=event.content_index,
                        content=AssistantMessageContent(
                            text=event.text,
                            annotations=[],
                        ),
                    ),
                )
            elif event.type == "response.output_text.annotation.added":
                annotation = await _convert_annotation(event.annotation, converter)
                if annotation:
                    annotation_index = item_annotation_count[event.item_id][
                        event.content_index
                    ]
                    item_annotation_count[event.item_id][event.content_index] = (
                        annotation_index + 1
                    )
                    yield ThreadItemUpdatedEvent(
                        item_id=event.item_id,
                        update=AssistantMessageContentPartAnnotationAdded(
                            content_index=event.content_index,
                            annotation_index=annotation_index,
                            annotation=annotation,
                        ),
                    )
                continue
            elif event.type == "response.output_item.added":
                item = event.item
                if item.type == "reasoning" and not ctx.workflow_item:
                    ctx.workflow_item = WorkflowItem(
                        id=ctx.generate_id("workflow"),
                        created_at=datetime.now(),
                        workflow=Workflow(type="reasoning", tasks=[]),
                        thread_id=thread.id,
                    )
                    produced_items.add(ctx.workflow_item.id)
                    yield ThreadItemAddedEvent(item=ctx.workflow_item)
                if item.type == "message":
                    if ctx.workflow_item:
                        yield end_workflow(ctx.workflow_item)
                    produced_items.add(item.id)
                    yield ThreadItemAddedEvent(
                        item=AssistantMessageItem(
                            id=item.id,
                            thread_id=thread.id,
                            content=[
                                await _convert_content(c, converter)
                                for c in item.content
                            ],
                            created_at=datetime.now(),
                        ),
                    )
                elif item.type == "image_generation_call":
                    ctx.generated_image_item = GeneratedImageItem(
                        id=ctx.generate_id("message"),
                        thread_id=thread.id,
                        created_at=datetime.now(),
                        image=None,
                    )
                    produced_items.add(ctx.generated_image_item.id)
                    yield ThreadItemAddedEvent(item=ctx.generated_image_item)
            elif event.type == "response.image_generation_call.partial_image":
                if not ctx.generated_image_item:
                    continue

                url = await converter.base64_image_to_url(
                    image_id=event.item_id,
                    base64_image=event.partial_image_b64,
                    partial_image_index=event.partial_image_index,
                )
                progress = converter.partial_image_index_to_progress(
                    event.partial_image_index
                )

                ctx.generated_image_item.image = GeneratedImage(
                    id=event.item_id, url=url
                )

                yield ThreadItemUpdatedEvent(
                    item_id=ctx.generated_image_item.id,
                    update=GeneratedImageUpdated(
                        image=ctx.generated_image_item.image, progress=progress
                    ),
                )
            elif event.type == "response.reasoning_summary_text.delta":
                if not ctx.workflow_item:
                    continue

                if (
                    ctx.workflow_item.workflow.type == "reasoning"
                    and len(ctx.workflow_item.workflow.tasks) == 0
                ):
                    streaming_thought = StreamingThoughtTracker(
                        item_id=event.item_id,
                        index=event.summary_index,
                        task=ThoughtTask(content=event.delta),
                    )
                    ctx.workflow_item.workflow.tasks.append(streaming_thought.task)
                    yield ThreadItemUpdatedEvent(
                        item_id=ctx.workflow_item.id,
                        update=WorkflowTaskAdded(
                            task=streaming_thought.task,
                            task_index=0,
                        ),
                    )
                elif (
                    streaming_thought
                    and streaming_thought.task in ctx.workflow_item.workflow.tasks
                    and event.item_id == streaming_thought.item_id
                    and event.summary_index == streaming_thought.index
                ):
                    streaming_thought.task.content += event.delta
                    yield ThreadItemUpdatedEvent(
                        item_id=ctx.workflow_item.id,
                        update=WorkflowTaskUpdated(
                            task=streaming_thought.task,
                            task_index=ctx.workflow_item.workflow.tasks.index(
                                streaming_thought.task
                            ),
                        ),
                    )
            elif event.type == "response.reasoning_summary_text.done":
                if ctx.workflow_item:
                    if (
                        streaming_thought
                        and streaming_thought.task in ctx.workflow_item.workflow.tasks
                        and event.item_id == streaming_thought.item_id
                        and event.summary_index == streaming_thought.index
                    ):
                        task = streaming_thought.task
                        task.content = event.text
                        streaming_thought = None
                        update = WorkflowTaskUpdated(
                            task=task,
                            task_index=ctx.workflow_item.workflow.tasks.index(task),
                        )
                    else:
                        task = ThoughtTask(content=event.text)
                        ctx.workflow_item.workflow.tasks.append(task)
                        update = WorkflowTaskAdded(
                            task=task,
                            task_index=ctx.workflow_item.workflow.tasks.index(task),
                        )
                    yield ThreadItemUpdatedEvent(
                        item_id=ctx.workflow_item.id,
                        update=update,
                    )
            elif event.type == "response.output_item.done":
                item = event.item
                if item.type == "message":
                    produced_items.add(item.id)
                    yield ThreadItemDoneEvent(
                        item=AssistantMessageItem(
                            id=item.id,
                            thread_id=thread.id,
                            content=[
                                await _convert_content(c, converter)
                                for c in item.content
                            ],
                            created_at=datetime.now(),
                        ),
                    )
                elif item.type == "image_generation_call" and item.result:
                    if not ctx.generated_image_item:
                        continue

                    url = await converter.base64_image_to_url(
                        image_id=item.id,
                        base64_image=item.result,
                    )
                    image = GeneratedImage(id=item.id, url=url)

                    ctx.generated_image_item.image = image
                    yield ThreadItemDoneEvent(item=ctx.generated_image_item)

                    ctx.generated_image_item = None

    except (InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered):
        for item_id in produced_items:
            yield ThreadItemRemovedEvent(item_id=item_id)

        context._complete()
        queue_iterator.drain_and_complete()

        raise

    context._complete()

    async for event in queue_iterator:
        yield event.event

    if ctx.workflow_item:
        await ctx.store.add_thread_item(
            thread.id, ctx.workflow_item, ctx.request_context
        )

    if context.client_tool_call:
        yield ThreadItemDoneEvent(
            item=ClientToolCallItem(
                id=current_item_id
                or context.store.generate_item_id(
                    "tool_call", thread, context.request_context
                ),
                thread_id=thread.id,
                name=context.client_tool_call.name,
                arguments=context.client_tool_call.arguments,
                created_at=datetime.now(),
                call_id=current_tool_call
                or context.store.generate_item_id(
                    "tool_call", thread, context.request_context
                ),
            ),
        )
