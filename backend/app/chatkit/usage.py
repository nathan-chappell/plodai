from typing import TypedDict

from agents.usage import Usage


class ModelPricing(TypedDict):
    input_per_million: float
    cached_input_per_million: float
    output_per_million: float


class ThreadUsageTotals(TypedDict):
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float


MODEL_PRICING: dict[str, ModelPricing] = {
    "gpt-4.1-mini": {
        "input_per_million": 0.40,
        "cached_input_per_million": 0.10,
        "output_per_million": 1.60,
    },
    "gpt-4.1": {
        "input_per_million": 2.00,
        "cached_input_per_million": 0.50,
        "output_per_million": 8.00,
    },
    "gpt-5.1": {
        "input_per_million": 1.25,
        "cached_input_per_million": 0.125,
        "output_per_million": 10.00,
    },
}

TRANSCRIPTION_PRICING_PER_MINUTE: dict[str, float] = {
    "gpt-4o-mini-transcribe": 0.003,
}


def empty_usage_totals() -> ThreadUsageTotals:
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "estimated_cost_usd": 0.0,
    }


def estimate_usage_cost_usd(model: str | None, usage: Usage) -> float:
    if not model:
        return 0.0
    pricing = MODEL_PRICING.get(model)
    if pricing is None:
        return 0.0

    cached_input_tokens = usage.input_tokens_details.cached_tokens or 0
    non_cached_input_tokens = max((usage.input_tokens or 0) - cached_input_tokens, 0)
    return (
        (non_cached_input_tokens * pricing["input_per_million"]) / 1_000_000
        + (cached_input_tokens * pricing["cached_input_per_million"]) / 1_000_000
        + ((usage.output_tokens or 0) * pricing["output_per_million"]) / 1_000_000
    )


def estimate_transcription_cost_usd(model: str, seconds: float) -> float:
    per_minute = TRANSCRIPTION_PRICING_PER_MINUTE.get(model)
    if per_minute is None:
        return 0.0
    return (seconds / 60.0) * per_minute


def accumulate_usage(
    current: ThreadUsageTotals | None,
    usage: Usage,
    *,
    model: str | None,
) -> ThreadUsageTotals:
    merged = empty_usage_totals()
    if current is not None:
        merged["input_tokens"] = int(current.get("input_tokens", 0))
        merged["output_tokens"] = int(current.get("output_tokens", 0))
        merged["estimated_cost_usd"] = float(current.get("estimated_cost_usd", 0.0))

    merged["input_tokens"] += int(usage.input_tokens or 0)
    merged["output_tokens"] += int(usage.output_tokens or 0)
    merged["estimated_cost_usd"] = round(
        merged["estimated_cost_usd"] + estimate_usage_cost_usd(model, usage),
        8,
    )
    return merged


def accumulate_transcription_usage(
    current: ThreadUsageTotals | None,
    *,
    model: str,
    seconds: float,
) -> ThreadUsageTotals:
    merged = empty_usage_totals()
    if current is not None:
        merged["input_tokens"] = int(current.get("input_tokens", 0))
        merged["output_tokens"] = int(current.get("output_tokens", 0))
        merged["estimated_cost_usd"] = float(current.get("estimated_cost_usd", 0.0))

    merged["estimated_cost_usd"] = round(
        merged["estimated_cost_usd"] + estimate_transcription_cost_usd(model, seconds),
        8,
    )
    return merged


def platform_logs_url(identifier: str | None) -> str | None:
    if not identifier:
        return None
    return f"https://platform.openai.com/logs/{identifier}"
