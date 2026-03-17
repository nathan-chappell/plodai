from typing import Literal, NotRequired, TypeAlias, TypeGuard, TypedDict

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


class AgentPlan(TypedDict):
    id: str
    focus: str
    planned_steps: list[str]
    success_criteria: NotRequired[list[str]]
    follow_on_tool_hints: NotRequired[list[str]]
    created_at: NotRequired[str]


class ClientToolDefinition(TypedDict, total=False):
    type: Literal["function"]
    name: str
    description: str
    parameters: JsonSchema
    strict: bool


class CapabilityHandoffTarget(TypedDict):
    capability_id: str
    tool_name: str
    description: str


class CapabilityAgentSpec(TypedDict):
    capability_id: str
    agent_name: str
    instructions: str
    client_tools: list[ClientToolDefinition]
    handoff_targets: list[CapabilityHandoffTarget]


class CapabilityBundle(TypedDict):
    root_capability_id: str
    capabilities: list[CapabilityAgentSpec]


class ThreadMetadataPatch(TypedDict, total=False):
    title: str
    investigation_brief: str
    plan: AgentPlan
    chart_plan: AgentPlan
    chart_cache: dict[str, str]
    surface_key: str
    openai_conversation_id: str
    openai_previous_response_id: str
    usage: ThreadUsageTotals
    capability_bundle: CapabilityBundle


class AppThreadMetadata(TypedDict, total=False):
    title: str
    investigation_brief: str
    plan: AgentPlan
    chart_plan: AgentPlan
    chart_cache: dict[str, str]
    surface_key: str
    openai_conversation_id: str
    openai_previous_response_id: str
    usage: ThreadUsageTotals
    capability_bundle: CapabilityBundle


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


def _normalize_agent_plan(raw_plan: object) -> AgentPlan | None:
    if not isinstance(raw_plan, dict):
        return None

    plan_id = raw_plan.get("id")
    focus = raw_plan.get("focus")
    planned_steps = raw_plan.get("planned_steps")
    if not isinstance(plan_id, str) or not plan_id.strip():
        return None
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

    plan: AgentPlan = {
        "id": plan_id.strip(),
        "focus": focus.strip(),
        "planned_steps": normalized_steps,
    }

    raw_success_criteria = raw_plan.get("success_criteria")
    if isinstance(raw_success_criteria, list):
        success_criteria = [
            str(item).strip()
            for item in raw_success_criteria
            if isinstance(item, str) and item.strip()
        ]
        if success_criteria:
            plan["success_criteria"] = success_criteria

    raw_follow_on_tool_hints = raw_plan.get("follow_on_tool_hints")
    if isinstance(raw_follow_on_tool_hints, list):
        follow_on_tool_hints = [
            str(item).strip()
            for item in raw_follow_on_tool_hints
            if isinstance(item, str) and item.strip()
        ]
        if follow_on_tool_hints:
            plan["follow_on_tool_hints"] = follow_on_tool_hints

    created_at = raw_plan.get("created_at")
    if isinstance(created_at, str) and created_at.strip():
        plan["created_at"] = created_at.strip()

    return plan


def _is_strict_json_schema(raw_schema: object) -> TypeGuard[JsonSchema]:
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


def _normalize_handoff_targets(
    raw_handoff_targets: object,
) -> list[CapabilityHandoffTarget] | None:
    if not isinstance(raw_handoff_targets, list):
        return None

    handoff_targets: list[CapabilityHandoffTarget] = []
    for raw_handoff_target in raw_handoff_targets:
        if not isinstance(raw_handoff_target, dict):
            continue
        capability_id = raw_handoff_target.get("capability_id")
        tool_name = raw_handoff_target.get("tool_name")
        description = raw_handoff_target.get("description")
        if not isinstance(capability_id, str) or not capability_id.strip():
            continue
        if not isinstance(tool_name, str) or not tool_name.strip():
            continue
        if not isinstance(description, str) or not description.strip():
            continue
        handoff_targets.append(
            {
                "capability_id": capability_id.strip(),
                "tool_name": tool_name.strip(),
                "description": description.strip(),
            }
        )
    return handoff_targets


def _normalize_capability_agent_spec(
    raw_capability_agent_spec: object,
) -> CapabilityAgentSpec | None:
    if not isinstance(raw_capability_agent_spec, dict):
        return None

    capability_id = raw_capability_agent_spec.get("capability_id")
    agent_name = raw_capability_agent_spec.get("agent_name")
    instructions = raw_capability_agent_spec.get("instructions")
    client_tools = _normalize_client_tools(raw_capability_agent_spec.get("client_tools"))
    handoff_targets = _normalize_handoff_targets(
        raw_capability_agent_spec.get("handoff_targets")
    )

    if not isinstance(capability_id, str) or not capability_id.strip():
        return None
    if not isinstance(agent_name, str) or not agent_name.strip():
        return None
    if not isinstance(instructions, str) or not instructions.strip():
        return None
    if client_tools is None:
        return None
    if handoff_targets is None:
        return None

    return {
        "capability_id": capability_id.strip(),
        "agent_name": agent_name.strip(),
        "instructions": instructions.strip(),
        "client_tools": client_tools,
        "handoff_targets": handoff_targets,
    }


def _normalize_capability_bundle(raw_bundle: object) -> CapabilityBundle | None:
    if not isinstance(raw_bundle, dict):
        return None
    root_capability_id = raw_bundle.get("root_capability_id")
    raw_capabilities = raw_bundle.get("capabilities")
    if not isinstance(root_capability_id, str) or not root_capability_id.strip():
        return None
    if not isinstance(raw_capabilities, list):
        return None
    capabilities = [
        capability
        for raw_capability in raw_capabilities
        if (capability := _normalize_capability_agent_spec(raw_capability)) is not None
    ]
    if not capabilities:
        return None
    if root_capability_id.strip() not in {
        capability["capability_id"] for capability in capabilities
    }:
        return None
    return {
        "root_capability_id": root_capability_id.strip(),
        "capabilities": capabilities,
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

    plan = _normalize_agent_plan(raw_metadata.get("plan"))
    if plan is not None:
        metadata["plan"] = plan

    chart_plan = _normalize_agent_plan(raw_metadata.get("chart_plan"))
    if chart_plan is not None:
        metadata["chart_plan"] = chart_plan

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

    surface_key = raw_metadata.get("surface_key")
    if isinstance(surface_key, str) and surface_key.strip():
        metadata["surface_key"] = surface_key.strip()

    capability_bundle = _normalize_capability_bundle(raw_metadata.get("capability_bundle"))
    if capability_bundle is not None:
        metadata["capability_bundle"] = capability_bundle

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
