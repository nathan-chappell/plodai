from __future__ import annotations

import asyncio
import json
import random
import re
from typing import Any, AsyncIterator, Literal, cast

from agents import Runner
from chatkit.actions import Action
from chatkit.agents import AgentContext as ChatKitAgentContext
from chatkit.agents import ThreadItemConverter, stream_agent_response
from chatkit.server import ChatKitServer
from chatkit.types import (
    Attachment,
    AudioInput,
    ChatKitReq,
    ClientToolCallItem,
    ProgressUpdateEvent,
    SyncCustomActionResponse,
    ThreadItem,
    ThreadMetadata,
    ThreadStreamEvent,
    TranscriptionResult,
    UserMessageItem,
    WidgetItem,
)
from fastapi import Depends
from openai import AsyncOpenAI
from openai.types.conversations.conversation_item import ConversationItem
from openai.types.responses.response_function_tool_call_item import (
    ResponseFunctionToolCallItem,
)
from openai.types.responses.response_input_item_param import (
    FunctionCallOutput,
    ResponseInputItemParam,
)
from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.agents.context import ReportAgentContext
from backend.app.agents.DatasetMetadata import DatasetMetadata
from backend.app.agents.query_models import build_query_plan_model
from backend.app.agents.report_analyst import build_report_analyst
from backend.app.chatkit.client_tools import (
    ClientToolCsvFile,
    ClientToolResultPayload,
    coerce_client_tool_result,
)
from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.chatkit.metadata import (
    ThreadMetadataPatch,
    merge_thread_metadata,
    normalize_thread_metadata,
)
from backend.app.chatkit.usage import (
    accumulate_transcription_usage,
    accumulate_usage,
    platform_logs_url,
)
from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger, summarize_for_log
from backend.app.db.session import get_db

logger = get_logger("chatkit.server")

MODEL_ALIASES = {
    "default": "gpt-5.1",
    "lightweight": "gpt-4.1-mini",
    "balanced": "gpt-4.1",
    "powerful": "gpt-5.1",
}
DEFAULT_MODEL = MODEL_ALIASES["default"]
MAX_AGENT_TURNS = 30
RATE_LIMIT_RETRY_PATTERN = re.compile(
    r"try again in\s+(?P<seconds>\d+(?:\.\d+)?)s",
    re.IGNORECASE,
)


class ClientToolResultConverter(ThreadItemConverter):
    async def attachment_to_message_content(self, attachment: Attachment):
        raise NotImplementedError(
            "ChatKit attachments are disabled for this app. Files are selected and processed locally, then exposed to the agent through client tools."
        )

    async def client_tool_call_to_input(self, item: ClientToolCallItem):
        if item.status == "pending" or item.output is None:
            return None
        return self.client_tool_result_to_input(
            coerce_client_tool_result(item.output),
            call_id=item.call_id,
            tool_name=item.name,
        )

    def client_tool_result_to_input(
        self,
        result: ClientToolResultPayload | None,
        *,
        call_id: str,
        tool_name: str | None = None,
    ):
        if result is None:
            return None

        image_url = result.get("imageDataUrl") or result.get("image_data_url")
        query_id = result.get("query_id") or result.get("queryId")
        row_count = result.get("row_count")
        csv_files = result.get("csv_files")
        sanitized_result = dict(result)
        sanitized_result.pop("imageDataUrl", None)
        sanitized_result.pop("image_data_url", None)

        function_call_output: FunctionCallOutput = {
            "type": "function_call_output",
            "call_id": call_id,
            "output": json.dumps(sanitized_result, ensure_ascii=True),
        }

        if isinstance(image_url, str) and image_url:
            description = (
                "A rendered client-side chart is attached for visual inspection."
            )
            if tool_name:
                description = f"The client tool '{tool_name}' completed successfully. A rendered chart image is attached for visual inspection."
            if isinstance(query_id, str) and query_id:
                description += f" Query id: {query_id}."
            if isinstance(row_count, int):
                description += f" Result row count: {row_count}."
            if isinstance(csv_files, list):
                description += f" CSV files available: {len(csv_files)}."

            function_call_output["output"] = [
                {
                    "type": "input_text",
                    "text": f"{description}\n\n{json.dumps(sanitized_result, ensure_ascii=True)}",
                },
                {"type": "input_image", "image_url": image_url, "detail": "high"},
            ]

        return cast(list[ResponseInputItemParam], [function_call_output])


class UpdateThreadMetadataAction(
    Action[Literal["update_thread_metadata"], ThreadMetadataPatch]
):
    pass


class ReportFoundryChatKitServer(ChatKitServer[ReportAgentContext]):
    def __init__(self, db: AsyncSession):
        self.settings = get_settings()
        self.db = db
        self.openai_client = AsyncOpenAI(
            api_key=self.settings.OPENAI_API_KEY or None,
            max_retries=self.settings.openai_max_retries,
        )
        store = DatabaseMemoryStore(db)
        super().__init__(store=store)
        self.converter = ClientToolResultConverter()
        self.logger = logger

    async def build_request_context(
        self, raw_request: bytes | str, user_email: str
    ) -> ReportAgentContext:
        parsed_request = TypeAdapter(ChatKitReq).validate_json(raw_request)
        metadata = normalize_thread_metadata(parsed_request.metadata)
        thread_id = getattr(parsed_request.params, "thread_id", None)
        recent_items = await self._load_recent_items(thread_id, user_email)
        datasets = self._datasets_from_recent_items(recent_items)
        query_plan_model, _ = build_query_plan_model(datasets)

        self.logger.info(
            f"request_context.build op={parsed_request.type} thread_id={thread_id} user_email={user_email} dataset_count={len(datasets)}"
        )

        return ReportAgentContext(
            report_id=thread_id or "pending_thread",
            user_email=user_email,
            db=self.db,
            dataset_ids=[dataset.id for dataset in datasets],
            chart_cache=dict(metadata.get("chart_cache") or {}),
            thread_metadata=metadata,
            available_datasets=datasets,
            query_plan_model=query_plan_model,
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

        recent_items = await self.store.load_thread_items(
            thread.id,
            after=None,
            limit=20,
            order="desc",
            context=context,
        )
        recent_item_data = recent_items.data
        context.available_datasets = self._datasets_from_recent_items(recent_item_data)
        context.dataset_ids = [dataset.id for dataset in context.available_datasets]
        context.query_plan_model, _ = build_query_plan_model(context.available_datasets)

        pending_items = self._collect_pending_items(
            recent_item_data,
            has_openai_conversation=bool(typed_metadata.get("openai_conversation_id")),
        )
        if input_user_message is not None and not any(
            item.id == input_user_message.id for item in pending_items
        ):
            pending_items.append(input_user_message)
        agent_input = await self.converter.to_agent_input(pending_items)
        requested_model = self._resolve_requested_model(
            input_user_message=input_user_message,
            recent_items=recent_item_data,
        )
        conversation_id = typed_metadata.get("openai_conversation_id")
        previous_response_id = typed_metadata.get("openai_previous_response_id")
        if conversation_id is None:
            conversation_id = await self._ensure_openai_conversation(thread, context)

        self.logger.info(
            f"respond.start thread_id={thread.id} user_email={context.user_email} model={requested_model} "
            f"pending_items={len(pending_items)} agent_input_items={len(agent_input)} "
            f"datasets={summarize_for_log(context.dataset_ids)} conversation_id={conversation_id} "
            f"conversation_logs={platform_logs_url(conversation_id)} previous_response_id={previous_response_id} "
            f"response_logs={platform_logs_url(previous_response_id)}"
        )

        agent = build_report_analyst(context, model=requested_model)
        agent_context = ChatKitAgentContext[ReportAgentContext](
            thread=thread, store=self.store, request_context=context
        )
        max_retries = max(0, self.settings.openai_max_retries)
        result = None
        next_agent_input = agent_input

        for attempt in range(max_retries + 1):
            run_started = False
            try:
                result = Runner.run_streamed(
                    agent,
                    next_agent_input,
                    context=agent_context,
                    max_turns=MAX_AGENT_TURNS,
                    conversation_id=conversation_id,
                )
                run_started = True
                async for event in stream_agent_response(agent_context, result):
                    yield event
                break
            except Exception as exc:
                attempt_number = attempt + 1
                total_attempts = max_retries + 1
                retry_delay_seconds = self._compute_retry_delay_seconds(exc)

                self.logger.warning(
                    f"respond.retry thread_id={thread.id} user_email={context.user_email} conversation_id={conversation_id} "
                    f"attempt={attempt_number}/{total_attempts} delay_seconds={retry_delay_seconds:.3f} "
                    f"error={summarize_for_log(str(exc))}"
                )
                yield ProgressUpdateEvent(
                    text=(
                        f"The model run hit an error. Waiting about {retry_delay_seconds:.1f}s before retry "
                        f"({attempt_number}/{total_attempts})."
                    )
                )

                if conversation_id and run_started:
                    dangling_tool_calls = await self._close_dangling_tool_calls(
                        conversation_id,
                        exc,
                    )
                    if dangling_tool_calls:
                        yield ProgressUpdateEvent(
                            text=f"Recovered {dangling_tool_calls} unfinished tool call(s) before retrying."
                        )

                if attempt >= max_retries:
                    self.logger.exception(
                        f"respond.error thread_id={thread.id} user_email={context.user_email} conversation_id={conversation_id} previous_response_id={previous_response_id}"
                    )
                    raise

                if retry_delay_seconds >= 5:
                    yield ProgressUpdateEvent(
                        text="Still working. The server will keep retrying automatically."
                    )

                await asyncio.sleep(retry_delay_seconds)
                yield ProgressUpdateEvent(text="Retrying the OpenAI run now.")

                if run_started:
                    next_agent_input = []

        if result is None:
            raise RuntimeError("ChatKit agent run completed without a run result.")

        result_conversation_id = (
            getattr(result, "conversation_id", None)
            or getattr(result, "_conversation_id", None)
            or conversation_id
        )
        result_response_id = result.last_response_id
        updated_usage = accumulate_usage(
            typed_metadata.get("usage"),
            result.context_wrapper.usage,
            model=requested_model,
        )
        updated_metadata = merge_thread_metadata(
            typed_metadata,
            cast(
                ThreadMetadataPatch,
                {
                    "title": thread.title or typed_metadata.get("title"),
                    "openai_conversation_id": result_conversation_id,
                    "openai_previous_response_id": result_response_id,
                    "chart_cache": context.chart_cache,
                    "usage": updated_usage,
                },
            ),
        )
        thread.metadata = dict(updated_metadata)

        self.logger.info(
            f"respond.end thread_id={thread.id} user_email={context.user_email} "
            f"conversation_id={result_conversation_id} conversation_logs={platform_logs_url(result_conversation_id)} "
            f"response_id={result_response_id} response_logs={platform_logs_url(result_response_id)} "
            f"input_tokens={updated_usage.get('input_tokens', 0)} output_tokens={updated_usage.get('output_tokens', 0)} "
            f"est_cost_usd={updated_usage.get('estimated_cost_usd', 0.0)} title={summarize_for_log(thread.title or '')}"
        )

    def _resolve_requested_model(
        self,
        *,
        input_user_message: UserMessageItem | None,
        recent_items: list[ThreadItem],
    ) -> str:
        if (
            input_user_message is not None
            and input_user_message.inference_options.model
        ):
            return self._map_requested_model(input_user_message.inference_options.model)

        for item in recent_items:
            if item.type == "user_message" and item.inference_options.model:
                return self._map_requested_model(item.inference_options.model)

        return self._map_requested_model(None)

    @classmethod
    def _map_requested_model(cls, requested_model: str | None) -> str:
        if requested_model is None:
            return DEFAULT_MODEL
        return MODEL_ALIASES.get(requested_model, requested_model)

    async def _ensure_openai_conversation(
        self,
        thread: ThreadMetadata,
        context: ReportAgentContext,
    ) -> str:
        metadata: dict[str, str] = {
            "app": "report-foundry",
            "thread_id": thread.id,
            "user_email": context.user_email,
        }
        if context.dataset_ids:
            metadata["dataset_ids"] = ",".join(context.dataset_ids)[:512]
        if thread.title:
            metadata["thread_title"] = thread.title[:512]

        conversation = await self.openai_client.conversations.create(metadata=metadata)
        self.logger.info(
            f"respond.conversation_created thread_id={thread.id} user_email={context.user_email} conversation_id={conversation.id} conversation_logs={platform_logs_url(conversation.id)}"
        )
        return conversation.id

    def _extract_retry_delay_seconds(self, exc: Exception) -> float | None:
        match = RATE_LIMIT_RETRY_PATTERN.search(str(exc))
        if match is None:
            return None
        try:
            return max(0.0, float(match.group("seconds")))
        except ValueError:
            return None

    def _compute_retry_delay_seconds(self, exc: Exception) -> float:
        hinted_delay = self._extract_retry_delay_seconds(exc)
        if hinted_delay is not None:
            return hinted_delay
        return max(0.0, 2.0 + random.uniform(-0.5, 0.5))

    async def _list_conversation_items(
        self, conversation_id: str, *, limit: int = 100
    ) -> list[ConversationItem]:
        items: list[ConversationItem] = []
        async for item in self.openai_client.conversations.items.list(
            conversation_id,
            order="asc",
            limit=limit,
        ):
            items.append(item)
        return items

    async def _find_dangling_tool_calls(
        self, conversation_id: str
    ) -> list[ResponseFunctionToolCallItem]:
        items = await self._list_conversation_items(conversation_id)
        trailing_items: list[ConversationItem] = []
        for item in reversed(items):
            if item.type in {"function_call", "function_call_output"}:
                trailing_items.append(item)
                continue
            break

        resolved_call_ids = {
            item.call_id
            for item in trailing_items
            if item.type == "function_call_output"
        }
        dangling_tool_calls = [
            cast(ResponseFunctionToolCallItem, item)
            for item in reversed(trailing_items)
            if item.type == "function_call" and item.call_id not in resolved_call_ids
        ]

        self.logger.info(
            f"conversation.validate conversation_id={conversation_id} conversation_logs={platform_logs_url(conversation_id)} "
            f"trailing_items={len(trailing_items)} dangling_tool_calls={len(dangling_tool_calls)}"
        )
        return dangling_tool_calls

    async def _close_dangling_tool_calls(
        self,
        conversation_id: str,
        exc: Exception,
    ) -> int:
        dangling_tool_calls = await self._find_dangling_tool_calls(conversation_id)
        if not dangling_tool_calls:
            return 0

        detailed_error = (
            "The previous model run ended unexpectedly before all client tool calls received outputs. "
            "This tool call is being closed automatically so the conversation can continue. "
            f"Underlying error: {str(exc)}"
        )
        brief_error = (
            "The previous model run ended unexpectedly before this tool call received an output. "
            "It is being closed automatically so the conversation can continue."
        )
        outputs: list[FunctionCallOutput] = []
        for index, item in enumerate(dangling_tool_calls):
            outputs.append(
                {
                    "type": "function_call_output",
                    "call_id": item.call_id,
                    "output": detailed_error if index == 0 else brief_error,
                }
            )

        await self.openai_client.conversations.items.create(
            conversation_id,
            items=outputs,
        )
        self.logger.warning(
            f"conversation.recovered_dangling_tool_calls conversation_id={conversation_id} conversation_logs={platform_logs_url(conversation_id)} "
            f"count={len(dangling_tool_calls)}"
        )
        return len(dangling_tool_calls)

    async def _load_recent_items(
        self, thread_id: str | None, user_email: str
    ) -> list[ThreadItem]:
        if not thread_id:
            return []
        context = ReportAgentContext(
            report_id=thread_id, user_email=user_email, db=self.db
        )
        try:
            page = await self.store.load_thread_items(
                thread_id,
                after=None,
                limit=20,
                order="desc",
                context=context,
            )
        except Exception:
            return []
        return page.data

    def _datasets_from_recent_items(
        self, recent_items: list[ThreadItem]
    ) -> list[DatasetMetadata]:
        for item in recent_items:
            if item.type != "client_tool_call":
                continue
            if item.name != "list_attached_csv_files" or item.status != "completed":
                continue
            result = coerce_client_tool_result(item.output)
            datasets = self._datasets_from_client_tool_result(result)
            if datasets:
                return datasets
        return []

    def _datasets_from_client_tool_result(
        self, result: ClientToolResultPayload | None
    ) -> list[DatasetMetadata]:
        if result is None:
            return []
        raw_csv_files = result.get("csv_files")
        if not isinstance(raw_csv_files, list):
            return []

        datasets: list[DatasetMetadata] = []
        for raw_file in raw_csv_files:
            if not isinstance(raw_file, dict):
                continue
            csv_file = cast(ClientToolCsvFile, raw_file)
            dataset_id = str(csv_file.get("id", "")).strip()
            if not dataset_id:
                continue
            datasets.append(
                DatasetMetadata(
                    id=dataset_id,
                    name=str(csv_file.get("name", "CSV file")),
                    columns=[str(column) for column in csv_file.get("columns", [])],
                    sample_rows=[
                        {str(key): value for key, value in row.items()}
                        for row in csv_file.get("sample_rows", [])
                        if isinstance(row, dict)
                    ],
                    row_count=int(csv_file.get("row_count", 0)),
                    numeric_columns=[
                        str(column) for column in csv_file.get("numeric_columns", [])
                    ],
                )
            )
        return datasets

    def _collect_pending_items(
        self,
        recent_items: list[ThreadItem],
        *,
        has_openai_conversation: bool,
    ) -> list[ThreadItem]:
        chronological_items = list(reversed(recent_items))
        boundary_index = -1
        for index, item in enumerate(chronological_items):
            if item.type in {"assistant_message", "client_tool_call"}:
                boundary_index = index

        if boundary_index < 0:
            if has_openai_conversation:
                raise RuntimeError(
                    "Unable to recover recent thread context: no previous OpenAI output found in the last 20 thread items."
                )
            return chronological_items

        boundary_item = chronological_items[boundary_index]
        if boundary_index == len(chronological_items) - 1:
            if (
                boundary_item.type == "client_tool_call"
                and boundary_item.status == "completed"
            ):
                return [boundary_item]
            return []

        return chronological_items[boundary_index + 1 :]

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
            thread.metadata = dict(merge_thread_metadata(current_metadata, patch))
            if title := patch.get("title"):
                thread.title = title
            await self.store.save_thread(thread, context=context)
            self.logger.info(
                f"thread_metadata.updated thread_id={thread.id} user_email={context.user_email} title={summarize_for_log(thread.title or '')}"
            )
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
            thread.metadata = dict(merge_thread_metadata(current_metadata, patch))
            if title := patch.get("title"):
                thread.title = title
            await self.store.save_thread(thread, context=context)
            self.logger.info(
                f"thread_metadata.sync_updated thread_id={thread.id} user_email={context.user_email} title={summarize_for_log(thread.title or '')}"
            )
        return SyncCustomActionResponse(updated_item=sender)

    async def list_threads_for_user(self, user_email: str):
        context = ReportAgentContext(
            report_id="list", user_email=user_email, db=self.db
        )
        return await self.store.load_threads(
            limit=100, after=None, order="desc", context=context
        )

    async def transcribe(
        self, audio_input: AudioInput, context: ReportAgentContext
    ) -> TranscriptionResult:
        model = "gpt-4o-mini-transcribe"
        self.logger.info(
            f"transcribe.start report_id={context.report_id} user_email={context.user_email} mime_type={audio_input.mime_type} bytes={len(audio_input.data)} model={model}"
        )
        result = await self.openai_client.audio.transcriptions.create(
            file=("dictation.webm", audio_input.data, audio_input.media_type),
            model=model,
            response_format="verbose_json",
        )
        seconds = float(getattr(result, "duration", 0.0) or 0.0)
        context.thread_metadata["usage"] = accumulate_transcription_usage(
            context.thread_metadata.get("usage"),
            model=model,
            seconds=seconds,
        )
        self.logger.info(
            f"transcribe.end report_id={context.report_id} user_email={context.user_email} model={model} seconds={seconds} "
            f"est_cost_usd={context.thread_metadata.get('usage', {}).get('estimated_cost_usd', 0.0)} text_chars={len(result.text)}"
        )
        return TranscriptionResult(text=result.text)


async def build_chatkit_server(
    db: AsyncSession = Depends(get_db),
) -> ReportFoundryChatKitServer:
    return ReportFoundryChatKitServer(db)

