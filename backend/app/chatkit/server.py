from __future__ import annotations

import json
from typing import Any, AsyncIterator, Literal, cast

from agents import Runner
from chatkit.actions import Action
from chatkit.agents import AgentContext as ChatKitAgentContext
from chatkit.agents import simple_to_agent_input, stream_agent_response
from chatkit.server import ChatKitServer
from chatkit.types import (
    ProgressUpdateEvent,
    SyncCustomActionResponse,
    ThreadMetadata,
    ThreadStreamEvent,
    UserMessageItem,
    WidgetItem,
)
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.context import DatasetMetadata, ReportAgentContext
from app.agents.query_models import build_query_plan_model
from app.agents.report_analyst import build_report_analyst
from app.chatkit.memory_store import DatabaseMemoryStore
from app.chatkit.metadata import (
    ThreadMetadataPatch,
    datasets_from_thread_metadata,
    merge_thread_metadata,
    normalize_thread_metadata,
)
from app.core.config import get_settings
from app.db.session import get_db


class ChatKitFrontendConfig:
    def __init__(self, model: str, tools: list[str], notes: list[str]):
        self.model = model
        self.tools = tools
        self.notes = notes


class UpdateThreadMetadataAction(
    Action[Literal["update_thread_metadata"], ThreadMetadataPatch]
):
    pass


class ReportFoundryChatKitServer(ChatKitServer[ReportAgentContext]):
    def __init__(self, db: AsyncSession):
        self.settings = get_settings()
        self.db = db
        store = DatabaseMemoryStore(db)
        super().__init__(store=store)
        self.frontend_config = ChatKitFrontendConfig(
            model=self.settings.chatkit_default_model,
            tools=[
                "list_accessible_datasets",
                "inspect_dataset_schema",
                "run_aggregate_query",
                "request_chart_render",
                "append_report_section",
                "name_current_thread",
            ],
            notes=[
                "Always stream agent responses.",
                "Keep row-scoped filters, projections, and group keys separate from aggregate measures.",
                "Prefer describe_numeric when you need descriptive statistics for a numeric column.",
                "The client executes validated plans against loaded CSV rows and renders charts locally.",
                "Thread metadata persists app state such as datasets, chart cache, and OpenAI conversation identifiers.",
            ],
        )

    async def build_request_context(
        self,
        raw_request: bytes | str,
        user_email: str,
    ) -> ReportAgentContext:
        payload = self._coerce_payload(raw_request)
        metadata = normalize_thread_metadata(payload.get("metadata"))
        thread_id = self._extract_thread_id(payload)
        datasets = self._coerce_datasets(
            metadata.get("datasets") or payload.get("datasets") or []
        )
        dataset_ids = list(
            metadata.get("dataset_ids") or [dataset.id for dataset in datasets]
        )
        chart_cache = dict(metadata.get("chart_cache") or {})
        query_plan_model, query_plan_schema = build_query_plan_model(datasets)

        return ReportAgentContext(
            report_id=thread_id or "pending_thread",
            user_email=user_email,
            db=self.db,
            dataset_ids=dataset_ids,
            chart_cache=chart_cache,
            thread_metadata=metadata,
            available_datasets=datasets,
            query_plan_model=query_plan_model,
            query_plan_schema=query_plan_schema,
        )

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: ReportAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        typed_metadata = normalize_thread_metadata(thread.metadata)
        context.report_id = thread.id
        context.thread_metadata = typed_metadata
        context.chart_cache = dict(typed_metadata.get("chart_cache") or {})
        context.dataset_ids = list(
            typed_metadata.get("dataset_ids") or context.dataset_ids
        )
        if not context.available_datasets:
            context.available_datasets = datasets_from_thread_metadata(typed_metadata)
            context.query_plan_model, context.query_plan_schema = (
                build_query_plan_model(context.available_datasets)
            )

        items_page = await self.store.load_thread_items(
            thread.id,
            after=None,
            limit=1000,
            order="asc",
            context=context,
        )
        agent_input = await simple_to_agent_input(items_page.data)
        agent = build_report_analyst(context)
        chatkit_context = ChatKitAgentContext[ReportAgentContext](
            thread=thread,
            store=self.store,
            request_context=context,
        )
        context.emit_event = chatkit_context.stream

        result = Runner.run_streamed(
            agent,
            agent_input,
            context=context,
            conversation_id=typed_metadata.get("openai_conversation_id"),
            previous_response_id=typed_metadata.get("openai_previous_response_id"),
        )
        async for event in stream_agent_response(chatkit_context, result):
            yield event

        if context.requested_thread_title:
            thread.title = context.requested_thread_title

        updated_metadata = merge_thread_metadata(
            typed_metadata,
            cast(
                ThreadMetadataPatch,
                {
                    "title": context.requested_thread_title
                    or typed_metadata.get("title"),
                    "openai_conversation_id": getattr(result, "_conversation_id", None),
                    "openai_previous_response_id": result.last_response_id,
                    "chart_cache": context.chart_cache,
                    "dataset_ids": context.dataset_ids,
                    "datasets": [
                        self._dataset_to_dict(dataset)
                        for dataset in context.available_datasets
                    ],
                },
            ),
        )
        thread.metadata = updated_metadata
        await self.store.save_thread(thread, context=context)

    async def action(
        self,
        thread: ThreadMetadata,
        action: Action[str, Any],
        sender: WidgetItem | None,
        context: ReportAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        if action.type == "update_thread_metadata" and isinstance(action.payload, dict):
            current_metadata = normalize_thread_metadata(thread.metadata)
            patch = cast(ThreadMetadataPatch, action.payload)
            thread.metadata = merge_thread_metadata(current_metadata, patch)
            if patch.get("title"):
                thread.title = patch["title"]
            await self.store.save_thread(thread, context=context)
            yield ProgressUpdateEvent(text="Saved thread metadata update.")
            return

        yield ProgressUpdateEvent(text=f"Unhandled action: {action.type}")

    async def sync_action(
        self,
        thread: ThreadMetadata,
        action: Action[str, Any],
        sender: WidgetItem | None,
        context: ReportAgentContext,
    ) -> SyncCustomActionResponse:
        if action.type == "update_thread_metadata" and isinstance(action.payload, dict):
            current_metadata = normalize_thread_metadata(thread.metadata)
            patch = cast(ThreadMetadataPatch, action.payload)
            thread.metadata = merge_thread_metadata(current_metadata, patch)
            if patch.get("title"):
                thread.title = patch["title"]
            await self.store.save_thread(thread, context=context)
        return SyncCustomActionResponse(updated_item=sender)

    async def list_threads_for_user(self, user_email: str):
        context = ReportAgentContext(
            report_id="list", user_email=user_email, db=self.db
        )
        return await self.store.load_threads(
            limit=100, after=None, order="desc", context=context
        )

    def _coerce_payload(self, raw_request: bytes | str) -> dict[str, Any]:
        if isinstance(raw_request, bytes):
            raw_request = raw_request.decode("utf-8")
        try:
            payload = json.loads(raw_request)
        except (TypeError, ValueError):
            return {}
        return payload if isinstance(payload, dict) else {}

    def _extract_thread_id(self, payload: dict[str, Any]) -> str | None:
        params = payload.get("params")
        if isinstance(params, dict):
            thread_id = params.get("thread_id")
            if isinstance(thread_id, str) and thread_id:
                return thread_id
        for key in ("threadId", "thread_id"):
            candidate = payload.get(key)
            if isinstance(candidate, str) and candidate:
                return candidate
        return None

    def _coerce_datasets(
        self, raw_datasets: list[dict[str, Any]]
    ) -> list[DatasetMetadata]:
        datasets: list[DatasetMetadata] = []
        for raw in raw_datasets:
            columns = [str(column) for column in raw.get("columns", [])]
            sample_rows = [dict(row) for row in raw.get("sample_rows", [])]
            datasets.append(
                DatasetMetadata(
                    id=str(raw.get("id", "")),
                    name=str(raw.get("name", "dataset")),
                    columns=columns,
                    sample_rows=sample_rows,
                    row_count=int(raw.get("row_count", 0)),
                    numeric_columns=self._infer_numeric_columns(columns, sample_rows),
                )
            )
        return [dataset for dataset in datasets if dataset.id]

    def _infer_numeric_columns(
        self, columns: list[str], sample_rows: list[dict[str, Any]]
    ) -> list[str]:
        numeric_columns: list[str] = []
        for column in columns:
            values = [
                row.get(column)
                for row in sample_rows
                if row.get(column) not in (None, "")
            ]
            if values and all(self._is_number(value) for value in values):
                numeric_columns.append(column)
        return numeric_columns

    def _is_number(self, value: Any) -> bool:
        try:
            float(value)
        except (TypeError, ValueError):
            return False
        return True

    def _dataset_to_dict(self, dataset: DatasetMetadata) -> dict[str, object]:
        return {
            "id": dataset.id,
            "name": dataset.name,
            "columns": dataset.columns,
            "sample_rows": dataset.sample_rows,
            "row_count": dataset.row_count,
            "numeric_columns": dataset.numeric_columns,
        }


async def build_chatkit_server(
    db: AsyncSession = Depends(get_db),
) -> ReportFoundryChatKitServer:
    return ReportFoundryChatKitServer(db)
