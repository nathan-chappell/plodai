from agents import Agent
from agents.model_settings import ModelSettings
from chatkit.agents import AgentContext as ChatKitAgentContext

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.tools import build_agent_tools, get_client_tool_names

COMPACTION_THRESHOLD_TOKENS = 200_000

BASE_AGENT_INSTRUCTIONS = """
You are a client-configured agent operating over tools and context declared by the current workspace.

Important operating rules:
1. Use only the registered tools and the current conversation context.
2. Treat the client-declared tool catalog as the source of truth for what local context is available.
3. Prefer bounded, safe operations over raw data dumps or unconstrained exploration.
4. If a required capability is not present in the registered tool catalog, say so plainly instead of inventing one.
""".strip()


def build_registered_agent(
    context: ReportAgentContext,
    *,
    model: str | None = None,
) -> Agent[ChatKitAgentContext[ReportAgentContext]]:
    manifest = context.capability_manifest
    if manifest is None:
        raise RuntimeError(
            "No registered capability manifest is available for this thread. "
            "The client must register the capability manifest before agent execution."
        )

    investigation_brief = context.thread_metadata.get("investigation_brief")
    brief_section = ""
    if investigation_brief:
        brief_section = (
            "\nCurrent investigation brief from the user:\n"
            f"- {investigation_brief}\n"
            "Treat this as the primary objective for the conversation unless newer user messages clearly replace it.\n"
        )

    instructions = (
        f"{BASE_AGENT_INSTRUCTIONS}\n\n"
        f"{manifest['instructions']}"
        f"{brief_section}"
    )
    safety_identifier = context.user_id[:64]

    return Agent[ChatKitAgentContext[ReportAgentContext]](
        name=manifest["agent_name"],
        model=model,
        instructions=instructions,
        tools=list(build_agent_tools(context)),
        model_settings=ModelSettings(
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
        ),
        tool_use_behavior={
            "stop_at_tool_names": get_client_tool_names(context),
        },
    )
