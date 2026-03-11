from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from chatkit.types import ThreadStreamEvent
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.agents.DatasetMetadata import DatasetMetadata
from backend.app.chatkit.client_tools import ClientToolResultPayload
from backend.app.chatkit.metadata import AppThreadMetadata

ThreadEventEmitter = Callable[[ThreadStreamEvent], Awaitable[None]]


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
    current_tool_result: ClientToolResultPayload | None = None

    def get_dataset(self, dataset_id: str) -> DatasetMetadata | None:
        return next(
            (
                dataset
                for dataset in self.available_datasets
                if dataset.id == dataset_id
            ),
            None,
        )

    def validate_query_plan(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.query_plan_model is None:
            return payload
        return self.query_plan_model.model_validate(payload).model_dump(by_alias=True)
