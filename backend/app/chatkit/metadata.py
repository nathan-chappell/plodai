from typing import Any, Literal, NotRequired, TypeAlias, TypeGuard, TypedDict, cast

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from backend.app.chatkit.feedback_types import FeedbackKind, FeedbackOrigin
from backend.app.chatkit.usage import ThreadUsageTotals


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
    display: "ToolDisplaySpec"


class ToolDisplaySpec(TypedDict, total=False):
    label: str
    prominent_args: list[str]
    omit_args: list[str]
    arg_labels: dict[str, str]


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


class WorkspaceContext(TypedDict):
    workspace_id: str
    referenced_item_ids: list[str]


class WorkspaceStateFileSummary(TypedDict, total=False):
    id: str
    name: str
    bucket: str
    producer_key: str
    producer_label: str
    source: Literal["uploaded", "derived", "demo"]
    kind: Literal["csv", "json", "pdf", "other"]
    extension: str
    mime_type: NotRequired[str | None]
    byte_size: NotRequired[int | None]
    row_count: NotRequired[int]
    columns: NotRequired[list[str]]
    numeric_columns: NotRequired[list[str]]
    sample_rows: NotRequired[list[dict[str, object]]]
    page_count: NotRequired[int | None]


class WorkspaceStateReportSummary(TypedDict):
    report_id: str
    title: str
    item_count: int
    slide_count: NotRequired[int]
    updated_at: NotRequired[str | None]


class WorkspaceState(TypedDict):
    version: Literal["v1"]
    context: WorkspaceContext
    files: list[WorkspaceStateFileSummary]
    reports: list[WorkspaceStateReportSummary]
    current_report_id: NotRequired[str | None]
    current_goal: NotRequired[str | None]
    agents_markdown: NotRequired[str | None]


class PendingFeedbackSession(TypedDict):
    session_id: str
    item_ids: list[str]
    recommended_options: list[str]
    message_draft: str | None
    inferred_sentiment: FeedbackKind | None
    mode: Literal["recommendations", "confirmation"]


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
    workspace_state: WorkspaceState
    origin: FeedbackOrigin
    feedback_session: PendingFeedbackSession


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
    workspace_state: WorkspaceState
    origin: FeedbackOrigin
    feedback_session: PendingFeedbackSession


class _MetadataModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


def _strip_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _validated_model_or_none(
    model_cls: type[_MetadataModel],
    value: object,
) -> _MetadataModel | None:
    if value is None:
        return None
    try:
        return model_cls.model_validate(value)
    except ValidationError:
        return None


def _validated_model_list(
    model_cls: type[_MetadataModel],
    value: object,
) -> list[_MetadataModel]:
    if not isinstance(value, list):
        raise ValueError("expected a list")
    validated: list[_MetadataModel] = []
    for raw_item in value:
        try:
            validated.append(model_cls.model_validate(raw_item))
        except ValidationError:
            continue
    return validated


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


class ThreadUsageTotalsModel(_MetadataModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0

    @field_validator("input_tokens", "output_tokens", mode="before")
    @classmethod
    def _coerce_int(cls, value: object) -> int:
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            try:
                return int(value)
            except ValueError:
                return 0
        return 0

    @field_validator("cost_usd", mode="before")
    @classmethod
    def _coerce_cost(cls, value: object) -> float:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return 0.0
        return 0.0

    @field_validator("cost_usd")
    @classmethod
    def _round_cost(cls, value: float) -> float:
        return round(value, 8)


class AgentPlanModel(_MetadataModel):
    id: str
    focus: str
    planned_steps: list[str]
    success_criteria: list[str] | None = None
    follow_on_tool_hints: list[str] | None = None
    created_at: str | None = None

    @field_validator("id", "focus", mode="before")
    @classmethod
    def _required_string(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("created_at", mode="before")
    @classmethod
    def _optional_string(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator("planned_steps", mode="before")
    @classmethod
    def _planned_steps(cls, value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        return [
            item.strip() for item in value if isinstance(item, str) and item.strip()
        ]

    @field_validator("success_criteria", "follow_on_tool_hints", mode="before")
    @classmethod
    def _optional_string_list(cls, value: object) -> list[str] | None:
        if not isinstance(value, list):
            return None
        cleaned = [
            item.strip() for item in value if isinstance(item, str) and item.strip()
        ]
        return cleaned or None

    @model_validator(mode="after")
    def _require_planned_steps(self) -> "AgentPlanModel":
        if not self.planned_steps:
            raise ValueError("planned_steps must contain at least one step")
        return self


class ClientToolDefinitionModel(_MetadataModel):
    type: Literal["function"] = "function"
    name: str
    description: str = ""
    parameters: dict[str, Any]
    strict: bool = True
    display: "ToolDisplaySpecModel | None" = None

    @field_validator("name", mode="before")
    @classmethod
    def _tool_name(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty tool name")
        return text

    @field_validator("description", mode="before")
    @classmethod
    def _tool_description(cls, value: object) -> str:
        return _strip_string(value) or ""

    @field_validator("parameters", mode="before")
    @classmethod
    def _tool_parameters(cls, value: object) -> dict[str, Any]:
        if not _is_strict_json_schema(value):
            raise ValueError("expected a strict JSON schema")
        return cast(dict[str, Any], value)

    @field_validator("strict", mode="before")
    @classmethod
    def _tool_strict(cls, value: object) -> bool:
        return True if value is None else bool(value)

    @field_validator("display", mode="before")
    @classmethod
    def _display(
        cls,
        value: object,
    ) -> "ToolDisplaySpecModel | None":
        validated = _validated_model_or_none(ToolDisplaySpecModel, value)
        return cast(ToolDisplaySpecModel | None, validated)


class ToolDisplaySpecModel(_MetadataModel):
    label: str | None = None
    prominent_args: list[str] | None = None
    omit_args: list[str] | None = None
    arg_labels: dict[str, str] | None = None

    @field_validator("label", mode="before")
    @classmethod
    def _label(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator("prominent_args", "omit_args", mode="before")
    @classmethod
    def _string_list(cls, value: object) -> list[str] | None:
        if not isinstance(value, list):
            return None
        cleaned = [
            item.strip() for item in value if isinstance(item, str) and item.strip()
        ]
        return cleaned or None

    @field_validator("arg_labels", mode="before")
    @classmethod
    def _arg_labels(cls, value: object) -> dict[str, str] | None:
        if not isinstance(value, dict):
            return None
        labels = {
            key.strip(): cleaned
            for key, raw_value in value.items()
            if isinstance(key, str)
            and key.strip()
            and (cleaned := _strip_string(raw_value)) is not None
        }
        return labels or None


class CapabilityHandoffTargetModel(_MetadataModel):
    capability_id: str
    tool_name: str
    description: str

    @field_validator("capability_id", "tool_name", "description", mode="before")
    @classmethod
    def _required_string(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text


class CapabilityAgentSpecModel(_MetadataModel):
    capability_id: str
    agent_name: str
    instructions: str
    client_tools: list[ClientToolDefinitionModel] = Field(default_factory=list)
    handoff_targets: list[CapabilityHandoffTargetModel] = Field(default_factory=list)

    @field_validator("capability_id", "agent_name", "instructions", mode="before")
    @classmethod
    def _required_string(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("client_tools", mode="before")
    @classmethod
    def _client_tools(
        cls,
        value: object,
    ) -> list[ClientToolDefinitionModel]:
        return cast(
            list[ClientToolDefinitionModel],
            _validated_model_list(ClientToolDefinitionModel, value),
        )

    @field_validator("handoff_targets", mode="before")
    @classmethod
    def _handoff_targets(
        cls,
        value: object,
    ) -> list[CapabilityHandoffTargetModel]:
        return cast(
            list[CapabilityHandoffTargetModel],
            _validated_model_list(CapabilityHandoffTargetModel, value),
        )


class CapabilityBundleModel(_MetadataModel):
    root_capability_id: str
    capabilities: list[CapabilityAgentSpecModel]

    @field_validator("root_capability_id", mode="before")
    @classmethod
    def _root_capability_id(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty root_capability_id")
        return text

    @field_validator("capabilities", mode="before")
    @classmethod
    def _capabilities(
        cls,
        value: object,
    ) -> list[CapabilityAgentSpecModel]:
        return cast(
            list[CapabilityAgentSpecModel],
            _validated_model_list(CapabilityAgentSpecModel, value),
        )

    @model_validator(mode="after")
    def _validate_root_capability(self) -> "CapabilityBundleModel":
        if not self.capabilities:
            raise ValueError("capabilities must not be empty")
        capability_ids = {capability.capability_id for capability in self.capabilities}
        if self.root_capability_id not in capability_ids:
            raise ValueError("root_capability_id must be present in capabilities")
        return self


class WorkspaceContextModel(_MetadataModel):
    workspace_id: str
    referenced_item_ids: list[str]

    @field_validator("workspace_id", mode="before")
    @classmethod
    def _workspace_id(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty workspace_id")
        return text

    @field_validator("referenced_item_ids", mode="before")
    @classmethod
    def _referenced_item_ids(cls, value: object) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("expected a list")
        return [
            item.strip() for item in value if isinstance(item, str) and item.strip()
        ]


class WorkspaceStateFileSummaryModel(_MetadataModel):
    id: str
    name: str
    bucket: str | None = None
    producer_key: str | None = None
    producer_label: str | None = None
    source: Literal["uploaded", "derived", "demo"] | None = None
    kind: Literal["csv", "json", "pdf", "other"]
    extension: str
    mime_type: str | None = None
    byte_size: int | None = None
    row_count: int | None = None
    columns: list[str] | None = None
    numeric_columns: list[str] | None = None
    sample_rows: list[dict[str, object]] | None = None
    page_count: int | None = None

    @field_validator("id", "name", "extension", mode="before")
    @classmethod
    def _required_string(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("bucket", "producer_key", "producer_label", mode="before")
    @classmethod
    def _optional_required_string(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator("mime_type", mode="before")
    @classmethod
    def _optional_string(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator("byte_size", "row_count", "page_count", mode="before")
    @classmethod
    def _optional_int(cls, value: object) -> int | None:
        return value if isinstance(value, int) else None

    @field_validator("columns", "numeric_columns", mode="before")
    @classmethod
    def _string_list(cls, value: object) -> list[str] | None:
        if not isinstance(value, list):
            return None
        cleaned = [
            item.strip() for item in value if isinstance(item, str) and item.strip()
        ]
        return cleaned or None

    @field_validator("sample_rows", mode="before")
    @classmethod
    def _sample_rows(cls, value: object) -> list[dict[str, object]] | None:
        if not isinstance(value, list):
            return None
        rows = [
            {str(key): row_value for key, row_value in row.items()}
            for row in value
            if isinstance(row, dict)
        ]
        return rows or None


class WorkspaceStateReportSummaryModel(_MetadataModel):
    report_id: str
    title: str
    item_count: int
    slide_count: int | None = None
    updated_at: str | None = None

    @field_validator("report_id", "title", mode="before")
    @classmethod
    def _required_string(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("updated_at", mode="before")
    @classmethod
    def _optional_string(cls, value: object) -> str | None:
        return _strip_string(value)


class WorkspaceStateModel(_MetadataModel):
    version: Literal["v1"]
    context: WorkspaceContextModel
    files: list[WorkspaceStateFileSummaryModel] = Field(default_factory=list)
    reports: list[WorkspaceStateReportSummaryModel] = Field(default_factory=list)
    current_report_id: str | None = None
    current_goal: str | None = None
    agents_markdown: str | None = None

    @field_validator("context", mode="before")
    @classmethod
    def _context(cls, value: object) -> WorkspaceContextModel:
        validated = _validated_model_or_none(WorkspaceContextModel, value)
        if not isinstance(validated, WorkspaceContextModel):
            raise ValueError("expected a valid workspace context")
        return validated

    @field_validator("files", mode="before")
    @classmethod
    def _files(
        cls,
        value: object,
    ) -> list[WorkspaceStateFileSummaryModel]:
        return cast(
            list[WorkspaceStateFileSummaryModel],
            _validated_model_list(WorkspaceStateFileSummaryModel, value),
        )

    @field_validator("reports", mode="before")
    @classmethod
    def _reports(
        cls,
        value: object,
    ) -> list[WorkspaceStateReportSummaryModel]:
        return cast(
            list[WorkspaceStateReportSummaryModel],
            _validated_model_list(WorkspaceStateReportSummaryModel, value),
        )

    @field_validator(
        "current_report_id",
        "current_goal",
        "agents_markdown",
        mode="before",
    )
    @classmethod
    def _optional_string(cls, value: object) -> str | None:
        return _strip_string(value)


class PendingFeedbackSessionModel(_MetadataModel):
    session_id: str
    item_ids: list[str]
    recommended_options: list[str]
    message_draft: str | None = None
    inferred_sentiment: FeedbackKind | None = None
    mode: Literal["recommendations", "confirmation"]

    @field_validator("session_id", mode="before")
    @classmethod
    def _session_id(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty session_id")
        return text

    @field_validator("item_ids", mode="before")
    @classmethod
    def _item_ids(cls, value: object) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("expected a list")
        cleaned = [
            item.strip() for item in value if isinstance(item, str) and item.strip()
        ]
        if not cleaned:
            raise ValueError("item_ids must contain at least one item id")
        return cleaned

    @field_validator("recommended_options", mode="before")
    @classmethod
    def _recommended_options(cls, value: object) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("expected a list")
        cleaned = [
            item.strip() for item in value if isinstance(item, str) and item.strip()
        ]
        if len(cleaned) != 3:
            raise ValueError("recommended_options must contain exactly three items")
        return cleaned

    @field_validator("message_draft", mode="before")
    @classmethod
    def _message_draft(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator("inferred_sentiment", mode="before")
    @classmethod
    def _inferred_sentiment(cls, value: object) -> FeedbackKind | None:
        return value if value in {"positive", "negative"} else None


class AppThreadMetadataModel(_MetadataModel):
    title: str | None = None
    investigation_brief: str | None = None
    plan: AgentPlanModel | None = None
    chart_plan: AgentPlanModel | None = None
    chart_cache: dict[str, str] | None = None
    surface_key: str | None = None
    openai_conversation_id: str | None = None
    openai_previous_response_id: str | None = None
    usage: ThreadUsageTotalsModel | None = None
    capability_bundle: CapabilityBundleModel | None = None
    workspace_state: WorkspaceStateModel | None = None
    origin: FeedbackOrigin | None = None
    feedback_session: PendingFeedbackSessionModel | None = None

    @field_validator(
        "title",
        "investigation_brief",
        "surface_key",
        "openai_conversation_id",
        "openai_previous_response_id",
        mode="before",
    )
    @classmethod
    def _optional_string(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator("chart_cache", mode="before")
    @classmethod
    def _chart_cache(cls, value: object) -> dict[str, str] | None:
        if not isinstance(value, dict):
            return None
        return {
            key: cache_value
            for key, cache_value in value.items()
            if isinstance(key, str) and isinstance(cache_value, str)
        }

    @field_validator("plan", "chart_plan", mode="before")
    @classmethod
    def _agent_plan(cls, value: object) -> AgentPlanModel | None:
        validated = _validated_model_or_none(AgentPlanModel, value)
        return cast(AgentPlanModel | None, validated)

    @field_validator("usage", mode="before")
    @classmethod
    def _thread_usage(cls, value: object) -> ThreadUsageTotalsModel | None:
        validated = _validated_model_or_none(ThreadUsageTotalsModel, value)
        return cast(ThreadUsageTotalsModel | None, validated)

    @field_validator("capability_bundle", mode="before")
    @classmethod
    def _capability_bundle(cls, value: object) -> CapabilityBundleModel | None:
        validated = _validated_model_or_none(CapabilityBundleModel, value)
        return cast(CapabilityBundleModel | None, validated)

    @field_validator("workspace_state", mode="before")
    @classmethod
    def _workspace_state(cls, value: object) -> WorkspaceStateModel | None:
        validated = _validated_model_or_none(WorkspaceStateModel, value)
        return cast(WorkspaceStateModel | None, validated)

    @field_validator("feedback_session", mode="before")
    @classmethod
    def _feedback_session(
        cls,
        value: object,
    ) -> PendingFeedbackSessionModel | None:
        validated = _validated_model_or_none(PendingFeedbackSessionModel, value)
        return cast(PendingFeedbackSessionModel | None, validated)

    @field_validator("origin", mode="before")
    @classmethod
    def _origin(cls, value: object) -> FeedbackOrigin | None:
        return value if value in {"interactive", "ui_integration_test"} else None


def parse_thread_metadata(raw_metadata: object | None) -> AppThreadMetadata:
    if not isinstance(raw_metadata, dict):
        return {}
    parsed = AppThreadMetadataModel.model_validate(raw_metadata)
    return cast(AppThreadMetadata, parsed.model_dump(exclude_none=True))


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
