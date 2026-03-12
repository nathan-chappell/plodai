from typing import NotRequired, TypedDict

from backend.app.chatkit.usage import ThreadUsageTotals, empty_usage_totals


class AnalysisPlan(TypedDict):
    focus: str
    planned_steps: list[str]
    chart_opportunities: NotRequired[list[str]]
    success_criteria: NotRequired[list[str]]


class ThreadMetadataPatch(TypedDict, total=False):
    title: str
    investigation_brief: str
    analysis_plan: AnalysisPlan
    chart_cache: dict[str, str]
    openai_conversation_id: str
    openai_previous_response_id: str
    usage: ThreadUsageTotals


class AppThreadMetadata(TypedDict, total=False):
    title: str
    investigation_brief: str
    analysis_plan: AnalysisPlan
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


def _normalize_analysis_plan(raw_plan: object) -> AnalysisPlan | None:
    if not isinstance(raw_plan, dict):
        return None

    focus = raw_plan.get("focus")
    planned_steps = raw_plan.get("planned_steps")
    if not isinstance(focus, str) or not focus.strip():
        return None
    if not isinstance(planned_steps, list):
        return None

    normalized_steps = [
        str(step).strip()
        for step in planned_steps
        if isinstance(step, str) and step.strip()
    ]
    if not normalized_steps:
        return None

    plan: AnalysisPlan = {
        "focus": focus.strip(),
        "planned_steps": normalized_steps,
    }

    raw_chart_opportunities = raw_plan.get("chart_opportunities")
    if isinstance(raw_chart_opportunities, list):
        chart_opportunities = [
            str(item).strip()
            for item in raw_chart_opportunities
            if isinstance(item, str) and item.strip()
        ]
        if chart_opportunities:
            plan["chart_opportunities"] = chart_opportunities

    raw_success_criteria = raw_plan.get("success_criteria")
    if isinstance(raw_success_criteria, list):
        success_criteria = [
            str(item).strip()
            for item in raw_success_criteria
            if isinstance(item, str) and item.strip()
        ]
        if success_criteria:
            plan["success_criteria"] = success_criteria

    return plan


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

    analysis_plan = _normalize_analysis_plan(raw_metadata.get("analysis_plan"))
    if analysis_plan is not None:
        metadata["analysis_plan"] = analysis_plan

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
