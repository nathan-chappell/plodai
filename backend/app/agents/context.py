from dataclasses import dataclass, field

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.agents.DatasetMetadata import DatasetMetadata
from backend.app.agents.workspace_file import WorkspaceFileMetadata
from backend.app.chatkit.metadata import (
    AppThreadMetadata,
    CapabilityManifest,
    ClientToolDefinition,
)


@dataclass
class ReportAgentContext:
    report_id: str
    user_id: str
    db: AsyncSession
    dataset_ids: list[str] = field(default_factory=list)
    chart_cache: dict[str, str] = field(default_factory=dict)
    thread_metadata: AppThreadMetadata = field(default_factory=AppThreadMetadata)
    available_files: list[WorkspaceFileMetadata] = field(default_factory=list)
    available_datasets: list[DatasetMetadata] = field(default_factory=list)
    query_plan_model: type[BaseModel] | None = None
    capability_manifest: CapabilityManifest | None = None

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
            (
                file
                for file in self.available_files
                if file.id == file_id
            ),
            None,
        )

    @property
    def capability_id(self) -> str | None:
        manifest = self.capability_manifest
        return manifest.get("capability_id") if manifest is not None else None

    @property
    def client_tools(self) -> list[ClientToolDefinition]:
        manifest = self.capability_manifest
        return list(manifest.get("client_tools") or []) if manifest is not None else []
