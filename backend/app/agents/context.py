from dataclasses import dataclass, field

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.agents.DatasetMetadata import DatasetMetadata
from backend.app.agents.workspace_file import WorkspaceFileMetadata
from backend.app.chatkit.metadata import (
    AgentBundle,
    AgentSpec,
    AppChatMetadata,
    ClientToolDefinition,
    WorkspaceItemSummary,
)


@dataclass
class ReportAgentContext:
    report_id: str
    user_id: str
    user_email: str | None
    db: AsyncSession
    workspace_id: str | None = None
    workspace_name: str | None = None
    chart_cache: dict[str, str] = field(default_factory=dict)
    request_metadata: AppChatMetadata = field(default_factory=AppChatMetadata)
    thread_metadata: AppChatMetadata = field(default_factory=AppChatMetadata)
    available_files: list[WorkspaceFileMetadata] = field(default_factory=list)
    available_artifacts: list[WorkspaceItemSummary] = field(default_factory=list)
    query_plan_model: type[BaseModel] | None = None
    agent_bundle: AgentBundle | None = None
    uploaded_file_ids: dict[str, str] = field(default_factory=dict)

    @property
    def available_datasets(self) -> list[DatasetMetadata]:
        datasets: list[DatasetMetadata] = []
        for file in self.available_files:
            if file.kind == "csv" and file.csv is not None:
                dataset_meta = file.csv
            elif file.kind == "json" and file.json is not None:
                dataset_meta = file.json
            else:
                continue
            datasets.append(
                DatasetMetadata(
                    id=file.id,
                    name=file.name,
                    columns=list(dataset_meta.columns),
                    sample_rows=list(dataset_meta.sample_rows),
                    row_count=dataset_meta.row_count,
                    numeric_columns=list(dataset_meta.numeric_columns),
                )
            )
        return datasets

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
    def agent_id(self) -> str | None:
        bundle = self.agent_bundle
        return bundle.get("root_agent_id") if bundle is not None else None

    @property
    def agent_spec(self) -> AgentSpec | None:
        return self.get_agent_spec(self.agent_id)

    def get_agent_spec(
        self,
        agent_id: str | None,
    ) -> AgentSpec | None:
        bundle = self.agent_bundle
        if bundle is None or agent_id is None:
            return None
        return next(
            (
                agent_spec
                for agent_spec in bundle.get("agents", [])
                if agent_spec.get("agent_id") == agent_id
            ),
            None,
        )

    @property
    def client_tools(self) -> list[ClientToolDefinition]:
        agent_spec = self.agent_spec
        return (
            list(agent_spec.get("client_tools") or [])
            if agent_spec is not None
            else []
        )

    def get_client_tools(
        self,
        agent_id: str | None,
    ) -> list[ClientToolDefinition]:
        agent_spec = self.get_agent_spec(agent_id)
        return (
            list(agent_spec.get("client_tools") or [])
            if agent_spec is not None
            else []
        )
