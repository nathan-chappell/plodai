from typing import Literal, NotRequired, TypeAlias, TypedDict

from backend.app.chatkit.usage import ThreadUsageTotals, empty_usage_totals


JsonSchemaPrimitive: TypeAlias = str | int | float | bool | None


class JsonSchema(TypedDict, total=False):
    type: str
    description: str
    title: str
    enum: list[JsonSchemaPrimitive]
    anyOf: list["JsonSchema"]
    items: "JsonSchema"
    properties: dict[str, "JsonSchema"]
    required: list[str]
    additionalProperties: bool
    minimum: int | float
    maximum: int | float


class AnalysisPlan(TypedDict):
    focus: str
    planned_steps: list[str]
    chart_opportunities: NotRequired[list[str]]
    success_criteria: NotRequired[list[str]]


class ClientToolDefinition(TypedDict, total=False):
    type: Literal["function"]
    name: str
    description: str
    parameters: JsonSchema
    strict: bool


class CapabilityManifest(TypedDict):
    capability_id: str
    agent_name: str
    instructions: str
    client_tools: list[ClientToolDefinition]


class ThreadMetadataPatch(TypedDict, total=False):
    title: str
    investigation_brief: str
    analysis_plan: AnalysisPlan
    chart_cache: dict[str, str]
    openai_conversation_id: str
    openai_previous_response_id: str
    usage: ThreadUsageTotals
    capability_manifest: CapabilityManifest


class AppThreadMetadata(TypedDict, total=False):
    title: str
    investigation_brief: str
    analysis_plan: AnalysisPlan
    chart_cache: dict[str, str]
    openai_conversation_id: str
    openai_previous_response_id: str
    usage: ThreadUsageTotals
    capability_manifest: CapabilityManifest


def _normalize_usage(raw_usage: object) -> ThreadUsageTotals | None:
    if not isinstance(raw_usage, dict):
        return None

    usage = empty_usage_totals()
    usage["input_tokens"] = int(raw_usage.get("input_tokens", 0))
    usage["output_tokens"] = int(raw_usage.get("output_tokens", 0))
    usage["cost_usd"] = round(
        float(raw_usage.get("cost_usd", 0.0)),
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


def _is_strict_json_schema(raw_schema: object) -> bool:
    if not isinstance(raw_schema, dict):
        return False
    schema_type = raw_schema.get("type")
    if isinstance(schema_type, str):
        if schema_type == "object":
            properties = raw_schema.get("properties")
            if not isinstance(properties, dict):
                return False
            if raw_schema.get("additionalProperties") is not False:
                return False
            return all(_is_strict_json_schema(value) for value in properties.values())
        if schema_type == "array":
            return _is_strict_json_schema(raw_schema.get("items"))
        if schema_type in {"string", "number", "integer", "boolean", "null"}:
            return True
        return False
    if "properties" in raw_schema:
        return False
    if "items" in raw_schema:
        return False
    if "anyOf" in raw_schema:
        any_of = raw_schema.get("anyOf")
        if not isinstance(any_of, list) or not any_of:
            return False
        return all(_is_strict_json_schema(value) for value in any_of)
    if "enum" in raw_schema:
        enum_values = raw_schema.get("enum")
        return isinstance(enum_values, list) and bool(enum_values)
    return False


def _normalize_client_tools(raw_tools: object) -> list[ClientToolDefinition] | None:
    if not isinstance(raw_tools, list):
        return None

    tools: list[ClientToolDefinition] = []
    for raw_tool in raw_tools:
        if not isinstance(raw_tool, dict):
            continue
        name = raw_tool.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        parameters = raw_tool.get("parameters")
        if not _is_strict_json_schema(parameters):
            continue
        tool: ClientToolDefinition = {
            "type": "function",
            "name": name.strip(),
            "description": str(raw_tool.get("description", "")).strip(),
            "parameters": parameters,
            "strict": bool(raw_tool.get("strict", True)),
        }
        tools.append(tool)

    return tools


def _normalize_capability_manifest(raw_manifest: object) -> CapabilityManifest | None:
    if not isinstance(raw_manifest, dict):
        return None

    capability_id = raw_manifest.get("capability_id")
    agent_name = raw_manifest.get("agent_name")
    instructions = raw_manifest.get("instructions")
    client_tools = _normalize_client_tools(raw_manifest.get("client_tools"))

    if not isinstance(capability_id, str) or not capability_id.strip():
        return None
    if not isinstance(agent_name, str) or not agent_name.strip():
        return None
    if not isinstance(instructions, str) or not instructions.strip():
        return None
    if client_tools is None:
        return None

    return {
        "capability_id": capability_id.strip(),
        "agent_name": agent_name.strip(),
        "instructions": instructions.strip(),
        "client_tools": client_tools,
    }


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

    capability_manifest = _normalize_capability_manifest(
        raw_metadata.get("capability_manifest")
    )
    if capability_manifest is not None:
        metadata["capability_manifest"] = capability_manifest

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
