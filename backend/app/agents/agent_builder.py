import logging
from collections.abc import Mapping
from datetime import datetime

from agents import Agent, handoff
from agents.tool import Tool
from agents.extensions.handoff_prompt import prompt_with_handoff_instructions
from agents.model_settings import ModelSettings
from chatkit.agents import AgentContext as ChatKitAgentContext
from chatkit.types import HiddenContextItem, ThreadItemDoneEvent

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.tools import (
    build_agent_tools,
    describe_tool_signature,
    get_client_tool_names,
)
from backend.app.agents.widgets import (
    build_handoff_trace_copy_text,
    build_handoff_trace_widget,
)
from backend.app.chatkit.metadata import AgentSpec, AgentBundle, active_plan_execution
from backend.app.core.logging import get_logger, log_event

COMPACTION_THRESHOLD_TOKENS = 200_000
logger = get_logger("agents.agent_builder")

BASE_AGENT_INSTRUCTIONS = """
You are a client-configured agent operating over tools and context declared by the current workspace.

Important operating rules:
1. Use only the registered tools and the current conversation context.
2. Treat the client-declared tool catalog as the source of truth for what local context is available.
3. Prefer bounded, safe operations over raw data dumps or unconstrained exploration.
4. If a required tool is not present in the registered tool catalog, say so plainly instead of inventing one.
5. When the user's goal is clear enough to act on, continue decisively without asking for unnecessary confirmation.
6. Ask clarifying questions only when missing information, permissions, or tool availability would materially change the result.
7. When you call `make_plan`, include `execution_hints` when you can identify a concrete done condition, preferred tool, or preferred handoff for a step.
""".strip()


def _build_handoff_callback(
    *,
    source_agent_name: str,
    target_agent_name: str,
    handoff_tool_name: str,
):
    async def _on_handoff(run_context) -> None:
        request_context = getattr(run_context.context, "request_context", None)
        thread_metadata = getattr(request_context, "thread_metadata", None)
        if isinstance(thread_metadata, dict) and active_plan_execution(thread_metadata):
            await run_context.context.stream(
                ThreadItemDoneEvent(
                    item=HiddenContextItem(
                        id=run_context.context.generate_id("sdk_hidden_context"),
                        thread_id=run_context.context.thread.id,
                        created_at=datetime.now(),
                        content={
                            "kind": "plan_handoff",
                            "source_agent_name": source_agent_name,
                            "target_agent_name": target_agent_name,
                            "handoff_tool_name": handoff_tool_name,
                            "summary": f"{source_agent_name} -> {target_agent_name}",
                        },
                    )
                )
            )
            return
        await run_context.context.stream_widget(
            build_handoff_trace_widget(
                source_agent_name=source_agent_name,
                target_agent_name=target_agent_name,
            ),
            copy_text=build_handoff_trace_copy_text(
                source_agent_name=source_agent_name,
                target_agent_name=target_agent_name,
            ),
        )

    return _on_handoff


def _build_agent_instructions(
    context: ReportAgentContext,
    *,
    instructions: str,
) -> str:
    sections = [BASE_AGENT_INSTRUCTIONS, instructions.strip()]

    investigation_brief = context.thread_metadata.get("investigation_brief")
    if investigation_brief:
        sections.append(
            "\n".join(
                [
                    "Current investigation brief from the user:",
                    f"- {investigation_brief}",
                    "Treat this as the primary objective for the conversation unless newer user messages clearly replace it.",
                ]
            )
        )
    return prompt_with_handoff_instructions("\n\n".join(sections))


def _build_response_api_metadata(
    context: ReportAgentContext,
    *,
    agent_spec: AgentSpec,
) -> dict[str, str] | None:
    agent_bundle = context.agent_bundle
    root_agent_id = (
        agent_bundle.get("root_agent_id")
        if agent_bundle is not None
        else None
    )
    root_agent_spec = context.get_agent_spec(root_agent_id)
    surface_key = context.thread_metadata.get("surface_key")

    metadata: dict[str, str] = {}
    if root_agent_id:
        metadata["root_agent_id"] = root_agent_id
    if root_agent_spec is not None:
        metadata["root_agent_name"] = root_agent_spec["agent_name"]

    metadata["agent_id"] = agent_spec["agent_id"]
    metadata["agent_name"] = agent_spec["agent_name"]

    if isinstance(surface_key, str) and surface_key.strip():
        metadata["surface_key"] = surface_key.strip()

    return metadata or None


def _build_model_settings(
    context: ReportAgentContext,
    *,
    agent_spec: AgentSpec,
) -> ModelSettings:
    safety_identifier = context.user_id[:64]
    return ModelSettings(
        parallel_tool_calls=False,
        metadata=_build_response_api_metadata(
            context,
            agent_spec=agent_spec,
        ),
        extra_args={
            "safety_identifier": safety_identifier,
            "context_management": [
                {
                    "type": "compaction",
                    "compact_threshold": COMPACTION_THRESHOLD_TOKENS,
                }
            ],
        },
    )


def _build_agent_graph(
    context: ReportAgentContext,
    *,
    agent_bundle: AgentBundle,
    model: str | None,
) -> dict[str, Agent[ChatKitAgentContext[ReportAgentContext]]]:
    agents_by_agent_id: dict[
        str, Agent[ChatKitAgentContext[ReportAgentContext]]
    ] = {}
    agent_specs = {
        agent_spec["agent_id"]: agent_spec
        for agent_spec in agent_bundle.get("agents", [])
    }
    tool_stop_overrides: dict[str, list[str]] = {
        "feedback-agent": ["get_feedback", "send_feedback"],
    }

    for agent_id, agent_spec in agent_specs.items():
        client_tools = agent_spec.get("client_tools", [])
        tool_names = get_client_tool_names(client_tools)
        stop_at_tool_names = [
            tool_name
            for tool_name in [
                *tool_names,
                *tool_stop_overrides.get(agent_id, []),
            ]
        ]
        compiled_tools = list(
            build_agent_tools(
                context,
                agent_id=agent_id,
                client_tools=client_tools,
            )
        )
        handoff_agent_names = [
            agent_specs[target["agent_id"]]["agent_name"]
            for target in agent_spec.get("delegation_targets", [])
            if target["agent_id"] in agent_specs
        ]
        agent_heading = (
            f"{agent_spec['agent_name']}({', '.join(handoff_agent_names)}):"
            if handoff_agent_names
            else f"{agent_spec['agent_name']}:"
        )
        rendered_lines = [
            agent_heading,
            *(
                f"- {_describe_compiled_tool(tool)}"
                for tool in compiled_tools
            ),
        ]
        if len(rendered_lines) == 1:
            rendered_lines.append("- no tools")
        log_event(
            logger,
            logging.DEBUG,
            "agent.compiled",
            rendered=rendered_lines,
            dedupe=True,
        )
        agents_by_agent_id[agent_id] = Agent[
            ChatKitAgentContext[ReportAgentContext]
        ](
            name=agent_spec["agent_name"],
            model=model,
            instructions=_build_agent_instructions(
                context,
                instructions=agent_spec["instructions"],
            ),
            tools=compiled_tools,
            model_settings=_build_model_settings(
                context,
                agent_spec=agent_spec,
            ),
            handoffs=[],
            tool_use_behavior={"stop_at_tool_names": stop_at_tool_names},
        )

    for agent_id, agent_spec in agent_specs.items():
        agent = agents_by_agent_id[agent_id]
        agent.handoffs = [
            handoff(
                agent=agents_by_agent_id[target["agent_id"]],
                tool_name_override=target["tool_name"],
                tool_description_override=target["description"],
                on_handoff=_build_handoff_callback(
                    source_agent_name=agent_spec["agent_name"],
                    target_agent_name=agents_by_agent_id[
                        target["agent_id"]
                    ].name,
                    handoff_tool_name=target["tool_name"],
                ),
            )
            for target in agent_spec.get("delegation_targets", [])
            if target["agent_id"] in agents_by_agent_id
        ]

    return agents_by_agent_id


def _describe_compiled_tool(tool: Tool) -> str:
    params_json_schema = getattr(tool, "params_json_schema", None)
    if isinstance(params_json_schema, Mapping):
        return describe_tool_signature(tool.name, params_json_schema)
    return f"{tool.name}()"


def build_registered_agent(
    context: ReportAgentContext,
    *,
    model: str | None = None,
) -> Agent[ChatKitAgentContext[ReportAgentContext]]:
    agent_bundle = context.agent_bundle
    if agent_bundle is None:
        raise RuntimeError(
            "No registered agent bundle is available for this thread."
        )

    root_agent_id = agent_bundle["root_agent_id"]
    agents_by_agent_id = _build_agent_graph(
        context,
        agent_bundle=agent_bundle,
        model=model,
    )
    root_agent = agents_by_agent_id.get(root_agent_id)
    if root_agent is None:
        raise RuntimeError(
            "Agent bundle does not define root agent "
            f"'{root_agent_id}'."
        )
    return root_agent


def get_agent_graph_agent_ids(
    agent_bundle: AgentBundle,
) -> list[str]:
    return [
        agent_spec["agent_id"]
        for agent_spec in agent_bundle.get("agents", [])
    ]


def get_agent_spec(
    agent_bundle: AgentBundle,
    agent_id: str,
) -> AgentSpec | None:
    return next(
        (
            agent_spec
            for agent_spec in agent_bundle.get("agents", [])
            if agent_spec.get("agent_id") == agent_id
        ),
        None,
    )


get_agent_graph_agent_ids = get_agent_graph_agent_ids
get_agent_spec = get_agent_spec
