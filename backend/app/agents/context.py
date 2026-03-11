from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.chatkit.metadata import AppThreadMetadata


ThreadEventEmitter = Callable[[object], Awaitable[None]]


@dataclass
class DatasetMetadata:
    id: str
    name: str
    columns: list[str]
    sample_rows: list[dict[str, Any]] = field(default_factory=list)
    row_count: int = 0
    numeric_columns: list[str] = field(default_factory=list)


@dataclass
class ReportAgentContext:
    report_id: str
    user_email: str
    db: AsyncSession
    dataset_ids: list[str] = field(default_factory=list)
    chart_cache: dict[str, str] = field(default_factory=dict)
    thread_metadata: AppThreadMetadata = field(default_factory=AppThreadMetadata)
    available_datasets: list[DatasetMetadata] = field(default_factory=list)
    query_plan_model: type[BaseModel] | None = None
    query_plan_schema: dict[str, Any] = field(default_factory=dict)
    emit_event: ThreadEventEmitter | None = None
    requested_thread_title: str | None = None

    def get_dataset(self, dataset_id: str) -> DatasetMetadata | None:
        return next((dataset for dataset in self.available_datasets if dataset.id == dataset_id), None)

    def validate_query_plan(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.query_plan_model is None:
            return payload
        return self.query_plan_model.model_validate(payload).model_dump(by_alias=True)
