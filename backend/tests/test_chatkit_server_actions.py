import asyncio
import logging
from types import SimpleNamespace

from chatkit.types import ProgressUpdateEvent, ThreadItemRemovedEvent

from backend.app.agents.context import ReportAgentContext
from backend.app.chatkit.server import ClientWorkspaceChatKitServer


class _StubStore:
    def __init__(self) -> None:
        self.saved_threads: list[object] = []

    async def save_thread(self, thread, *, context) -> None:
        del context
        self.saved_threads.append(thread)


async def _collect_events(async_iterator):
    return [event async for event in async_iterator]


def _server() -> ClientWorkspaceChatKitServer:
    server = object.__new__(ClientWorkspaceChatKitServer)
    server.logger = logging.getLogger("report_foundry.tests.chatkit_server_actions")
    server.store = _StubStore()
    return server


def _context() -> ReportAgentContext:
    return ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
    )


def test_update_chat_metadata_action_merges_patch_and_updates_title() -> None:
    server = _server()
    thread = SimpleNamespace(
        id="thread_123",
        title="Initial title",
        metadata={
            "workspace_state": {
                "version": "v4",
                "workspace_id": "workspace_123",
                "workspace_name": "PlodAI workspace",
                "app_id": "plodai",
                "items": [],
            }
        },
    )

    events = asyncio.run(
        _collect_events(
            server.action(
                thread,
                SimpleNamespace(
                    type="update_chat_metadata",
                    payload={
                        "title": "Updated title",
                        "workspace_state": {
                            "version": "v4",
                            "workspace_id": "workspace_123",
                            "workspace_name": "PlodAI workspace",
                            "app_id": "plodai",
                            "selected_item_id": "file_1",
                            "items": [],
                        },
                    },
                ),
                None,
                _context(),
            )
        )
    )

    assert len(events) == 1
    assert isinstance(events[0], ProgressUpdateEvent)
    assert events[0].text == "Saved thread metadata update."
    assert thread.title == "Updated title"
    assert thread.metadata["workspace_state"]["selected_item_id"] == "file_1"


def test_submit_feedback_session_removes_widget_for_valid_feedback() -> None:
    server = _server()
    context = _context()
    thread = SimpleNamespace(
        id="thread_123",
        title="Feedback thread",
        metadata={
            "feedback_session": {
                "session_id": "fbs_123",
                "item_ids": ["msg_123"],
                "recommended_options": [
                    "The chart never appeared.",
                    "The explanation stopped too early.",
                    "The result was helpful overall.",
                ],
                "message_draft": None,
                "inferred_sentiment": "negative",
                "mode": "confirmation",
            }
        },
    )

    events = asyncio.run(
        _collect_events(
            server.action(
                thread,
                SimpleNamespace(
                    type="submit_feedback_session",
                    payload={
                        "session_id": "fbs_123",
                        "selected_option": "The chart never appeared.",
                        "sentiment": "negative",
                    },
                ),
                SimpleNamespace(id="widget_123"),
                context,
            )
        )
    )

    assert len(events) == 1
    assert isinstance(events[0], ThreadItemRemovedEvent)
    assert events[0].item_id == "widget_123"
    assert thread.metadata["feedback_session"]["message_draft"] == "The chart never appeared."
    assert thread.metadata["feedback_session"]["inferred_sentiment"] == "negative"
    assert len(server.store.saved_threads) == 1


def test_cancel_feedback_session_removes_widget_and_clears_session() -> None:
    server = _server()
    context = _context()
    thread = SimpleNamespace(
        id="thread_123",
        title="Feedback thread",
        metadata={
            "feedback_session": {
                "session_id": "fbs_123",
                "item_ids": ["msg_123"],
                "recommended_options": [
                    "Helpful overall.",
                    "Needs more detail.",
                    "Please rerun the analysis.",
                ],
                "message_draft": "Helpful overall.",
                "inferred_sentiment": "positive",
                "mode": "recommendations",
            }
        },
    )

    events = asyncio.run(
        _collect_events(
            server.action(
                thread,
                SimpleNamespace(
                    type="cancel_feedback_session",
                    payload={"session_id": "fbs_123"},
                ),
                SimpleNamespace(id="widget_123"),
                context,
            )
        )
    )

    assert len(events) == 1
    assert isinstance(events[0], ThreadItemRemovedEvent)
    assert events[0].item_id == "widget_123"
    assert "feedback_session" not in thread.metadata
    assert len(server.store.saved_threads) == 1
