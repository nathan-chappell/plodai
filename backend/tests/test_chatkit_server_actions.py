import asyncio
import logging
from types import SimpleNamespace

from chatkit.types import ProgressUpdateEvent, ThreadItemRemovedEvent

from backend.app.agents.context import ReportAgentContext
from backend.app.chatkit.server import ClientWorkspaceChatKitServer


async def _collect_events(async_iterator):
    return [event async for event in async_iterator]


def _tour_agent_bundle() -> dict[str, object]:
    return {
        "root_agent_id": "default-agent",
        "agents": [
            {
                "agent_id": "default-agent",
                "agent_name": "Default",
                "instructions": "Route work.",
                "client_tools": [
                    {
                        "type": "function",
                        "name": "list_tour_scenarios",
                        "description": "Open the tour picker.",
                        "parameters": {
                            "type": "object",
                            "properties": {},
                            "additionalProperties": False,
                        },
                        "strict": True,
                        "display": {
                            "label": "Open tour picker",
                            "tour_picker": {
                                "title": "Choose a guided tour",
                                "summary": "Pick the best guided sample.",
                                "scenarios": [
                                    {
                                        "scenario_id": "report-tour",
                                        "title": "Report tour",
                                        "summary": "Create one chart-backed report slide.",
                                        "workspace_name": "Report tour",
                                        "target_agent_id": "report-agent",
                                        "default_asset_count": 2,
                                    }
                                ],
                            },
                        },
                    }
                ],
                "delegation_targets": [],
            }
        ],
    }


def _server() -> ClientWorkspaceChatKitServer:
    server = object.__new__(ClientWorkspaceChatKitServer)
    server.logger = logging.getLogger("report_foundry.tests.chatkit_server_actions")
    return server


def _context() -> ReportAgentContext:
    return ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
        agent_bundle=_tour_agent_bundle(),
    )


def test_submit_tour_picker_removes_widget_for_known_scenario() -> None:
    server = _server()
    context = _context()
    events = asyncio.run(
        _collect_events(
            server.action(
                SimpleNamespace(id="thread_123", metadata={}),
                SimpleNamespace(
                    type="submit_tour_picker",
                    payload={"scenario_id": "report-tour"},
                ),
                SimpleNamespace(id="widget_123"),
                context,
            )
        )
    )

    assert len(events) == 1
    assert isinstance(events[0], ThreadItemRemovedEvent)
    assert events[0].item_id == "widget_123"


def test_submit_tour_picker_rejects_unknown_scenario() -> None:
    server = _server()
    context = _context()
    events = asyncio.run(
        _collect_events(
            server.action(
                SimpleNamespace(id="thread_123", metadata={}),
                SimpleNamespace(
                    type="submit_tour_picker",
                    payload={"scenario_id": "document-tour"},
                ),
                SimpleNamespace(id="widget_123"),
                context,
            )
        )
    )

    assert len(events) == 1
    assert isinstance(events[0], ProgressUpdateEvent)
    assert events[0].text == "That guided tour option is no longer available."


def test_cancel_tour_picker_removes_widget() -> None:
    server = _server()
    events = asyncio.run(
        _collect_events(
            server.action(
                SimpleNamespace(id="thread_123", metadata={}),
                SimpleNamespace(type="cancel_tour_picker", payload={}),
                SimpleNamespace(id="widget_123"),
                _context(),
            )
        )
    )

    assert len(events) == 1
    assert isinstance(events[0], ThreadItemRemovedEvent)
    assert events[0].item_id == "widget_123"
