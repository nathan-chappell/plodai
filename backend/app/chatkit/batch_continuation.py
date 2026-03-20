from __future__ import annotations

from collections.abc import Awaitable, Callable

from pydantic import BaseModel, Field

from agents import Agent, Runner


CONTINUE_BATCH_MODEL = "gpt-4.1-mini"
DEFAULT_BATCH_CONTINUATION_INPUT = (
    "Batch mode remains enabled. Continue with the strongest reasonable next step "
    "using the current workspace, available tools, and results so far. Do not ask "
    "the user for confirmation unless you are genuinely blocked."
)
BatchContinuationRunner = Callable[..., Awaitable[object]]


class ContinueBatchDecision(BaseModel):
    should_continue: bool = Field(...)
    reason: str = Field(...)
    next_input: str | None = Field(default=None)


def build_batch_continuation_progress_text(
    decision: ContinueBatchDecision,
) -> str | None:
    if not decision.should_continue:
        return None
    return f"Batch mode is continuing automatically. {decision.reason}"


CONTINUE_BATCH_AGENT = Agent[None](
    name="Continue Batch Agent",
    model=CONTINUE_BATCH_MODEL,
    instructions=(
        "You decide whether a batch-mode agent should continue automatically after its latest reply. "
        "Return should_continue=true only when the latest assistant message is clearly asking for avoidable "
        "confirmation, permission, or a next-step choice that should be inferred in batch mode. "
        "Return should_continue=false when the task looks complete, the assistant is blocked, or the next step "
        "would be speculative beyond the available context. "
        "When continuing, provide a concise next_input that tells the main agent to keep going. "
        "When stopping, next_input must be null. Keep reason short and specific."
    ),
    tools=[],
    output_type=ContinueBatchDecision,
)


async def decide_batch_continuation(
    *,
    capability_id: str | None,
    investigation_brief: str | None,
    latest_assistant_text: str | None,
    run_batch_agent: BatchContinuationRunner | None = None,
) -> ContinueBatchDecision:
    if not latest_assistant_text or not latest_assistant_text.strip():
        return ContinueBatchDecision(
            should_continue=False,
            reason="No assistant message is available to evaluate.",
            next_input=None,
        )

    prompt = "\n".join(
        [
            f"Capability: {capability_id or 'unknown'}",
            f"Investigation brief: {investigation_brief or 'none'}",
            "Latest assistant message:",
            latest_assistant_text.strip(),
        ]
    )
    runner = run_batch_agent if run_batch_agent is not None else Runner.run
    result = await runner(
        CONTINUE_BATCH_AGENT,
        prompt,
        context=None,
        max_turns=1,
    )
    decision = result.final_output_as(
        ContinueBatchDecision,
        raise_if_incorrect_type=True,
    )
    if decision.should_continue and not (
        isinstance(decision.next_input, str) and decision.next_input.strip()
    ):
        return decision.model_copy(
            update={"next_input": DEFAULT_BATCH_CONTINUATION_INPUT}
        )
    if not decision.should_continue:
        return decision.model_copy(update={"next_input": None})
    return decision
