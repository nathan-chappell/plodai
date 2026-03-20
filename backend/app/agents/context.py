from dataclasses import dataclass, field

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.agents.DatasetMetadata import DatasetMetadata
from backend.app.agents.workspace_file import WorkspaceFileMetadata
from backend.app.chatkit.metadata import (
    AppThreadMetadata,
    ClientToolDefinition,
    ToolProviderAgentSpec,
    ToolProviderBundle,
)


@dataclass
class ReportAgentContext:
    report_id: str
    user_id: str
    user_email: str | None
    db: AsyncSession
    chart_cache: dict[str, str] = field(default_factory=dict)
    request_metadata: AppThreadMetadata = field(default_factory=AppThreadMetadata)
    thread_metadata: AppThreadMetadata = field(default_factory=AppThreadMetadata)
    available_files: list[WorkspaceFileMetadata] = field(default_factory=list)
    query_plan_model: type[BaseModel] | None = None
    tool_provider_bundle: ToolProviderBundle | None = None
    uploaded_file_ids: dict[str, str] = field(default_factory=dict)

    @property
    def available_datasets(self) -> list[DatasetMetadata]:
        datasets: list[DatasetMetadata] = []
        for file in self.available_files:
            if file.kind != "csv" or file.csv is None:
                continue
            datasets.append(
                DatasetMetadata(
                    id=file.id,
                    name=file.name,
                    columns=list(file.csv.columns),
                    sample_rows=list(file.csv.sample_rows),
                    row_count=file.csv.row_count,
                    numeric_columns=list(file.csv.numeric_columns),
                )
            )
        return datasets

    @property
    def available_chartable_files(self) -> list[WorkspaceFileMetadata]:
        return [
            file
            for file in self.available_files
            if (file.kind == "csv" and file.csv is not None)
            or (file.kind == "json" and file.json is not None)
        ]

    @property
    def dataset_ids(self) -> list[str]:
        return [dataset.id for dataset in self.available_datasets]

    def get_dataset(self, dataset_id: str) -> DatasetMetadata | None:
        return next(
            (
                dataset
                for dataset in self.available_datasets
                if dataset.id == dataset_id
            ),
            None,
        )

    def get_file(self, file_id: str) -> WorkspaceFileMetadata | None:
        return next(
            (file for file in self.available_files if file.id == file_id),
            None,
        )

    @property
    def tool_provider_id(self) -> str | None:
        bundle = self.tool_provider_bundle
        return bundle.get("root_tool_provider_id") if bundle is not None else None

    @property
    def tool_provider_spec(self) -> ToolProviderAgentSpec | None:
        tool_provider_id = self.tool_provider_id
        return (
            self.get_tool_provider_spec(tool_provider_id)
            if tool_provider_id is not None
            else None
        )

    def get_tool_provider_spec(
        self, tool_provider_id: str | None
    ) -> ToolProviderAgentSpec | None:
        bundle = self.tool_provider_bundle
        if bundle is None or tool_provider_id is None:
            return None
        return next(
            (
                tool_provider
                for tool_provider in bundle.get("tool_providers", [])
                if tool_provider.get("tool_provider_id") == tool_provider_id
            ),
            None,
        )

    @property
    def client_tools(self) -> list[ClientToolDefinition]:
        tool_provider_spec = self.tool_provider_spec
        return (
            list(tool_provider_spec.get("client_tools") or [])
            if tool_provider_spec is not None
            else []
        )

    def get_client_tools(
        self, tool_provider_id: str | None
    ) -> list[ClientToolDefinition]:
        tool_provider_spec = self.get_tool_provider_spec(tool_provider_id)
        return (
            list(tool_provider_spec.get("client_tools") or [])
            if tool_provider_spec is not None
            else []
        )

    @property
    def capability_bundle(self) -> ToolProviderBundle | None:
        return self.tool_provider_bundle

    @capability_bundle.setter
    def capability_bundle(self, value: ToolProviderBundle | None) -> None:
        self.tool_provider_bundle = value

    @property
    def capability_id(self) -> str | None:
        return self.tool_provider_id

    @property
    def capability_spec(self) -> ToolProviderAgentSpec | None:
        return self.tool_provider_spec

    def get_capability_spec(
        self, capability_id: str | None
    ) -> ToolProviderAgentSpec | None:
        return self.get_tool_provider_spec(capability_id)

    @property
    def workspace_agents_markdown(self) -> str | None:
        workspace_state = self.thread_metadata.get("workspace_state")
        if workspace_state is None:
            return None
        markdown = workspace_state.get("agents_markdown")
        return markdown if isinstance(markdown, str) and markdown.strip() else None
