from typing import TypedDict

from backend.app.chatkit.usage import ThreadUsageTotals, empty_usage_totals


class ThreadMetadataPatch(TypedDict, total=False):
    title: str
    investigation_brief: str
    chart_cache: dict[str, str]
    openai_conversation_id: str
    openai_previous_response_id: str
    usage: ThreadUsageTotals


class AppThreadMetadata(TypedDict, total=False):
    title: str
    investigation_brief: str
    chart_cache: dict[str, str]
    openai_conversation_id: str
    openai_previous_response_id: str
    usage: ThreadUsageTotals


def _normalize_usage(raw_usage: object) -> ThreadUsageTotals | None:
    if not isinstance(raw_usage, dict):
        return None

    usage = empty_usage_totals()
    usage["input_tokens"] = int(raw_usage.get("input_tokens", 0))
    usage["output_tokens"] = int(raw_usage.get("output_tokens", 0))
    usage["estimated_cost_usd"] = round(
        float(raw_usage.get("estimated_cost_usd", 0.0)),
        8,
    )
    return usage


def normalize_thread_metadata(raw_metadata: object | None) -> AppThreadMetadata:
    if not isinstance(raw_metadata, dict):
        return {}

    metadata: AppThreadMetadata = {}

    title = raw_metadata.get("title")
    if isinstance(title, str) and title:
        metadata["title"] = title

    investigation_brief = raw_metadata.get("investigation_brief")
    if isinstance(investigation_brief, str) and investigation_brief.strip():
        metadata["investigation_brief"] = investigation_brief.strip()

    chart_cache = raw_metadata.get("chart_cache")
    if isinstance(chart_cache, dict):
        metadata["chart_cache"] = {
            str(key): str(value)
            for key, value in chart_cache.items()
            if isinstance(key, str) and isinstance(value, str)
        }

    conversation_id = raw_metadata.get("openai_conversation_id")
    if isinstance(conversation_id, str) and conversation_id:
        metadata["openai_conversation_id"] = conversation_id

    previous_response_id = raw_metadata.get("openai_previous_response_id")
    if isinstance(previous_response_id, str) and previous_response_id:
        metadata["openai_previous_response_id"] = previous_response_id

    usage = _normalize_usage(raw_metadata.get("usage"))
    if usage is not None:
        metadata["usage"] = usage

    return metadata


def merge_thread_metadata(
    current: AppThreadMetadata, patch: ThreadMetadataPatch
) -> AppThreadMetadata:
    merged: AppThreadMetadata = {**current}
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged
