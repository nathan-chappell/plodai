import asyncio
from datetime import datetime
from types import SimpleNamespace
from typing import Any

from agents.items import ToolCallItem, ToolSearchCallItem, ToolSearchOutputItem
from agents.stream_events import RawResponsesStreamEvent, RunItemStreamEvent
from chatkit.agents import AgentContext as ChatKitAgentContext
from chatkit.agents import AnnotationURLCitation
from chatkit.types import Annotation, Page, ThreadMetadata, URLSource
from openai.types.responses import (
    ResponseFunctionToolCall,
    ResponseFunctionWebSearch,
    ResponseToolSearchCall,
    ResponseToolSearchOutputItem,
)

from backend.app.chatkit.agent_stream import (
    format_tool_call_progress_summary,
    format_tool_search_progress_summary,
    stream_agent_response_with_tool_progress,
)


class FakeAgent:
    pass


class FakeStore:
    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: object,
    ) -> Page[Any]:
        return Page(data=[], has_more=False, after=None)

    async def add_thread_item(
        self,
        thread_id: str,
        item: object,
        context: object,
    ) -> None:
        return None

    def generate_item_id(
        self,
        item_type: str,
        thread: ThreadMetadata,
        context: object,
    ) -> str:
        return f"{item_type}_generated"


class FakeRunResult:
    def __init__(self, events: list[object]):
        self._events = events

    async def stream_events(self):
        for event in self._events:
            yield event


def test_format_tool_call_progress_summary_uses_safe_shapes() -> None:
    assert format_tool_call_progress_summary("get_farm_record", {}) == "get_farm_record()"
    assert (
        format_tool_call_progress_summary(
            "name_current_thread",
            {"title": "  Walnut planning sync  "},
        )
        == 'name_current_thread("Walnut planning sync")'
    )
    assert (
        format_tool_call_progress_summary(
            "save_farm_record",
            {
                "record": {
                    "farm_name": "North Orchard",
                    "description": "Do not leak this whole payload.",
                    "areas": [{"id": "area_1"}],
                    "crops": [{"id": "crop_1"}, {"id": "crop_2"}],
                    "work_items": [{"id": "work_1"}],
                    "orders": [{"id": "order_1"}],
                }
            },
        )
        == 'save_farm_record(farm_name="North Orchard", crops=2, areas=1, work_items=1, orders=1)'
    )


def test_format_tool_search_progress_summary_prefers_query_and_truncates_unknowns() -> None:
    assert (
        format_tool_search_progress_summary(
            {"query": "walnut blight treatment"}
        )
        == 'web_search("walnut blight treatment")'
    )
    unknown_summary = format_tool_call_progress_summary(
        "custom_tool",
        {
            "message": "x" * 120,
            "count": 3,
            "nested": {"secret": "hidden"},
        },
    )
    assert unknown_summary.startswith('custom_tool(message="')
    assert "..." in unknown_summary
    assert ", count=3)" in unknown_summary


def test_stream_adapter_emits_progress_for_function_tools_and_preserves_message_events() -> None:
    async def _run() -> None:
        context = _build_context()
        events = [
            RunItemStreamEvent(
                name="tool_called",
                item=ToolCallItem(
                    agent=FakeAgent(),
                    raw_item=ResponseFunctionToolCall.model_validate(
                        {
                            "id": "tool_item_1",
                            "call_id": "call_1",
                            "name": "get_farm_record",
                            "arguments": "{}",
                            "type": "function_call",
                            "status": "completed",
                        }
                    ),
                ),
            ),
            RawResponsesStreamEvent(
                data=SimpleNamespace(
                    type="response.output_item.added",
                    item=SimpleNamespace(
                        type="message",
                        id="msg_1",
                        content=[],
                    ),
                )
            ),
            RawResponsesStreamEvent(
                data=SimpleNamespace(
                    type="response.output_item.done",
                    item=SimpleNamespace(
                        type="message",
                        id="msg_1",
                        content=[],
                    ),
                )
            ),
        ]

        streamed_events = [
            event
            async for event in stream_agent_response_with_tool_progress(
                context,
                FakeRunResult(events),
            )
        ]

        assert [event.type for event in streamed_events] == [
            "progress_update",
            "thread.item.added",
            "thread.item.done",
        ]
        assert streamed_events[0].text == "Using get_farm_record()."
        assert streamed_events[1].item.type == "assistant_message"
        assert streamed_events[2].item.type == "assistant_message"

    asyncio.run(_run())


def test_stream_adapter_emits_start_and_completion_for_tool_search_events() -> None:
    async def _run() -> None:
        context = _build_context()
        events = [
            RunItemStreamEvent(
                name="tool_search_called",
                item=ToolSearchCallItem(
                    agent=FakeAgent(),
                    raw_item=ResponseToolSearchCall.model_validate(
                        {
                            "id": "search_item_1",
                            "call_id": "search_call_1",
                            "arguments": {"query": "walnut blight treatment"},
                            "execution": "server",
                            "status": "completed",
                            "type": "tool_search_call",
                        }
                    ),
                ),
            ),
            RunItemStreamEvent(
                name="tool_search_output_created",
                item=ToolSearchOutputItem(
                    agent=FakeAgent(),
                    raw_item=ResponseToolSearchOutputItem.model_validate(
                        {
                            "id": "search_output_1",
                            "call_id": "search_call_1",
                            "execution": "server",
                            "status": "completed",
                            "tools": [],
                            "type": "tool_search_output",
                        }
                    ),
                ),
            ),
        ]

        streamed_events = [
            event
            async for event in stream_agent_response_with_tool_progress(
                context,
                FakeRunResult(events),
            )
        ]

        assert [event.type for event in streamed_events] == [
            "progress_update",
            "progress_update",
        ]
        assert streamed_events[0].text == 'Using web_search("walnut blight treatment").'
        assert streamed_events[1].text == 'Finished web_search("walnut blight treatment").'

    asyncio.run(_run())


def test_stream_adapter_handles_web_search_call_tool_items() -> None:
    async def _run() -> None:
        context = _build_context()
        events = [
            RunItemStreamEvent(
                name="tool_called",
                item=ToolCallItem(
                    agent=FakeAgent(),
                    raw_item=ResponseFunctionWebSearch.model_validate(
                        {
                            "id": "web_1",
                            "status": "completed",
                            "type": "web_search_call",
                            "action": {
                                "type": "search",
                                "query": "orchard sanitation checklist",
                            },
                        }
                    ),
                ),
            )
        ]

        streamed_events = [
            event
            async for event in stream_agent_response_with_tool_progress(
                context,
                FakeRunResult(events),
            )
        ]

        assert len(streamed_events) == 1
        assert streamed_events[0].type == "progress_update"
        assert streamed_events[0].text == 'Using web_search("orchard sanitation checklist").'

    asyncio.run(_run())


def test_stream_adapter_forwards_url_citation_annotations() -> None:
    async def _run() -> None:
        context = _build_context()
        events = [
            RawResponsesStreamEvent(
                data=SimpleNamespace(
                    type="response.output_text.annotation.added",
                    item_id="msg_1",
                    content_index=0,
                    annotation=AnnotationURLCitation.model_validate(
                        {
                            "type": "url_citation",
                            "title": "Extension guide",
                            "url": "https://extension.example/guide",
                            "start_index": 12,
                            "end_index": 24,
                        }
                    ),
                )
            ),
        ]

        streamed_events = [
            event
            async for event in stream_agent_response_with_tool_progress(
                context,
                FakeRunResult(events),
                converter=FakeConverter(),
            )
        ]

        assert len(streamed_events) == 1
        assert streamed_events[0].type == "thread.item.updated"
        assert streamed_events[0].update.annotation.source.type == "url"
        assert streamed_events[0].update.annotation.source.url == "https://extension.example/guide"

    asyncio.run(_run())


def test_stream_adapter_appends_references_footer_when_sources_exist_without_visible_citations() -> None:
    async def _run() -> None:
        context = _build_context()
        events = [
            RawResponsesStreamEvent(
                data=SimpleNamespace(
                    type="response.output_item.added",
                    item=ResponseFunctionWebSearch.model_validate(
                        {
                            "id": "web_1",
                            "status": "completed",
                            "type": "web_search_call",
                            "action": {
                                "type": "search",
                                "query": "walnut leaf spot treatment",
                                "sources": [
                                    {"type": "url", "url": "https://source.example/one"},
                                    {"type": "url", "url": "https://source.example/two"},
                                    {"type": "url", "url": "https://source.example/one"},
                                    {"type": "url", "url": "https://source.example/three"},
                                    {"type": "url", "url": "https://source.example/four"},
                                ],
                            },
                        }
                    ),
                )
            ),
            RawResponsesStreamEvent(
                data=SimpleNamespace(
                    type="response.output_item.done",
                    item=SimpleNamespace(
                        type="message",
                        id="msg_1",
                        content=[
                            SimpleNamespace(
                                type="output_text",
                                text="Likely fungal pressure is increasing in the canopy.",
                                annotations=[],
                            )
                        ],
                    ),
                )
            ),
        ]

        streamed_events = [
            event
            async for event in stream_agent_response_with_tool_progress(
                context,
                FakeRunResult(events),
                converter=FakeConverter(),
            )
        ]

        assert len(streamed_events) == 1
        assert streamed_events[0].type == "thread.item.done"
        final_text = streamed_events[0].item.content[0].text
        assert "References:" in final_text
        assert "- https://source.example/one" in final_text
        assert "- https://source.example/two" in final_text
        assert "- https://source.example/three" in final_text
        assert "https://source.example/four" not in final_text
        assert final_text.count("https://source.example/one") == 1

    asyncio.run(_run())


def test_stream_adapter_skips_references_footer_when_message_already_has_visible_url() -> None:
    async def _run() -> None:
        context = _build_context()
        events = [
            RawResponsesStreamEvent(
                data=SimpleNamespace(
                    type="response.output_item.added",
                    item=ResponseFunctionWebSearch.model_validate(
                        {
                            "id": "web_1",
                            "status": "completed",
                            "type": "web_search_call",
                            "action": {
                                "type": "search",
                                "query": "walnut blight extension guidance",
                                "sources": [
                                    {"type": "url", "url": "https://source.example/one"},
                                ],
                            },
                        }
                    ),
                )
            ),
            RawResponsesStreamEvent(
                data=SimpleNamespace(
                    type="response.output_item.done",
                    item=SimpleNamespace(
                        type="message",
                        id="msg_1",
                        content=[
                            SimpleNamespace(
                                type="output_text",
                                text="See https://extension.example/walnut-blight for the current extension guidance.",
                                annotations=[],
                            )
                        ],
                    ),
                )
            ),
        ]

        streamed_events = [
            event
            async for event in stream_agent_response_with_tool_progress(
                context,
                FakeRunResult(events),
                converter=FakeConverter(),
            )
        ]

        assert len(streamed_events) == 1
        assert streamed_events[0].type == "thread.item.done"
        assert "References:" not in streamed_events[0].item.content[0].text

    asyncio.run(_run())


def test_stream_adapter_skips_references_footer_when_url_citation_was_streamed() -> None:
    async def _run() -> None:
        context = _build_context()
        events = [
            RawResponsesStreamEvent(
                data=SimpleNamespace(
                    type="response.output_item.added",
                    item=ResponseFunctionWebSearch.model_validate(
                        {
                            "id": "web_1",
                            "status": "completed",
                            "type": "web_search_call",
                            "action": {
                                "type": "search",
                                "query": "walnut disease references",
                                "sources": [
                                    {"type": "url", "url": "https://source.example/one"},
                                ],
                            },
                        }
                    ),
                )
            ),
            RawResponsesStreamEvent(
                data=SimpleNamespace(
                    type="response.output_text.annotation.added",
                    item_id="msg_1",
                    content_index=0,
                    annotation=AnnotationURLCitation.model_validate(
                        {
                            "type": "url_citation",
                            "title": "Extension guide",
                            "url": "https://extension.example/guide",
                            "start_index": 0,
                            "end_index": 10,
                        }
                    ),
                )
            ),
            RawResponsesStreamEvent(
                data=SimpleNamespace(
                    type="response.output_item.done",
                    item=SimpleNamespace(
                        type="message",
                        id="msg_1",
                        content=[
                            SimpleNamespace(
                                type="output_text",
                                text="Monitor humidity and confirm fungal structures.",
                                annotations=[],
                            )
                        ],
                    ),
                )
            ),
        ]

        streamed_events = [
            event
            async for event in stream_agent_response_with_tool_progress(
                context,
                FakeRunResult(events),
                converter=FakeConverter(),
            )
        ]

        assert [event.type for event in streamed_events] == [
            "thread.item.updated",
            "thread.item.done",
        ]
        assert "References:" not in streamed_events[-1].item.content[0].text

    asyncio.run(_run())


def _build_context() -> ChatKitAgentContext[object]:
    return ChatKitAgentContext[object](
        thread=ThreadMetadata(
            id="thread_1",
            created_at=datetime.now(),
            metadata={},
        ),
        store=FakeStore(),
        request_context=SimpleNamespace(),
    )


class FakeConverter:
    async def url_citation_to_annotation(
        self,
        annotation: AnnotationURLCitation,
    ) -> Annotation:
        return Annotation(
            source=URLSource(
                title=annotation.title,
                url=annotation.url,
            ),
            index=annotation.start_index,
        )

    async def file_citation_to_annotation(self, annotation: object) -> None:
        return None

    async def container_file_citation_to_annotation(self, annotation: object) -> None:
        return None
