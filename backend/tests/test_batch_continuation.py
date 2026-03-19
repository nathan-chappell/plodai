import asyncio
from types import SimpleNamespace

from backend.app.chatkit.batch_continuation import (
    ContinueBatchDecision,
    DEFAULT_BATCH_CONTINUATION_INPUT,
    decide_batch_continuation,
)


def test_decide_batch_continuation_stops_without_assistant_text() -> None:
    decision = asyncio.run(
        decide_batch_continuation(
            capability_id="report-agent",
            investigation_brief="Investigate performance.",
            latest_assistant_text=None,
        )
    )

    assert decision.should_continue is False
    assert decision.next_input is None


def test_decide_batch_continuation_fills_default_next_input() -> None:
    async def fake_run(*args, **kwargs):
        return SimpleNamespace(
            final_output_as=lambda cls, raise_if_incorrect_type=False: ContinueBatchDecision(
                should_continue=True,
                reason="The assistant only asked for avoidable confirmation.",
                next_input=None,
            )
        )

    decision = asyncio.run(
        decide_batch_continuation(
            capability_id="report-agent",
            investigation_brief="Investigate performance.",
            latest_assistant_text="Would you like me to create the report now?",
            run_batch_agent=fake_run,
        )
    )

    assert decision.should_continue is True
    assert decision.next_input == DEFAULT_BATCH_CONTINUATION_INPUT
