from agents import Agent, handoff
from agents.extensions.handoff_prompt import prompt_with_handoff_instructions
from agents.model_settings import ModelSettings
from chatkit.agents import AgentContext as ChatKitAgentContext

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.tools import build_agent_tools, get_client_tool_names
from backend.app.chatkit.metadata import CapabilityAgentSpec, CapabilityBundle

COMPACTION_THRESHOLD_TOKENS = 200_000

BASE_AGENT_INSTRUCTIONS = """
You are a client-configured agent operating over tools and context declared by the current workspace.

Important operating rules:
1. Use only the registered tools and the current conversation context.
2. Treat the client-declared tool catalog as the source of truth for what local context is available.
3. Prefer bounded, safe operations over raw data dumps or unconstrained exploration.
4. If a required capability is not present in the registered tool catalog, say so plainly instead of inventing one.
""".strip()

CAPABILITY_POLICY: dict[str, dict[str, bool]] = {
    "csv-agent": {"append_report_section": False},
    "chart-agent": {"append_report_section": False},
    "pdf-agent": {"append_report_section": False},
    "report-agent": {"append_report_section": True},
}


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
    return prompt_with_handoff_instructions(
        f"{BASE_AGENT_INSTRUCTIONS}\n\n{instructions}{brief_section}"
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
    stop_at_tool_names = get_client_tool_names(context)
    agents_by_capability_id: dict[str, Agent[ChatKitAgentContext[ReportAgentContext]]] = {}
    capability_specs = {
        capability["capability_id"]: capability
        for capability in capability_bundle.get("capabilities", [])
    }

    for capability_id, capability_spec in capability_specs.items():
        policy = CAPABILITY_POLICY.get(capability_id, {"append_report_section": False})
        agents_by_capability_id[capability_id] = Agent[
            ChatKitAgentContext[ReportAgentContext]
        ](
            name=capability_spec["agent_name"],
            model=model,
            instructions=_build_agent_instructions(
                context,
                instructions=capability_spec["instructions"],
            ),
            tools=list(
                build_agent_tools(
                    context,
                    capability_id=capability_id,
                    allow_append_report_section=policy.get(
                        "append_report_section", False
                    ),
                )
            ),
            model_settings=model_settings,
            handoffs=[],
            tool_use_behavior={"stop_at_tool_names": stop_at_tool_names},
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
