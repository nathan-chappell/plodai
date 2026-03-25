from __future__ import annotations

from agents import Agent
from agents.model_settings import ModelSettings
from chatkit.agents import AgentContext as ChatKitAgentContext
from openai.types.shared import Reasoning

from backend.app.agents.context import FarmAgentContext
from backend.app.agents.tools import build_plodai_tools

COMPACTION_THRESHOLD_TOKENS = 200_000

BASE_INSTRUCTIONS = """
You are PlodAI, a farm operations assistant.

Operating rules:
1. Work only with the current farm record, the current chat, attached farm images, and hosted web search.
2. The farm record schema is strict. Never invent fields outside the canonical record contract.
3. Before proposing record edits, inspect the current farm record if you need its latest state.
4. Save farm record changes only when the user asks for them or when they clearly want the record updated.
5. If the chat still has a generic title, rename it within the first two assistant turns.
6. When attached or tagged farm images are available, use them for visual inspection instead of pretending you can see removed images.
7. Keep responses practical, concise, and grounded in the saved farm record plus current evidence.
""".strip()


def _build_instructions(context: FarmAgentContext) -> str:
    record = context.current_record
    record_summary = (
        [
            f"Farm name: {record.farm_name}",
            f"Location: {record.location or 'unknown'}",
            f"Crops tracked: {len(record.crops)}",
            f"Orders tracked: {len(record.orders)}",
        ]
        if record is not None
        else [
            f"Farm name: {context.farm_name}",
            "No current farm record summary was preloaded.",
        ]
    )
    brief = context.thread_metadata.get("investigation_brief")
    sections = [
        BASE_INSTRUCTIONS,
        "Current farm context:",
        *[f"- {line}" for line in record_summary],
        f"- Existing farm images: {len(context.farm_images)}",
        f"- Previous assistant turns in this chat: {context.assistant_turn_count}",
    ]
    if isinstance(brief, str) and brief.strip():
        sections.extend(
            [
                "",
                "Current investigation brief:",
                f"- {brief.strip()}",
            ]
        )
    return "\n".join(sections)


def _build_model_settings(
    context: FarmAgentContext,
    model_settings_override: ModelSettings | None = None,
) -> ModelSettings:
    settings = ModelSettings(
        parallel_tool_calls=False,
        response_include=["web_search_call.action.sources"],
        metadata={
            "app": "plodai",
            "farm_id": context.farm_id,
            "chat_id": context.chat_id,
        },
        extra_args={
            "safety_identifier": context.user_id[:64],
            "context_management": [
                {
                    "type": "compaction",
                    "compact_threshold": COMPACTION_THRESHOLD_TOKENS,
                }
            ],
        },
    )
    return settings.resolve(model_settings_override)


def build_plodai_agent(
    context: FarmAgentContext,
    *,
    model: str | None,
    model_settings_override: ModelSettings | None = None,
) -> Agent[ChatKitAgentContext[FarmAgentContext]]:
    return Agent[ChatKitAgentContext[FarmAgentContext]](
        name="PlodAI",
        model=model,
        instructions=_build_instructions(context),
        tools=build_plodai_tools(context),
        model_settings=_build_model_settings(
            context,
            model_settings_override=model_settings_override,
        ).resolve(
            ModelSettings(
                reasoning=Reasoning(
                    effort="low",
                    summary="auto",
                )
            )
        ),
    )
