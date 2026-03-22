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

ALLOWED_AGENT_IDS = frozenset(
    {
        "default-agent",
        "report-agent",
        "analysis-agent",
        "chart-agent",
        "document-agent",
        "agriculture-agent",
        "feedback-agent",
    }
)


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
    execution_hints: NotRequired[list["AgentPlanExecutionHint"]]
    created_at: NotRequired[str]


class AgentPlanExecutionHint(TypedDict, total=False):
    done_when: str
    preferred_tool_names: list[str]
    preferred_handoff_tool_names: list[str]


PlanExecutionStatus: TypeAlias = Literal["active", "completed", "cancelled"]


class PlanExecution(TypedDict, total=False):
    plan_id: str
    status: PlanExecutionStatus
    workflow_item_id: str
    current_step_index: int
    attempts_by_step: list[int]
    step_notes: list[str | None]
    step_started_after_item_id: str


class ClientToolDefinition(TypedDict, total=False):
    type: Literal["function"]
    name: str
    description: str
    parameters: JsonSchema
    strict: bool
    display: "ToolDisplaySpec"


class TourPickerDisplayScenario(TypedDict):
    scenario_id: str
    title: str
    summary: str
    workspace_name: str
    target_agent_id: str
    default_asset_count: int


class TourPickerDisplaySpec(TypedDict):
    title: str
    summary: str
    scenarios: list[TourPickerDisplayScenario]


class ToolDisplaySpec(TypedDict, total=False):
    label: str
    prominent_args: list[str]
    omit_args: list[str]
    arg_labels: dict[str, str]
    tour_picker: TourPickerDisplaySpec


class AgentDelegationTarget(TypedDict):
    agent_id: str
    tool_name: str
    description: str


class AgentSpec(TypedDict):
    agent_id: str
    agent_name: str
    instructions: str
    client_tools: list[ClientToolDefinition]
    delegation_targets: list[AgentDelegationTarget]


class AgentBundle(TypedDict):
    root_agent_id: str
    agents: list[AgentSpec]


class ShellStateAgentSummary(TypedDict, total=False):
    agent_id: str
    goal: str | None
    resource_count: int
    current_report_id: str | None


class ShellStateResourceSummary(TypedDict, total=False):
    id: str
    owner_agent_id: str
    origin: Literal["uploaded", "generated"]
    kind: Literal["dataset", "chart", "document", "image", "report", "text", "blob"]
    title: str
    created_at: str
    summary: str | None
    payload_ref: str
    extension: str | None
    mime_type: str | None
    byte_size: int | None
    row_count: int | None
    columns: list[str]
    numeric_columns: list[str]
    sample_rows: list[dict[str, object]]
    page_count: int | None
    width: int | None
    height: int | None
    slide_count: int | None


class ShellState(TypedDict):
    version: Literal["v1"]
    context_id: str
    context_name: str
    active_agent_id: str
    agents: list[ShellStateAgentSummary]
    resources: list[ShellStateResourceSummary]


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
    plan_execution: PlanExecution
    chart_plan: AgentPlan
    chart_cache: dict[str, str]
    surface_key: str
    openai_conversation_id: str
    openai_previous_response_id: str
    usage: ThreadUsageTotals
    agent_bundle: AgentBundle
    shell_state: ShellState
    origin: FeedbackOrigin
    feedback_session: PendingFeedbackSession


class AppThreadMetadata(TypedDict, total=False):
    title: str
    investigation_brief: str
    plan: AgentPlan
    plan_execution: PlanExecution
    chart_plan: AgentPlan
    chart_cache: dict[str, str]
    surface_key: str
    openai_conversation_id: str
    openai_previous_response_id: str
    usage: ThreadUsageTotals
    agent_bundle: AgentBundle
    shell_state: ShellState
    origin: FeedbackOrigin
    feedback_session: PendingFeedbackSession


class _MetadataModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _StrictMetadataModel(_MetadataModel):
    model_config = ConfigDict(extra="forbid")


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


def _required_agent_id(value: object) -> str:
    text = _strip_string(value)
    if text is None or text not in ALLOWED_AGENT_IDS:
        raise ValueError("expected a supported agent id")
    return text


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
    execution_hints: list["AgentPlanExecutionHintModel"] | None = None
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

    @field_validator("execution_hints", mode="before")
    @classmethod
    def _execution_hints(
        cls,
        value: object,
    ) -> list["AgentPlanExecutionHintModel"] | None:
        if value is None:
            return None
        if not isinstance(value, list):
            raise ValueError("execution_hints must be a list")
        validated: list[AgentPlanExecutionHintModel] = []
        for raw_item in value:
            validated.append(AgentPlanExecutionHintModel.model_validate(raw_item))
        return validated or None

    @model_validator(mode="after")
    def _require_planned_steps(self) -> "AgentPlanModel":
        if not self.planned_steps:
            raise ValueError("planned_steps must contain at least one step")
        if self.execution_hints is not None and len(self.execution_hints) != len(
            self.planned_steps
        ):
            raise ValueError(
                "execution_hints must align one-to-one with planned_steps"
            )
        return self


class AgentPlanExecutionHintModel(_StrictMetadataModel):
    done_when: str | None = None
    preferred_tool_names: list[str] | None = None
    preferred_handoff_tool_names: list[str] | None = None

    @field_validator("done_when", mode="before")
    @classmethod
    def _done_when(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator(
        "preferred_tool_names",
        "preferred_handoff_tool_names",
        mode="before",
    )
    @classmethod
    def _string_list(cls, value: object) -> list[str] | None:
        if value is None:
            return None
        if not isinstance(value, list):
            raise ValueError("expected a list")
        cleaned = [
            item.strip() for item in value if isinstance(item, str) and item.strip()
        ]
        return cleaned or None

    @model_validator(mode="after")
    def _require_some_hint(self) -> "AgentPlanExecutionHintModel":
        if (
            self.done_when is None
            and not self.preferred_tool_names
            and not self.preferred_handoff_tool_names
        ):
            raise ValueError("execution hint must include at least one field")
        return self


class PlanExecutionStateModel(_StrictMetadataModel):
    plan_id: str
    status: PlanExecutionStatus
    workflow_item_id: str
    current_step_index: int
    attempts_by_step: list[int]
    step_notes: list[str | None]
    step_started_after_item_id: str | None = None

    @field_validator(
        "plan_id",
        "workflow_item_id",
        "step_started_after_item_id",
        mode="before",
    )
    @classmethod
    def _optional_or_required_string(cls, value: object, info) -> str | None:
        text = _strip_string(value)
        if info.field_name == "step_started_after_item_id":
            return text
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("current_step_index", mode="before")
    @classmethod
    def _current_step_index(cls, value: object) -> int:
        if not isinstance(value, int):
            raise ValueError("current_step_index must be an integer")
        return value

    @field_validator("attempts_by_step", mode="before")
    @classmethod
    def _attempts_by_step(cls, value: object) -> list[int]:
        if not isinstance(value, list):
            raise ValueError("attempts_by_step must be a list")
        attempts: list[int] = []
        for raw_value in value:
            if not isinstance(raw_value, int):
                raise ValueError("attempts_by_step must contain integers")
            attempts.append(raw_value)
        return attempts

    @field_validator("step_notes", mode="before")
    @classmethod
    def _step_notes(cls, value: object) -> list[str | None]:
        if not isinstance(value, list):
            raise ValueError("step_notes must be a list")
        notes: list[str | None] = []
        for raw_value in value:
            if raw_value is None:
                notes.append(None)
                continue
            notes.append(_strip_string(raw_value))
        return notes

    @model_validator(mode="after")
    def _validate_lengths(self) -> "PlanExecutionStateModel":
        if self.current_step_index < 0:
            raise ValueError("current_step_index must be >= 0")
        if len(self.attempts_by_step) != len(self.step_notes):
            raise ValueError("attempts_by_step and step_notes must align")
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
    tour_picker: "TourPickerDisplaySpecModel | None" = None

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

    @field_validator("tour_picker", mode="before")
    @classmethod
    def _tour_picker(
        cls,
        value: object,
    ) -> "TourPickerDisplaySpecModel | None":
        validated = _validated_model_or_none(TourPickerDisplaySpecModel, value)
        return cast(TourPickerDisplaySpecModel | None, validated)


class TourPickerDisplayScenarioModel(_MetadataModel):
    scenario_id: str
    title: str
    summary: str
    workspace_name: str
    target_agent_id: str
    default_asset_count: int

    @field_validator(
        "scenario_id",
        "title",
        "summary",
        "workspace_name",
        mode="before",
    )
    @classmethod
    def _required_text(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("target_agent_id", mode="before")
    @classmethod
    def _target_agent_id(cls, value: object) -> str:
        return _required_agent_id(value)

    @field_validator("default_asset_count", mode="before")
    @classmethod
    def _default_asset_count(cls, value: object) -> int:
        if not isinstance(value, int):
            raise ValueError("expected an integer")
        if value < 0:
            raise ValueError("expected default_asset_count >= 0")
        return value


class TourPickerDisplaySpecModel(_MetadataModel):
    title: str
    summary: str
    scenarios: list[TourPickerDisplayScenarioModel] = Field(default_factory=list)

    @field_validator("title", "summary", mode="before")
    @classmethod
    def _required_text(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("scenarios", mode="before")
    @classmethod
    def _scenarios(
        cls,
        value: object,
    ) -> list[TourPickerDisplayScenarioModel]:
        validated = _validated_model_list(TourPickerDisplayScenarioModel, value)
        return cast(list[TourPickerDisplayScenarioModel], validated)

    @model_validator(mode="after")
    def _require_scenarios(self) -> "TourPickerDisplaySpecModel":
        if not self.scenarios:
            raise ValueError("expected at least one tour picker scenario")
        return self


class AgentDelegationTargetModel(_MetadataModel):
    agent_id: str
    tool_name: str
    description: str

    @field_validator("agent_id", mode="before")
    @classmethod
    def _agent_id(cls, value: object) -> str:
        return _required_agent_id(value)

    @field_validator("tool_name", "description", mode="before")
    @classmethod
    def _required_string(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text


class AgentSpecModel(_MetadataModel):
    agent_id: str
    agent_name: str
    instructions: str
    client_tools: list[ClientToolDefinitionModel] = Field(default_factory=list)
    delegation_targets: list[AgentDelegationTargetModel] = Field(
        default_factory=list
    )

    @field_validator("agent_id", mode="before")
    @classmethod
    def _agent_id(cls, value: object) -> str:
        return _required_agent_id(value)

    @field_validator("agent_name", "instructions", mode="before")
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

    @field_validator("delegation_targets", mode="before")
    @classmethod
    def _delegation_targets(
        cls,
        value: object,
    ) -> list[AgentDelegationTargetModel]:
        return cast(
            list[AgentDelegationTargetModel],
            _validated_model_list(AgentDelegationTargetModel, value),
        )


class AgentBundleModel(_MetadataModel):
    root_agent_id: str
    agents: list[AgentSpecModel]

    @field_validator("root_agent_id", mode="before")
    @classmethod
    def _root_agent_id(cls, value: object) -> str:
        return _required_agent_id(value)

    @field_validator("agents", mode="before")
    @classmethod
    def _agents(
        cls,
        value: object,
    ) -> list[AgentSpecModel]:
        return cast(
            list[AgentSpecModel],
            _validated_model_list(AgentSpecModel, value),
        )

    @model_validator(mode="after")
    def _validate_root_agent(self) -> "AgentBundleModel":
        if not self.agents:
            raise ValueError("agents must not be empty")
        agent_ids = {
            agent.agent_id for agent in self.agents
        }
        if self.root_agent_id not in agent_ids:
            raise ValueError(
                "root_agent_id must be present in agents"
            )
        return self


class ShellStateAgentSummaryModel(_MetadataModel):
    agent_id: str
    goal: str | None = None
    resource_count: int = 0
    current_report_id: str | None = None

    @field_validator("agent_id", mode="before")
    @classmethod
    def _required_string(cls, value: object) -> str:
        return _required_agent_id(value)

    @field_validator("goal", "current_report_id", mode="before")
    @classmethod
    def _optional_string(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator("resource_count", mode="before")
    @classmethod
    def _resource_count(cls, value: object) -> int:
        return value if isinstance(value, int) and value >= 0 else 0


class ShellStateResourceSummaryModel(_MetadataModel):
    id: str
    owner_agent_id: str
    origin: Literal["uploaded", "generated"] | None = None
    kind: Literal["dataset", "chart", "document", "image", "report", "text", "blob"]
    title: str
    created_at: str
    summary: str | None = None
    payload_ref: str
    extension: str | None = None
    mime_type: str | None = None
    byte_size: int | None = None
    row_count: int | None = None
    columns: list[str] | None = None
    numeric_columns: list[str] | None = None
    sample_rows: list[dict[str, object]] | None = None
    page_count: int | None = None
    width: int | None = None
    height: int | None = None
    slide_count: int | None = None

    @field_validator("owner_agent_id", mode="before")
    @classmethod
    def _owner_agent_id(cls, value: object) -> str:
        return _required_agent_id(value)

    @field_validator(
        "id",
        "title",
        "created_at",
        "payload_ref",
        mode="before",
    )
    @classmethod
    def _required_string(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("summary", "extension", "mime_type", mode="before")
    @classmethod
    def _optional_string(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator("origin", mode="before")
    @classmethod
    def _origin(
        cls, value: object
    ) -> Literal["uploaded", "generated"] | None:
        return (
            value
            if value in {"uploaded", "generated"}
            else None
        )

    @field_validator(
        "byte_size",
        "row_count",
        "page_count",
        "width",
        "height",
        "slide_count",
        mode="before",
    )
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


class ShellStateModel(_MetadataModel):
    version: Literal["v1"]
    context_id: str
    context_name: str
    active_agent_id: str
    agents: list[ShellStateAgentSummaryModel] = Field(default_factory=list)
    resources: list[ShellStateResourceSummaryModel] = Field(default_factory=list)

    @field_validator("active_agent_id", mode="before")
    @classmethod
    def _active_agent_id(cls, value: object) -> str:
        return _required_agent_id(value)

    @field_validator("context_id", "context_name", mode="before")
    @classmethod
    def _required_string(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("agents", mode="before")
    @classmethod
    def _agents(
        cls,
        value: object,
    ) -> list[ShellStateAgentSummaryModel]:
        return cast(
            list[ShellStateAgentSummaryModel],
            _validated_model_list(ShellStateAgentSummaryModel, value),
        )

    @field_validator("resources", mode="before")
    @classmethod
    def _resources(
        cls,
        value: object,
    ) -> list[ShellStateResourceSummaryModel]:
        return cast(
            list[ShellStateResourceSummaryModel],
            _validated_model_list(ShellStateResourceSummaryModel, value),
        )


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
    plan_execution: PlanExecutionStateModel | None = None
    chart_plan: AgentPlanModel | None = None
    chart_cache: dict[str, str] | None = None
    surface_key: str | None = None
    openai_conversation_id: str | None = None
    openai_previous_response_id: str | None = None
    usage: ThreadUsageTotalsModel | None = None
    agent_bundle: AgentBundleModel | None = None
    shell_state: ShellStateModel | None = None
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

    @field_validator("plan_execution", mode="before")
    @classmethod
    def _plan_execution(
        cls,
        value: object,
    ) -> PlanExecutionStateModel | None:
        validated = _validated_model_or_none(PlanExecutionStateModel, value)
        return cast(PlanExecutionStateModel | None, validated)

    @field_validator("usage", mode="before")
    @classmethod
    def _thread_usage(cls, value: object) -> ThreadUsageTotalsModel | None:
        validated = _validated_model_or_none(ThreadUsageTotalsModel, value)
        return cast(ThreadUsageTotalsModel | None, validated)

    @field_validator("agent_bundle", mode="before")
    @classmethod
    def _agent_bundle(
        cls, value: object
    ) -> AgentBundleModel | None:
        validated = _validated_model_or_none(AgentBundleModel, value)
        return cast(AgentBundleModel | None, validated)

    @field_validator("shell_state", mode="before")
    @classmethod
    def _shell_state(cls, value: object) -> ShellStateModel | None:
        validated = _validated_model_or_none(ShellStateModel, value)
        return cast(ShellStateModel | None, validated)

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


def active_plan_execution(
    metadata: object | None,
) -> PlanExecution | None:
    if not isinstance(metadata, dict):
        return None
    execution = metadata.get("plan_execution")
    if not isinstance(execution, dict):
        return None
    if execution.get("status") != "active":
        return None
    if not isinstance(execution.get("workflow_item_id"), str):
        return None
    if not isinstance(execution.get("plan_id"), str):
        return None
    return cast(PlanExecution, execution)
