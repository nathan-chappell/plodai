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


class ToolDisplaySpec(TypedDict, total=False):
    label: str
    prominent_args: list[str]
    omit_args: list[str]
    arg_labels: dict[str, str]


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


class WorkspaceUploadPreviewSummary(TypedDict, total=False):
    row_count: int
    columns: list[str]
    numeric_columns: list[str]
    sample_rows: list[dict[str, object]]
    page_count: int
    width: int
    height: int


class WorkspaceCreatedItemSummaryData(TypedDict, total=False):
    slide_count: int
    source_file_id: str
    chart_plan_id: str
    projection_file_id: str | None
    entry_count: int
    archive_file_id: str
    index_file_id: str
    crop_count: int
    issue_count: int
    project_count: int
    order_count: int


class WorkspaceItemSummary(TypedDict, total=False):
    origin: Literal["upload", "created"]
    id: str
    workspace_id: str
    name: str
    kind: Literal[
        "csv",
        "json",
        "pdf",
        "image",
        "other",
        "report.v1",
        "chart.v1",
        "pdf_split.v1",
        "farm.v1",
    ]
    extension: str
    mime_type: str | None
    byte_size: int | None
    source_item_id: str | None
    content_key: str
    local_status: Literal["available", "missing"]
    preview: WorkspaceUploadPreviewSummary
    schema_version: Literal["v1"]
    title: str
    current_revision: int
    created_by_user_id: str
    created_by_agent_id: str | None
    last_edited_by_agent_id: str | None
    summary: WorkspaceCreatedItemSummaryData
    latest_op: str
    created_at: str
    updated_at: str


class WorkspaceState(TypedDict):
    version: Literal["v4"]
    workspace_id: str
    workspace_name: str
    app_id: Literal["agriculture", "documents"]
    active_chat_id: NotRequired[str | None]
    selected_item_id: NotRequired[str | None]
    current_report_item_id: NotRequired[str | None]
    items: list[WorkspaceItemSummary]


class AgricultureThreadImageRef(TypedDict):
    stored_file_id: str
    attachment_id: str
    name: str
    mime_type: str
    width: int | None
    height: int | None


class AgricultureState(TypedDict):
    thread_image_refs: list[AgricultureThreadImageRef]


class PendingFeedbackSession(TypedDict):
    session_id: str
    item_ids: list[str]
    recommended_options: list[str]
    message_draft: str | None
    inferred_sentiment: FeedbackKind | None
    mode: Literal["recommendations", "confirmation"]


class ChatMetadataPatch(TypedDict, total=False):
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
    workspace_state: WorkspaceState
    agriculture_state: AgricultureState
    origin: FeedbackOrigin
    feedback_session: PendingFeedbackSession


class AppChatMetadata(TypedDict, total=False):
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
    workspace_state: WorkspaceState
    agriculture_state: AgricultureState
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


class WorkspaceUploadPreviewSummaryModel(_MetadataModel):
    row_count: int | None = None
    columns: list[str] | None = None
    numeric_columns: list[str] | None = None
    sample_rows: list[dict[str, object]] | None = None
    page_count: int | None = None
    width: int | None = None
    height: int | None = None

    @field_validator(
        "row_count",
        "page_count",
        "width",
        "height",
        mode="before",
    )
    @classmethod
    def _optional_int(cls, value: object) -> int | None:
        return value if isinstance(value, int) and value >= 0 else None

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


class WorkspaceCreatedItemSummaryDataModel(_MetadataModel):
    slide_count: int | None = None
    source_file_id: str | None = None
    chart_plan_id: str | None = None
    projection_file_id: str | None = None
    entry_count: int | None = None
    archive_file_id: str | None = None
    index_file_id: str | None = None
    crop_count: int | None = None
    issue_count: int | None = None
    project_count: int | None = None
    order_count: int | None = None

    @field_validator(
        "source_file_id",
        "chart_plan_id",
        "projection_file_id",
        "archive_file_id",
        "index_file_id",
        mode="before",
    )
    @classmethod
    def _optional_string(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator(
        "slide_count",
        "entry_count",
        "crop_count",
        "issue_count",
        "project_count",
        "order_count",
        mode="before",
    )
    @classmethod
    def _optional_int(cls, value: object) -> int | None:
        return value if isinstance(value, int) and value >= 0 else None


class WorkspaceItemSummaryModel(_MetadataModel):
    origin: Literal["upload", "created"] | None = None
    id: str
    workspace_id: str
    kind: Literal[
        "csv",
        "json",
        "pdf",
        "image",
        "other",
        "report.v1",
        "chart.v1",
        "pdf_split.v1",
        "farm.v1",
    ]
    name: str | None = None
    extension: str = ""
    mime_type: str | None = None
    byte_size: int | None = None
    source_item_id: str | None = None
    content_key: str | None = None
    local_status: Literal["available", "missing"] | None = None
    preview: WorkspaceUploadPreviewSummaryModel | None = None
    schema_version: Literal["v1"] | None = None
    title: str | None = None
    current_revision: int | None = None
    created_by_user_id: str | None = None
    created_by_agent_id: str | None = None
    last_edited_by_agent_id: str | None = None
    summary: WorkspaceCreatedItemSummaryDataModel | None = None
    latest_op: str | None = None
    created_at: str
    updated_at: str

    @field_validator(
        "id",
        "workspace_id",
        "created_at",
        "updated_at",
        mode="before",
    )
    @classmethod
    def _required_string(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator(
        "name",
        "mime_type",
        "source_item_id",
        "content_key",
        "title",
        "created_by_user_id",
        "created_by_agent_id",
        "last_edited_by_agent_id",
        "latest_op",
        mode="before",
    )
    @classmethod
    def _optional_string(cls, value: object) -> str | None:
        return _strip_string(value)

    @field_validator("origin", mode="before")
    @classmethod
    def _origin(
        cls, value: object
    ) -> Literal["upload", "created"] | None:
        return value if value in {"upload", "created"} else None

    @field_validator("extension", mode="before")
    @classmethod
    def _extension(cls, value: object) -> str:
        return _strip_string(value) or ""

    @field_validator("local_status", mode="before")
    @classmethod
    def _local_status(
        cls, value: object
    ) -> Literal["available", "missing"] | None:
        return value if value in {"available", "missing"} else None

    @field_validator("byte_size", mode="before")
    @classmethod
    def _byte_size(cls, value: object) -> int | None:
        return value if isinstance(value, int) and value >= 0 else None

    @field_validator("current_revision", mode="before")
    @classmethod
    def _current_revision(cls, value: object) -> int | None:
        if value is None:
            return None
        if not isinstance(value, int) or value < 1:
            raise ValueError("current_revision must be >= 1")
        return value

    @field_validator("preview", mode="before")
    @classmethod
    def _preview(
        cls, value: object
    ) -> WorkspaceUploadPreviewSummaryModel | None:
        validated = _validated_model_or_none(WorkspaceUploadPreviewSummaryModel, value)
        return cast(WorkspaceUploadPreviewSummaryModel | None, validated)

    @field_validator("summary", mode="before")
    @classmethod
    def _summary(
        cls, value: object
    ) -> WorkspaceCreatedItemSummaryDataModel | None:
        validated = _validated_model_or_none(WorkspaceCreatedItemSummaryDataModel, value)
        return cast(WorkspaceCreatedItemSummaryDataModel | None, validated)


class WorkspaceStateModel(_MetadataModel):
    version: Literal["v4"]
    workspace_id: str
    workspace_name: str
    app_id: Literal["agriculture", "documents"]
    active_chat_id: str | None = None
    selected_item_id: str | None = None
    current_report_item_id: str | None = None
    items: list[WorkspaceItemSummaryModel] = Field(default_factory=list)

    @field_validator("app_id", mode="before")
    @classmethod
    def _app_id(cls, value: object) -> Literal["agriculture", "documents"]:
        text = _strip_string(value)
        if text not in {"agriculture", "documents"}:
            raise ValueError("expected app_id to be 'agriculture' or 'documents'")
        return cast(Literal["agriculture", "documents"], text)

    @field_validator(
        "workspace_id",
        "workspace_name",
        "active_chat_id",
        "selected_item_id",
        "current_report_item_id",
        mode="before",
    )
    @classmethod
    def _required_or_optional_string(cls, value: object, info) -> str | None:
        text = _strip_string(value)
        if info.field_name in {
            "active_chat_id",
            "selected_item_id",
            "current_report_item_id",
        }:
            return text
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("items", mode="before")
    @classmethod
    def _items(
        cls,
        value: object,
    ) -> list[WorkspaceItemSummaryModel]:
        return cast(
            list[WorkspaceItemSummaryModel],
            _validated_model_list(WorkspaceItemSummaryModel, value),
        )


class AgricultureThreadImageRefModel(_MetadataModel):
    stored_file_id: str
    attachment_id: str
    name: str
    mime_type: str
    width: int | None = None
    height: int | None = None

    @field_validator(
        "stored_file_id",
        "attachment_id",
        "name",
        "mime_type",
        mode="before",
    )
    @classmethod
    def _required_string(cls, value: object) -> str:
        text = _strip_string(value)
        if text is None:
            raise ValueError("expected a non-empty string")
        return text

    @field_validator("width", "height", mode="before")
    @classmethod
    def _optional_dimension(cls, value: object) -> int | None:
        if value is None:
            return None
        if not isinstance(value, int):
            raise ValueError("expected an integer")
        if value < 0:
            raise ValueError("expected a non-negative integer")
        return value


class AgricultureStateModel(_MetadataModel):
    thread_image_refs: list[AgricultureThreadImageRefModel] = Field(default_factory=list)

    @field_validator("thread_image_refs", mode="before")
    @classmethod
    def _thread_image_refs(
        cls,
        value: object,
    ) -> list[AgricultureThreadImageRefModel]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("expected a list")
        validated: list[AgricultureThreadImageRefModel] = []
        for raw_item in value:
            validated.append(AgricultureThreadImageRefModel.model_validate(raw_item))
        return validated


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


class AppChatMetadataModel(_MetadataModel):
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
    workspace_state: WorkspaceStateModel | None = None
    agriculture_state: AgricultureStateModel | None = None
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

    @field_validator("workspace_state", mode="before")
    @classmethod
    def _workspace_state(cls, value: object) -> WorkspaceStateModel | None:
        validated = _validated_model_or_none(WorkspaceStateModel, value)
        return cast(WorkspaceStateModel | None, validated)

    @field_validator("agriculture_state", mode="before")
    @classmethod
    def _agriculture_state(cls, value: object) -> AgricultureStateModel | None:
        validated = _validated_model_or_none(AgricultureStateModel, value)
        return cast(AgricultureStateModel | None, validated)

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


def parse_chat_metadata(raw_metadata: object | None) -> AppChatMetadata:
    if not isinstance(raw_metadata, dict):
        return {}
    parsed = AppChatMetadataModel.model_validate(raw_metadata)
    return cast(AppChatMetadata, parsed.model_dump(exclude_none=True))


def merge_chat_metadata(
    current: AppChatMetadata, patch: ChatMetadataPatch
) -> AppChatMetadata:
    merged: AppChatMetadata = {**current}
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged


def list_agriculture_thread_image_refs(
    metadata: object | None,
) -> list[AgricultureThreadImageRef]:
    parsed = parse_chat_metadata(metadata)
    agriculture_state = parsed.get("agriculture_state")
    if agriculture_state is None:
        return []
    return list(agriculture_state.get("thread_image_refs", []))


def resolve_agriculture_thread_image_ref(
    metadata: object | None,
    *,
    stored_file_id: str | None = None,
    attachment_id: str | None = None,
) -> AgricultureThreadImageRef | None:
    for ref in list_agriculture_thread_image_refs(metadata):
        if stored_file_id and ref.get("stored_file_id") == stored_file_id:
            return ref
        if attachment_id and ref.get("attachment_id") == attachment_id:
            return ref
    return None


def build_agriculture_image_ref_patch(
    current_metadata: AppChatMetadata,
    refs: list[AgricultureThreadImageRef],
) -> ChatMetadataPatch | None:
    if not refs:
        return None

    merged_by_file_id: dict[str, AgricultureThreadImageRef] = {
        ref["stored_file_id"]: ref
        for ref in list_agriculture_thread_image_refs(current_metadata)
    }
    changed = False
    for ref in refs:
        previous = merged_by_file_id.get(ref["stored_file_id"])
        if previous != ref:
            changed = True
            merged_by_file_id.pop(ref["stored_file_id"], None)
            merged_by_file_id[ref["stored_file_id"]] = ref
    if not changed:
        return None
    return {
        "agriculture_state": {
            "thread_image_refs": list(merged_by_file_id.values()),
        }
    }


def build_remove_agriculture_image_ref_patch(
    current_metadata: AppChatMetadata,
    *,
    stored_file_id: str | None = None,
    attachment_id: str | None = None,
) -> ChatMetadataPatch | None:
    if stored_file_id is None and attachment_id is None:
        return None

    existing_refs = list_agriculture_thread_image_refs(current_metadata)
    remaining_refs = [
        ref
        for ref in existing_refs
        if not (
            (stored_file_id and ref["stored_file_id"] == stored_file_id)
            or (attachment_id and ref["attachment_id"] == attachment_id)
        )
    ]
    if len(remaining_refs) == len(existing_refs):
        return None
    if not remaining_refs:
        return {"agriculture_state": None}
    return {
        "agriculture_state": {
            "thread_image_refs": remaining_refs,
        }
    }


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
