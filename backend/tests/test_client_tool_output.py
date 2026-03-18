import asyncio
import logging
from datetime import datetime
from types import MethodType, SimpleNamespace

from chatkit.types import (
    ClientToolCallItem,
    ProgressUpdateEvent,
    ThreadAddClientToolOutputParams,
    ThreadMetadata,
    ThreadsAddClientToolOutputReq,
)

import backend.app.chatkit.server as chatkit_server_module
from backend.app.agents.context import ReportAgentContext
from backend.app.chatkit.server import ClientWorkspaceChatKitServer


class _StubStore:
    def __init__(self, recent_item_pages: list[list[object]]) -> None:
        self.recent_item_pages = recent_item_pages
        self.load_thread_items_calls = 0
        self.saved_items: list[tuple[str, ClientToolCallItem]] = []

    async def load_thread(self, thread_id: str, context: object | None = None) -> ThreadMetadata:
        return ThreadMetadata(id=thread_id, created_at=datetime.now())

    async def load_thread_items(
        self,
        thread_id: str,
        after: object | None,
        limit: int,
        order: str,
        context: object | None = None,
    ) -> SimpleNamespace:
        index = min(self.load_thread_items_calls, len(self.recent_item_pages) - 1)
        self.load_thread_items_calls += 1
        return SimpleNamespace(data=self.recent_item_pages[index])

    async def save_item(
        self,
        thread_id: str,
        item: ClientToolCallItem,
        context: object | None = None,
    ) -> None:
        self.saved_items.append((thread_id, item.model_copy(deep=True)))

    async def delete_thread_item(
        self,
        thread_id: str,
        item_id: str,
        context: object | None = None,
    ) -> None:
        return None


def _build_server(store: _StubStore) -> ClientWorkspaceChatKitServer:
    server = ClientWorkspaceChatKitServer.__new__(ClientWorkspaceChatKitServer)
    server.store = store
    server.logger = logging.getLogger("report_foundry.tests.client_tool_output")

    async def fake_cleanup(
        self: ClientWorkspaceChatKitServer,
        thread: ThreadMetadata,
        context: ReportAgentContext,
    ) -> None:
        return None

    async def fake_process_events(
        self: ClientWorkspaceChatKitServer,
        thread: ThreadMetadata,
        context: ReportAgentContext,
        stream: object,
    ):
        yield ProgressUpdateEvent(text="continued after tool output")

    server._cleanup_pending_client_tool_call = MethodType(fake_cleanup, server)
    server._process_events = MethodType(fake_process_events, server)
    return server


async def _collect_events(server: ClientWorkspaceChatKitServer, request: ThreadsAddClientToolOutputReq, context: ReportAgentContext):
    return [event async for event in server._process_streaming_impl(request, context)]


def test_find_pending_client_tool_call_retries_until_recent_pending_call_is_visible(
    monkeypatch,
) -> None:
    pending_tool_call = ClientToolCallItem(
        id="tool_item_123",
        thread_id="thread_123",
        created_at=datetime.now(),
        status="pending",
        call_id="call_123",
        name="list_workspace_files",
        arguments={"includeSamples": True},
    )
    store = _StubStore(
        recent_item_pages=[
            [SimpleNamespace(id="widget_123", type="widget")],
            [SimpleNamespace(id="widget_123", type="widget"), pending_tool_call],
        ]
    )
    server = _build_server(store)
    context = ReportAgentContext(
        report_id="thread_123",
        user_id="user_123",
        user_email=None,
        db=None,
    )
    monkeypatch.setattr(
        chatkit_server_module,
        "CLIENT_TOOL_OUTPUT_RETRY_DELAYS",
        (0.0, 0.0),
    )

    tool_call = asyncio.run(
        server._find_pending_client_tool_call("thread_123", context)
    )

    assert tool_call is not None
    assert tool_call.call_id == "call_123"
    assert store.load_thread_items_calls == 2


def test_process_streaming_impl_completes_recent_pending_tool_call_output(
    monkeypatch,
) -> None:
    pending_tool_call = ClientToolCallItem(
        id="tool_item_456",
        thread_id="thread_456",
        created_at=datetime.now(),
        status="pending",
        call_id="call_456",
        name="list_workspace_files",
        arguments={"includeSamples": True},
    )
    store = _StubStore(
        recent_item_pages=[
            [SimpleNamespace(id="widget_456", type="widget")],
            [SimpleNamespace(id="widget_456", type="widget"), pending_tool_call],
        ]
    )
    server = _build_server(store)
    context = ReportAgentContext(
        report_id="thread_456",
        user_id="user_456",
        user_email=None,
        db=None,
    )
    request = ThreadsAddClientToolOutputReq(
        params=ThreadAddClientToolOutputParams(
            thread_id="thread_456",
            result={"cwd_path": "/report-agent"},
        )
    )
    monkeypatch.setattr(
        chatkit_server_module,
        "CLIENT_TOOL_OUTPUT_RETRY_DELAYS",
        (0.0, 0.0),
    )

    events = asyncio.run(_collect_events(server, request, context))

    assert len(store.saved_items) == 1
    saved_thread_id, saved_item = store.saved_items[0]
    assert saved_thread_id == "thread_456"
    assert saved_item.status == "completed"
    assert saved_item.output == {"cwd_path": "/report-agent"}
    assert len(events) == 1
    assert isinstance(events[0], ProgressUpdateEvent)
    assert events[0].text == "continued after tool output"
