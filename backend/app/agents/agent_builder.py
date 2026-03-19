import logging

from agents import Agent, handoff
from agents.extensions.handoff_prompt import prompt_with_handoff_instructions
from agents.model_settings import ModelSettings
from chatkit.agents import AgentContext as ChatKitAgentContext

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.tools import (
    build_agent_tools,
    describe_tool_signature,
    get_client_tool_names,
)
from backend.app.chatkit.metadata import CapabilityAgentSpec, CapabilityBundle
from backend.app.core.logging import get_logger, log_event

COMPACTION_THRESHOLD_TOKENS = 200_000
logger = get_logger("agents.agent_builder")

BASE_AGENT_INSTRUCTIONS = """
You are a client-configured agent operating over tools and context declared by the current workspace.

Important operating rules:
1. Use only the registered tools and the current conversation context.
2. Treat the client-declared tool catalog as the source of truth for what local context is available.
3. Prefer bounded, safe operations over raw data dumps or unconstrained exploration.
4. If a required capability is not present in the registered tool catalog, say so plainly instead of inventing one.
5. When the user's goal is clear enough to act on, continue decisively without asking for unnecessary confirmation.
6. Ask clarifying questions only when missing information, permissions, or tool availability would materially change the result.
""".strip()

BATCH_MODE_INSTRUCTIONS = """
Execution mode: batch.

In batch mode, complete as much of the task as possible without engaging the user in back-and-forth.
- Infer reasonable defaults when the next step is obvious from the request and current workspace context.
- Prefer executing the strongest sensible next action over asking for confirmation.
- Stop only when you are genuinely blocked by missing data, permissions, or unavailable capabilities.
""".strip()

def _build_agent_instructions(
    context: ReportAgentContext,
    *,
    instructions: str,
) -> str:
    investigation_brief = context.thread_metadata.get("investigation_brief")
    brief_section = ""
    if investigation_brief:
        brief_section = (
            "\nCurrent investigation brief from the user:\n"
            f"- {investigation_brief}\n"
            "Treat this as the primary objective for the conversation unless newer user messages clearly replace it.\n"
        )
    mode_section = ""
    if context.is_batch_mode:
        mode_section = f"\n{BATCH_MODE_INSTRUCTIONS}\n"
    return prompt_with_handoff_instructions(
        f"{BASE_AGENT_INSTRUCTIONS}\n\n{instructions}{brief_section}{mode_section}"
    )


def _build_model_settings(context: ReportAgentContext) -> ModelSettings:
    safety_identifier = context.user_id[:64]
    return ModelSettings(
        parallel_tool_calls=False,
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
    capability_bundle: CapabilityBundle,
    model: str | None,
) -> dict[str, Agent[ChatKitAgentContext[ReportAgentContext]]]:
    model_settings = _build_model_settings(context)
    agents_by_capability_id: dict[str, Agent[ChatKitAgentContext[ReportAgentContext]]] = {}
    capability_specs = {
        capability["capability_id"]: capability
        for capability in capability_bundle.get("capabilities", [])
    }

    for capability_id, capability_spec in capability_specs.items():
        client_tools = capability_spec.get("client_tools", [])
        tool_names = get_client_tool_names(client_tools)
        compiled_tools = list(
            build_agent_tools(
                context,
                capability_id=capability_id,
                client_tools=client_tools,
            )
        )
        handoff_agent_names = [
            capability_specs[target["capability_id"]]["agent_name"]
            for target in capability_spec.get("handoff_targets", [])
            if target["capability_id"] in capability_specs
        ]
        agent_heading = (
            f"{capability_spec['agent_name']}({', '.join(handoff_agent_names)}):"
            if handoff_agent_names
            else f"{capability_spec['agent_name']}:"
        )
        rendered_lines = [
            agent_heading,
            *(
                f"- {describe_tool_signature(tool.name, tool.params_json_schema)}"
                for tool in compiled_tools
            ),
        ]
        if len(rendered_lines) == 1:
            rendered_lines.append("- no tools")
        log_event(
            logger,
            logging.DEBUG,
            "agent.capability_compiled",
            rendered=rendered_lines,
            dedupe=True,
        )
        agents_by_capability_id[capability_id] = Agent[
            ChatKitAgentContext[ReportAgentContext]
        ](
            name=capability_spec["agent_name"],
            model=model,
            instructions=_build_agent_instructions(
                context,
                instructions=capability_spec["instructions"],
            ),
            tools=compiled_tools,
            model_settings=model_settings,
            handoffs=[],
            tool_use_behavior={
                "stop_at_tool_names": tool_names
            },
        )

    for capability_id, capability_spec in capability_specs.items():
        agent = agents_by_capability_id[capability_id]
        agent.handoffs = [
            handoff(
                agent=agents_by_capability_id[target["capability_id"]],
                tool_name_override=target["tool_name"],
                tool_description_override=target["description"],
            )
            for target in capability_spec.get("handoff_targets", [])
            if target["capability_id"] in agents_by_capability_id
        ]

    return agents_by_capability_id


def build_registered_agent(
    context: ReportAgentContext,
    *,
    model: str | None = None,
) -> Agent[ChatKitAgentContext[ReportAgentContext]]:
    capability_bundle = context.capability_bundle
    if capability_bundle is None:
        raise RuntimeError(
            "No registered capability bundle is available for this thread."
        )

    root_capability_id = capability_bundle["root_capability_id"]
    agents_by_capability_id = _build_agent_graph(
        context,
        capability_bundle=capability_bundle,
        model=model,
    )
    root_agent = agents_by_capability_id.get(root_capability_id)
    if root_agent is None:
        raise RuntimeError(
            f"Capability bundle does not define root capability '{root_capability_id}'."
        )
    return root_agent


def get_agent_graph_capability_ids(
    capability_bundle: CapabilityBundle,
) -> list[str]:
    return [
        capability_spec["capability_id"]
        for capability_spec in capability_bundle.get("capabilities", [])
    ]


def get_capability_spec(
    capability_bundle: CapabilityBundle,
    capability_id: str,
) -> CapabilityAgentSpec | None:
    return next(
        (
            capability_spec
            for capability_spec in capability_bundle.get("capabilities", [])
            if capability_spec.get("capability_id") == capability_id
        ),
        None,
    )
