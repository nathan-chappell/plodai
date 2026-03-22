import asyncio
from types import SimpleNamespace

from backend.app.agents.agent_builder import (
    _build_agent_graph,
    _build_agent_instructions,
)
from backend.app.agents.context import ReportAgentContext


def test_build_agent_graph_compiles_tools_per_agent() -> None:
    agent_bundle = {
        "root_agent_id": "report-agent",
        "agents": [
            {
                "agent_id": "report-agent",
                "agent_name": "Report",
                "instructions": "Manage reports and delegate specialist work.",
                "client_tools": [
                    {
                        "type": "function",
                        "name": "create_report",
                        "description": "Create a report.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                            },
                            "required": ["title"],
                            "additionalProperties": False,
                        },
                        "strict": True,
                    }
                ],
                "delegation_targets": [
                    {
                        "agent_id": "chart-agent",
                        "tool_name": "delegate_to_chart_agent",
                        "description": "Delegate chart work.",
                    }
                ],
            },
            {
                "agent_id": "chart-agent",
                "agent_name": "Charts",
                "instructions": "Render charts.",
                "client_tools": [
                    {
                        "type": "function",
                        "name": "render_chart_from_dataset",
                        "description": "Render a chart.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "dataset_id": {"type": "string"},
                                "chart_plan_id": {"type": "string"},
                                "chart_plan": {
                                    "type": "object",
                                    "properties": {},
                                    "additionalProperties": False,
                                },
                                "x_key": {"type": "string"},
                            },
                            "required": [
                                "dataset_id",
                                "chart_plan_id",
                                "chart_plan",
                                "x_key",
                            ],
                            "additionalProperties": False,
                        },
                        "strict": True,
                    }
                ],
                "delegation_targets": [],
            },
        ],
    }
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
        agent_bundle=agent_bundle,
    )

    agents = _build_agent_graph(
        context,
        agent_bundle=agent_bundle,
        model=None,
    )

    report_tool_names = [tool.name for tool in agents["report-agent"].tools]
    chart_tool_names = [tool.name for tool in agents["chart-agent"].tools]

    assert "create_report" in report_tool_names
    assert "render_chart_from_dataset" not in report_tool_names
    assert "render_chart_from_dataset" in chart_tool_names
    assert "create_report" not in chart_tool_names
    assert [handoff.tool_name for handoff in agents["report-agent"].handoffs] == [
        "delegate_to_chart_agent"
    ]
    assert agents["report-agent"].model_settings.metadata == {
        "root_agent_id": "report-agent",
        "root_agent_name": "Report",
        "agent_id": "report-agent",
        "agent_name": "Report",
    }
    assert agents["chart-agent"].model_settings.metadata == {
        "root_agent_id": "report-agent",
        "root_agent_name": "Report",
        "agent_id": "chart-agent",
        "agent_name": "Charts",
    }


def test_handoff_streams_widget_with_distinct_status() -> None:
    agent_bundle = {
        "root_agent_id": "report-agent",
        "agents": [
            {
                "agent_id": "report-agent",
                "agent_name": "Report",
                "instructions": "Manage reports and delegate specialist work.",
                "client_tools": [],
                "delegation_targets": [
                    {
                        "agent_id": "chart-agent",
                        "tool_name": "delegate_to_chart_agent",
                        "description": "Delegate chart work.",
                    }
                ],
            },
            {
                "agent_id": "chart-agent",
                "agent_name": "Charts",
                "instructions": "Render charts.",
                "client_tools": [],
                "delegation_targets": [],
            },
        ],
    }
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
        agent_bundle=agent_bundle,
    )
    agents = _build_agent_graph(
        context,
        agent_bundle=agent_bundle,
        model=None,
    )
    widget_calls: list[tuple[object, str | None]] = []
    run_context = SimpleNamespace(
        context=SimpleNamespace(
            stream_widget=lambda widget, copy_text=None: _capture_widget(
                widget_calls, widget, copy_text
            )
        )
    )

    target_agent = asyncio.run(
        agents["report-agent"].handoffs[0].on_invoke_handoff(run_context, "")
    )

    assert target_agent.name == "Charts"
    assert len(widget_calls) == 1
    widget, copy_text = widget_calls[0]
    assert "status" not in widget
    assert copy_text == "Report -> Charts"


def test_feedback_agent_gets_feedback_tools_without_validator_tooling() -> None:
    agent_bundle = {
        "root_agent_id": "feedback-agent",
        "agents": [
            {
                "agent_id": "feedback-agent",
                "agent_name": "Feedback",
                "instructions": "Capture feedback.",
                "client_tools": [],
                "delegation_targets": [],
            },
            {
                "agent_id": "report-agent",
                "agent_name": "Report",
                "instructions": "Manage reports.",
                "client_tools": [],
                "delegation_targets": [],
            },
        ],
    }
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
        agent_bundle=agent_bundle,
    )

    agents = _build_agent_graph(
        context,
        agent_bundle=agent_bundle,
        model=None,
    )

    feedback_tool_names = [tool.name for tool in agents["feedback-agent"].tools]
    report_tool_names = [tool.name for tool in agents["report-agent"].tools]

    assert "get_feedback" in feedback_tool_names
    assert "send_feedback" in feedback_tool_names
    assert set(agents["feedback-agent"].tool_use_behavior["stop_at_tool_names"]) == {
        "get_feedback",
        "send_feedback",
    }
    assert "get_current_thread_cost" not in feedback_tool_names
    assert "get_current_thread_cost" not in report_tool_names


def test_default_agent_tour_tools_stop_after_each_client_tool() -> None:
    agent_bundle = {
        "root_agent_id": "default-agent",
        "agents": [
            {
                "agent_id": "default-agent",
                "agent_name": "Default",
                "instructions": "Route work and launch tours.",
                "client_tools": [
                    {
                        "type": "function",
                        "name": "list_tour_scenarios",
                        "description": "List tours.",
                        "parameters": {
                            "type": "object",
                            "properties": {},
                            "additionalProperties": False,
                        },
                        "strict": True,
                    },
                    {
                        "type": "function",
                        "name": "launch_tour_scenario",
                        "description": "Prepare the tour workspace.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "scenario_id": {"type": "string"},
                            },
                            "required": ["scenario_id"],
                            "additionalProperties": False,
                        },
                        "strict": True,
                    },
                ],
                "delegation_targets": [
                    {
                        "agent_id": "agriculture-agent",
                        "tool_name": "delegate_to_agriculture_agent",
                        "description": "Delegate agriculture work.",
                    }
                ],
            },
            {
                "agent_id": "agriculture-agent",
                "agent_name": "Agriculture",
                "instructions": "Inspect plant photos.",
                "client_tools": [],
                "delegation_targets": [],
            },
        ],
    }
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
        agent_bundle=agent_bundle,
    )

    agents = _build_agent_graph(
        context,
        agent_bundle=agent_bundle,
        model=None,
    )

    assert set(agents["default-agent"].tool_use_behavior["stop_at_tool_names"]) == {
        "list_tour_scenarios",
        "launch_tour_scenario",
    }


def test_agriculture_agent_gets_hosted_web_search_tool() -> None:
    agent_bundle = {
        "root_agent_id": "agriculture-agent",
        "agents": [
            {
                "agent_id": "agriculture-agent",
                "agent_name": "Agriculture",
                "instructions": "Inspect plant images and use trusted web search when needed.",
                "client_tools": [],
                "delegation_targets": [],
            }
        ],
    }
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
        agent_bundle=agent_bundle,
    )

    agents = _build_agent_graph(
        context,
        agent_bundle=agent_bundle,
        model=None,
    )

    agriculture_tool_names = [tool.name for tool in agents["agriculture-agent"].tools]

    assert "web_search" in agriculture_tool_names


async def _capture_widget(
    widget_calls: list[tuple[object, str | None]],
    widget: object,
    copy_text: str | None,
) -> None:
    widget_calls.append((widget, copy_text))


def test_build_agent_instructions_includes_current_investigation_brief() -> None:
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
        thread_metadata={
            "investigation_brief": "Compare west and east revenue.",
        },
    )

    rendered = _build_agent_instructions(
        context,
        instructions="Inspect the available datasets.",
    )

    assert "Inspect the available datasets." in rendered
    assert "Current investigation brief from the user:" in rendered
    assert "Compare west and east revenue." in rendered


def test_build_agent_graph_attaches_surface_key_to_response_metadata() -> None:
    agent_bundle = {
        "root_agent_id": "report-agent",
        "agents": [
            {
                "agent_id": "report-agent",
                "agent_name": "Report",
                "instructions": "Manage reports.",
                "client_tools": [],
                "delegation_targets": [],
            }
        ],
    }
    context = ReportAgentContext(
        report_id="report_123",
        user_id="user_123",
        user_email=None,
        db=None,
        agent_bundle=agent_bundle,
        thread_metadata={"surface_key": "report-agent-tour"},
    )

    agents = _build_agent_graph(
        context,
        agent_bundle=agent_bundle,
        model=None,
    )

    assert agents["report-agent"].model_settings.metadata == {
        "root_agent_id": "report-agent",
        "root_agent_name": "Report",
        "agent_id": "report-agent",
        "agent_name": "Report",
        "surface_key": "report-agent-tour",
    }
