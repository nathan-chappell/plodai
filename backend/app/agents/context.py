from dataclasses import dataclass, field

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.agents.DatasetMetadata import DatasetMetadata
from backend.app.chatkit.metadata import AppThreadMetadata, ClientToolDefinition


@dataclass
class ReportAgentContext:
    report_id: str
    user_id: str
    db: AsyncSession
    dataset_ids: list[str] = field(default_factory=list)
    chart_cache: dict[str, str] = field(default_factory=dict)
    thread_metadata: AppThreadMetadata = field(default_factory=AppThreadMetadata)
    available_datasets: list[DatasetMetadata] = field(default_factory=list)
    query_plan_model: type[BaseModel] | None = None
    capability_id: str | None = None
    client_tools: list[ClientToolDefinition] = field(default_factory=list)

    def get_dataset(self, dataset_id: str) -> DatasetMetadata | None:
        return next(
            (
                dataset
                for dataset in self.available_datasets
                if dataset.id == dataset_id
            ),
            None,
        )
