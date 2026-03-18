from __future__ import annotations

import asyncio
from base64 import b64decode
from binascii import Error as BinasciiError
from datetime import datetime
import json
import logging
import random
import re
from hashlib import sha256
from typing import Any, AsyncIterator, Literal, cast
from uuid import uuid4

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
    StreamingReq,
    HiddenContextItem,
    ProgressUpdateEvent,
    SyncCustomActionResponse,
    ThreadItem,
    ThreadItemDoneEvent,
    ThreadItemRemovedEvent,
    ThreadItemReplacedEvent,
    ThreadMetadata,
    ThreadStreamEvent,
    ThreadsAddClientToolOutputReq,
    TranscriptionResult,
    UserMessageItem,
    WidgetItem,
)
from fastapi import Depends
from openai import AsyncOpenAI
from openai.types.conversations.conversation_item import ConversationItem
from openai.types.responses import (
    ResponseFunctionCallOutputItemListParam,
    ResponseInputTextParam,
)
from openai.types.responses.response_function_tool_call_item import (
    ResponseFunctionToolCallItem,
)
from openai.types.responses.response_input_item_param import (
    FunctionCallOutput,
    Message,
    ResponseInputItemParam,
)
from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.agents.agent_builder import build_registered_agent
from backend.app.agents.context import ReportAgentContext
from backend.app.agents.query_models import build_query_plan_model
from backend.app.agents.workspace_file import (
    CsvWorkspaceMetadata,
    JsonWorkspaceMetadata,
    PdfWorkspaceMetadata,
    WorkspaceFileMetadata,
)
from backend.app.agents.widgets import (
    build_workspace_context_copy_text,
    build_workspace_context_widget,
)
from backend.app.chatkit.client_tools import (
    ClientToolCsvFile,
    ClientToolResultPayload,
    ClientToolWorkspaceFile,
    coerce_client_tool_result,
)
from backend.app.chatkit.feedback_types import (
    CancelFeedbackDetailsPayload,
    ChatItemFeedbackRecord,
    FeedbackOrigin,
    SubmitFeedbackDetailsPayload,
)
from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.chatkit.metadata import (
    ExecutionMode,
    WorkspaceContext,
    ThreadMetadataPatch,
    merge_thread_metadata,
    normalize_thread_metadata,
)
from backend.app.chatkit.usage import (
    accumulate_transcription_usage,
    accumulate_usage,
    calculate_transcription_cost_usd,
    calculate_usage_cost_usd,
    platform_logs_url,
)
from backend.app.core.config import get_settings
from backend.app.core.logging import (
    get_logger,
    log_event,
    summarize_mapping_keys_for_log,
    summarize_sequence_for_log,
)
from backend.app.db.session import get_db
from backend.app.models.chatkit import ChatItemFeedback
from backend.app.services.credit_service import CreditService

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
BATCH_MODE_CONTINUATION_PATTERNS = (
    re.compile(r"\bwould you like me to\b", re.IGNORECASE),
    re.compile(r"\bdo you want me to\b", re.IGNORECASE),
    re.compile(r"\bshould I\b", re.IGNORECASE),
    re.compile(r"\bcan you confirm\b", re.IGNORECASE),
    re.compile(r"\bif you'd like\b", re.IGNORECASE),
    re.compile(r"\blet me know if\b", re.IGNORECASE),
)
BATCH_MODE_HARD_BLOCK_PATTERNS = (
    re.compile(r"\bI (?:can't|cannot|do not have)\b", re.IGNORECASE),
    re.compile(r"\bpermission\b", re.IGNORECASE),
    re.compile(r"\bmissing\b", re.IGNORECASE),
    re.compile(r"\bunavailable\b", re.IGNORECASE),
    re.compile(r"\bnot present\b", re.IGNORECASE),
)
BATCH_MODE_CONTINUE_TEXT = (
    "Batch mode is enabled. Do not wait for user confirmation when a reasonable next "
    "step is available. Continue with the strongest best-effort assumptions you can "
    "make from the current request, the workspace, and the existing results. Only stop "
    "if you are genuinely blocked by missing data, permissions, or an unavailable capability."
)
CLIENT_TOOL_OUTPUT_LOOKBACK_LIMIT = 20
CLIENT_TOOL_OUTPUT_RETRY_DELAYS = (0.0, 0.05, 0.12, 0.25)


def _summarize_client_tool_result_for_log(
    result: ClientToolResultPayload | None,
) -> dict[str, object]:
    if result is None:
        return {"result": "none"}

    summary: dict[str, object] = {
        "result_keys": summarize_mapping_keys_for_log(result),
    }
    query_id = result.get("query_id") or result.get("queryId")
    if isinstance(query_id, str) and query_id:
        summary["query_id"] = query_id
    row_count = result.get("row_count")
    if isinstance(row_count, int):
        summary["row_count"] = row_count
    rows = result.get("rows")
    if isinstance(rows, list):
        summary["rows"] = len(rows)
    if isinstance(result.get("imageDataUrl") or result.get("image_data_url"), str):
        summary["has_image"] = True
    cwd_path = result.get("cwd_path")
    if isinstance(cwd_path, str) and cwd_path:
        summary["cwd_path"] = cwd_path
    file_input = result.get("file_input")
    if isinstance(file_input, dict):
        summary["has_file_input"] = True
        summary["file_input_keys"] = summarize_mapping_keys_for_log(file_input)
    for key in ("files", "csv_files", "chartable_files"):
        raw_value = result.get(key)
        if isinstance(raw_value, list):
            summary[key] = len(raw_value)
    created_file = result.get("created_file")
    if isinstance(created_file, dict):
        summary["created_file_kind"] = created_file.get("kind")
        if created_file.get("id"):
            summary["created_file_id"] = created_file.get("id")
    chart = result.get("chart")
    if isinstance(chart, dict):
        summary["chart_keys"] = summarize_mapping_keys_for_log(chart)
        chart_type = chart.get("type")
        if chart_type:
            summary["chart_type"] = chart_type
    for key in ("page_range", "pdf_inspection", "smart_split"):
        raw_value = result.get(key)
        if isinstance(raw_value, dict):
            summary[f"{key}_keys"] = summarize_mapping_keys_for_log(raw_value)
    value = result.get("value")
    if value is not None:
        summary["value_type"] = type(value).__name__
    return summary


def _workspace_context_from_tool_result(
    result: ClientToolResultPayload | None,
) -> WorkspaceContext | None:
    if result is None:
        return None
    raw_context = result.get("workspace_context")
    if not isinstance(raw_context, dict):
        return None
    cwd_path = raw_context.get("cwd_path")
    referenced_item_ids = raw_context.get("referenced_item_ids")
    if not isinstance(cwd_path, str) or not cwd_path.strip():
        return None
    if not isinstance(referenced_item_ids, list):
        return None
    return {
        "cwd_path": cwd_path.strip(),
        "referenced_item_ids": [
            str(item).strip()
            for item in referenced_item_ids
            if isinstance(item, str) and str(item).strip()
        ],
    }


class ClientToolResultConverter(ThreadItemConverter):
    def __init__(self, openai_client: AsyncOpenAI, upload_cache: dict[str, str]):
        self.openai_client = openai_client
        self.upload_cache = upload_cache

    async def attachment_to_message_content(self, attachment: Attachment):
        raise NotImplementedError(
            "ChatKit attachments are disabled for this app. Files are selected and processed locally, then exposed to the agent through client tools."
        )

    async def client_tool_call_to_input(self, item: ClientToolCallItem):
        if item.status == "pending" or item.output is None:
            return None
        result = coerce_client_tool_result(item.output)
        log_event(
            logger,
            logging.INFO,
            "tool.output.received",
            call_id=item.call_id,
            tool_name=item.name,
            status=item.status,
            **_summarize_client_tool_result_for_log(result),
        )
        return await self.client_tool_result_to_input(
            result,
            call_id=item.call_id,
            tool_name=item.name,
        )

    async def client_tool_result_to_input(
        self,
        result: ClientToolResultPayload | None,
        *,
        call_id: str,
        tool_name: str | None = None,
    ):
        if result is None:
            return None

        image_url = result.get("imageDataUrl") or result.get("image_data_url")
        file_input = result.get("file_input")
        query_id = result.get("query_id") or result.get("queryId")
        row_count = result.get("row_count")
        csv_files = result.get("csv_files")
        sanitized_result = dict(result)
        sanitized_result.pop("imageDataUrl", None)
        sanitized_result.pop("image_data_url", None)
        uploaded_file_id: str | None = None
        if isinstance(file_input, dict):
            sanitized_file_input = dict(file_input)
            if "file_data" in sanitized_file_input:
                sanitized_file_input["file_data"] = "[omitted_base64_file_data]"
            uploaded_file_id = await self._upload_file_input(file_input)
            if uploaded_file_id is not None:
                sanitized_file_input["file_id"] = uploaded_file_id
            sanitized_result["file_input"] = sanitized_file_input

        function_call_output: FunctionCallOutput = {
            "type": "function_call_output",
            "call_id": call_id,
            "output": json.dumps(sanitized_result, ensure_ascii=True),
        }

        rich_output: ResponseFunctionCallOutputItemListParam = []
        if isinstance(image_url, str) and image_url or isinstance(file_input, dict):
            description = "The client tool completed successfully."
            if tool_name:
                description = f"The client tool '{tool_name}' completed successfully."
            if isinstance(image_url, str) and image_url:
                description += (
                    " A rendered chart image is attached for visual inspection."
                )
            if isinstance(file_input, dict):
                description += " A derived file is attached for downstream inspection."
            if isinstance(query_id, str) and query_id:
                description += f" Query id: {query_id}."
            if isinstance(row_count, int):
                description += f" Result row count: {row_count}."
            if isinstance(csv_files, list):
                description += f" CSV files available: {len(csv_files)}."
            rich_output.append(
                {
                    "type": "input_text",
                    "text": (
                        f"{description}\n\n"
                        f"{json.dumps(sanitized_result, ensure_ascii=True)}"
                    ),
                }
            )

        if isinstance(image_url, str) and image_url:
            rich_output.append(
                {"type": "input_image", "image_url": image_url, "detail": "high"}
            )

        if uploaded_file_id is not None:
            rich_output.append(
                {
                    "type": "input_file",
                    "file_id": uploaded_file_id,
                }
            )

        if rich_output:
            function_call_output["output"] = rich_output

        return cast(list[ResponseInputItemParam], [function_call_output])

    async def _upload_file_input(self, file_input: dict[str, object]) -> str | None:
        filename = file_input.get("filename")
        file_data = file_input.get("file_data")
        mime_type = file_input.get("mime_type")
        if (
            not isinstance(filename, str)
            or not filename
            or not isinstance(file_data, str)
            or not file_data
        ):
            return None

        cache_key = sha256(f"{filename}\0{file_data}".encode("utf-8")).hexdigest()
        cached_file_id = self.upload_cache.get(cache_key)
        if cached_file_id is not None:
            return cached_file_id

        try:
            file_bytes = b64decode(file_data, validate=True)
        except BinasciiError as exc:
            raise ValueError(f"Invalid base64 file payload for {filename}.") from exc

        uploaded_file = await self.openai_client.files.create(
            file=(
                filename,
                file_bytes,
                mime_type if isinstance(mime_type, str) and mime_type else "application/octet-stream",
            ),
            purpose="user_data",
        )
        self.upload_cache[cache_key] = uploaded_file.id
        return uploaded_file.id


class UpdateThreadMetadataAction(
    Action[Literal["update_thread_metadata"], ThreadMetadataPatch]
):
    pass


class ClientWorkspaceChatKitServer(ChatKitServer[ReportAgentContext]):
    def __init__(self, db: AsyncSession):
        self.settings = get_settings()
        self.db = db
        self.openai_client = AsyncOpenAI(
            api_key=self.settings.OPENAI_API_KEY or None,
            max_retries=self.settings.openai_max_retries,
        )
        self._uploaded_file_ids: dict[str, str] = {}
        store = DatabaseMemoryStore(db)
        super().__init__(store=store)
        self.converter = ClientToolResultConverter(
            self.openai_client,
            self._uploaded_file_ids,
        )
        self.logger = logger

    async def build_request_context(
        self, raw_request: bytes | str, user_id: str, user_email: str | None
    ) -> ReportAgentContext:
        parsed_request = TypeAdapter(ChatKitReq).validate_json(raw_request)
        metadata = normalize_thread_metadata(parsed_request.metadata)
        thread_id = getattr(parsed_request.params, "thread_id", None)
        recent_items = await self._load_recent_items(thread_id, user_id)
        recovered_workspace_context = self._workspace_context_from_recent_items(recent_items)
        if recovered_workspace_context is not None:
            metadata["workspace_context"] = recovered_workspace_context
        files = self._files_from_recent_items(recent_items)
        context = ReportAgentContext(
            report_id=thread_id or "pending_thread",
            user_id=user_id,
            user_email=user_email,
            db=self.db,
            chart_cache=dict(metadata.get("chart_cache") or {}),
            thread_metadata=metadata,
            available_files=files,
            capability_bundle=metadata.get("capability_bundle"),
        )
        query_plan_model, _ = build_query_plan_model(context.available_datasets)
        context.query_plan_model = query_plan_model

        log_event(
            self.logger,
            logging.INFO,
            "request_context.build",
            op=parsed_request.type,
            thread_id=thread_id,
            user_id=user_id,
            file_count=len(files),
            dataset_count=len(context.available_datasets),
        )

        return context

    async def _find_pending_client_tool_call(
        self,
        thread_id: str,
        context: ReportAgentContext,
    ) -> ClientToolCallItem | None:
        for attempt, delay_seconds in enumerate(CLIENT_TOOL_OUTPUT_RETRY_DELAYS, start=1):
            if delay_seconds:
                await asyncio.sleep(delay_seconds)

            items = await self.store.load_thread_items(
                thread_id,
                after=None,
                limit=CLIENT_TOOL_OUTPUT_LOOKBACK_LIMIT,
                order="desc",
                context=context,
            )
            tool_call = next(
                (
                    item
                    for item in items.data
                    if isinstance(item, ClientToolCallItem) and item.status == "pending"
                ),
                None,
            )
            if tool_call is not None:
                if attempt > 1:
                    log_event(
                        self.logger,
                        logging.INFO,
                        "client_tool_output.pending_call_recovered",
                        thread_id=thread_id,
                        user_id=context.user_id,
                        attempt=attempt,
                        call_id=tool_call.call_id,
                        item_id=tool_call.id,
                    )
                return tool_call

        log_event(
            self.logger,
            logging.WARNING,
            "client_tool_output.pending_call_missing",
            thread_id=thread_id,
            user_id=context.user_id,
            lookback_limit=CLIENT_TOOL_OUTPUT_LOOKBACK_LIMIT,
            attempts=len(CLIENT_TOOL_OUTPUT_RETRY_DELAYS),
        )
        return None

    async def _process_streaming_impl(
        self,
        request: StreamingReq,
        context: ReportAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        if isinstance(request, ThreadsAddClientToolOutputReq):
            thread = await self.store.load_thread(
                request.params.thread_id,
                context=context,
            )
            tool_call = await self._find_pending_client_tool_call(thread.id, context)
            if tool_call is None:
                raise ValueError(
                    f"No pending ClientToolCallItem found in recent items for {thread.id}"
                )

            tool_call.output = request.params.result
            tool_call.status = "completed"
            await self.store.save_item(thread.id, tool_call, context=context)
            await self._cleanup_pending_client_tool_call(thread, context)

            async for event in self._process_events(
                thread,
                context,
                lambda: self.respond(thread, None, context),
            ):
                yield event
            return

        async for event in super()._process_streaming_impl(request, context):
            yield event

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: ReportAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        typed_metadata = normalize_thread_metadata(thread.metadata)
        request_metadata = normalize_thread_metadata(context.thread_metadata)
        runtime_patch = self._runtime_metadata_patch(
            current_metadata=typed_metadata,
            request_metadata=request_metadata,
        )
        if runtime_patch:
            typed_metadata = merge_thread_metadata(typed_metadata, runtime_patch)
            thread.metadata = dict(typed_metadata)
            await self.store.save_thread(thread, context=context)
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
        recovered_workspace_context = self._workspace_context_from_recent_items(
            recent_item_data
        )
        if recovered_workspace_context is not None and (
            typed_metadata.get("workspace_context") != recovered_workspace_context
        ):
            typed_metadata = merge_thread_metadata(
                typed_metadata,
                {"workspace_context": recovered_workspace_context},
            )
            thread.metadata = dict(typed_metadata)
            await self.store.save_thread(thread, context=context)
        context.available_files = self._files_from_recent_items(recent_item_data)
        context.query_plan_model, _ = build_query_plan_model(context.available_datasets)
        context.capability_bundle = typed_metadata.get("capability_bundle")
        context.thread_metadata = typed_metadata
        if context.capability_bundle is None:
            raise RuntimeError(
                "No registered capability bundle is available for this thread or request surface."
            )

        async for event in self._sync_workspace_context_items(
            thread,
            recent_item_data,
            context=context,
        ):
            yield event

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

        log_event(
            self.logger,
            logging.INFO,
            "respond.start",
            thread_id=thread.id,
            user_id=context.user_id,
            model=requested_model,
            pending_items=len(pending_items),
            agent_input_items=len(agent_input),
            dataset_count=len(context.dataset_ids),
            dataset_ids=summarize_sequence_for_log(context.dataset_ids),
            conversation_id=conversation_id,
            conversation_logs=platform_logs_url(conversation_id),
            previous_response_id=previous_response_id,
            response_logs=platform_logs_url(previous_response_id),
        )

        agent = build_registered_agent(context, model=requested_model)
        agent_context = ChatKitAgentContext[ReportAgentContext](
            thread=thread, store=self.store, request_context=context
        )
        max_retries = max(0, self.settings.openai_max_retries)
        next_agent_input = agent_input
        continuation_used = False
        final_response_id: str | None = None
        final_conversation_id = conversation_id
        updated_usage = typed_metadata.get("usage")

        while True:
            result = None
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

                    log_event(
                        self.logger,
                        logging.WARNING,
                        "respond.retry",
                        thread_id=thread.id,
                        user_id=context.user_id,
                        conversation_id=conversation_id,
                        attempt=f"{attempt_number}/{total_attempts}",
                        delay_seconds=f"{retry_delay_seconds:.3f}",
                        error=str(exc),
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
                        log_event(
                            self.logger,
                            logging.ERROR,
                            "respond.error",
                            exc_info=exc,
                            thread_id=thread.id,
                            user_id=context.user_id,
                            conversation_id=conversation_id,
                            previous_response_id=previous_response_id,
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
            response_cost_usd = 0.0
            if result.context_wrapper.usage is not None:
                response_cost_usd = calculate_usage_cost_usd(
                    requested_model,
                    result.context_wrapper.usage,
                )
            updated_usage = accumulate_usage(
                updated_usage,
                result.context_wrapper.usage,
                model=requested_model,
            )
            await CreditService.record_cost_event(
                user_id=context.user_id,
                thread_id=thread.id,
                response_id=result_response_id,
                cost_usd=response_cost_usd,
            )
            typed_metadata = merge_thread_metadata(
                typed_metadata,
                cast(
                    ThreadMetadataPatch,
                    {
                        "title": thread.title or typed_metadata.get("title"),
                        "openai_conversation_id": result_conversation_id,
                        "openai_previous_response_id": result_response_id,
                        "chart_cache": context.chart_cache,
                        "workspace_context": typed_metadata.get("workspace_context"),
                        "execution_mode": context.execution_mode,
                        "usage": updated_usage,
                    },
                ),
            )
            thread.metadata = dict(typed_metadata)
            context.thread_metadata = typed_metadata
            conversation_id = result_conversation_id
            previous_response_id = result_response_id
            final_conversation_id = result_conversation_id
            final_response_id = result_response_id

            latest_assistant_text = await self._latest_assistant_message_text(
                thread.id,
                context,
            )
            if self._should_auto_continue_batch(
                execution_mode=context.execution_mode,
                continuation_used=continuation_used,
                assistant_text=latest_assistant_text,
            ):
                continuation_used = True
                next_agent_input = self._build_batch_continue_input()
                yield ProgressUpdateEvent(
                    text="Batch mode is continuing automatically with best-effort assumptions."
                )
                log_event(
                    self.logger,
                    logging.INFO,
                    "respond.batch_continue",
                    thread_id=thread.id,
                    user_id=context.user_id,
                    conversation_id=result_conversation_id,
                    response_id=result_response_id,
                )
                continue

            break

        log_event(
            self.logger,
            logging.INFO,
            "respond.end",
            thread_id=thread.id,
            user_id=context.user_id,
            conversation_id=final_conversation_id,
            conversation_logs=platform_logs_url(final_conversation_id),
            response_id=final_response_id,
            response_logs=platform_logs_url(final_response_id),
            input_tokens=updated_usage.get("input_tokens", 0) if updated_usage else 0,
            output_tokens=updated_usage.get("output_tokens", 0) if updated_usage else 0,
            cost_usd=updated_usage.get("cost_usd", 0.0) if updated_usage else 0.0,
            title_chars=len(thread.title or ""),
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
            "app": "ai-portfolio",
            "thread_id": thread.id,
            "user_id": context.user_id,
        }
        if context.dataset_ids:
            metadata["dataset_ids"] = ",".join(context.dataset_ids)[:512]
        if thread.title:
            metadata["thread_title"] = thread.title[:512]

        conversation = await self.openai_client.conversations.create(metadata=metadata)
        log_event(
            self.logger,
            logging.INFO,
            "respond.conversation_created",
            thread_id=thread.id,
            user_id=context.user_id,
            conversation_id=conversation.id,
            conversation_logs=platform_logs_url(conversation.id),
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

        log_event(
            self.logger,
            logging.INFO,
            "conversation.validate",
            conversation_id=conversation_id,
            conversation_logs=platform_logs_url(conversation_id),
            trailing_items=len(trailing_items),
            dangling_tool_calls=len(dangling_tool_calls),
            dangling_call_ids=summarize_sequence_for_log(
                [item.call_id for item in dangling_tool_calls]
            ),
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
        log_event(
            self.logger,
            logging.WARNING,
            "conversation.recovered_dangling_tool_calls",
            conversation_id=conversation_id,
            conversation_logs=platform_logs_url(conversation_id),
            count=len(dangling_tool_calls),
            call_ids=summarize_sequence_for_log(
                [item.call_id for item in dangling_tool_calls]
            ),
        )
        return len(dangling_tool_calls)

    async def _load_recent_items(
        self, thread_id: str | None, user_id: str
    ) -> list[ThreadItem]:
        if not thread_id:
            return []
        context = ReportAgentContext(
            report_id=thread_id,
            user_id=user_id,
            user_email=None,
            db=self.db,
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

    def _files_from_recent_items(
        self, recent_items: list[ThreadItem]
    ) -> list[WorkspaceFileMetadata]:
        files: list[WorkspaceFileMetadata] = []
        for item in reversed(recent_items):
            if item.type != "client_tool_call":
                continue
            if item.status != "completed":
                continue
            result = coerce_client_tool_result(item.output)
            next_files = self._workspace_files_from_client_tool_result(result)
            if next_files:
                files = next_files
        return files

    def _workspace_context_from_recent_items(
        self,
        recent_items: list[ThreadItem],
    ) -> WorkspaceContext | None:
        for item in recent_items:
            if item.type == "hidden_context_item" and isinstance(item.content, dict):
                raw_workspace_context = item.content.get("workspace_context")
                if isinstance(raw_workspace_context, dict):
                    result = _workspace_context_from_tool_result(
                        {"workspace_context": raw_workspace_context}
                    )
                    if result is not None:
                        return result
            if item.type != "client_tool_call" or item.status != "completed":
                continue
            result = _workspace_context_from_tool_result(
                coerce_client_tool_result(item.output)
            )
            if result is not None:
                return result
        return None

    async def _sync_workspace_context_items(
        self,
        thread: ThreadMetadata,
        recent_items: list[ThreadItem],
        *,
        context: ReportAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        seen_call_ids = {
            str(item.content.get("source_call_id"))
            for item in recent_items
            if item.type == "hidden_context_item"
            and isinstance(item.content, dict)
            and isinstance(item.content.get("source_call_id"), str)
        }

        for item in reversed(recent_items):
            if item.type != "client_tool_call" or item.status != "completed":
                continue
            if item.call_id in seen_call_ids:
                continue

            result = coerce_client_tool_result(item.output)
            workspace_context = _workspace_context_from_tool_result(result)
            if workspace_context is None:
                continue

            hidden_item = HiddenContextItem(
                id=f"ctx_{uuid4().hex}",
                thread_id=thread.id,
                created_at=datetime.now(),
                content={
                    "source_call_id": item.call_id,
                    "tool_name": item.name,
                    "workspace_context": workspace_context,
                    "workspace_operation": result.get("workspace_operation")
                    if isinstance(result, dict)
                    else None,
                },
            )
            await self.store.add_thread_item(thread.id, hidden_item, context=context)
            seen_call_ids.add(item.call_id)

            operation = (
                result.get("workspace_operation")
                if isinstance(result, dict)
                else None
            )
            if not isinstance(operation, dict):
                continue

            operation_kind = str(operation.get("kind", "")).strip()
            if operation_kind not in {"create_directory", "change_directory"}:
                continue

            target_path = operation.get("target_path")
            widget = build_workspace_context_widget(
                action_label=(
                    "Created directory"
                    if operation_kind == "create_directory"
                    else "Changed directory"
                ),
                cwd_path=workspace_context["cwd_path"],
                target_path=target_path if isinstance(target_path, str) else None,
            )
            yield ThreadItemDoneEvent(
                item=WidgetItem(
                    id=f"widget_{uuid4().hex}",
                    thread_id=thread.id,
                    created_at=datetime.now(),
                    widget=widget,
                    copy_text=build_workspace_context_copy_text(
                        action_label=(
                            "Created directory"
                            if operation_kind == "create_directory"
                            else "Changed directory"
                        ),
                        cwd_path=workspace_context["cwd_path"],
                        target_path=target_path if isinstance(target_path, str) else None,
                    ),
                )
            )

    def _workspace_files_from_client_tool_result(
        self, result: ClientToolResultPayload | None
    ) -> list[WorkspaceFileMetadata]:
        if result is None:
            return []
        raw_files = result.get("files")
        if isinstance(raw_files, list):
            files: list[WorkspaceFileMetadata] = []
            for raw_file in raw_files:
                if not isinstance(raw_file, dict):
                    continue
                workspace_file = cast(ClientToolWorkspaceFile, raw_file)
                file_id = str(workspace_file.get("id", "")).strip()
                if not file_id:
                    continue
                files.append(
                    WorkspaceFileMetadata(
                        id=file_id,
                        name=str(workspace_file.get("name", "Workspace file")),
                        kind=cast(
                            Literal["csv", "json", "pdf", "other"],
                            str(workspace_file.get("kind", "other")),
                        ),
                        path=str(workspace_file.get("path", "")),
                        extension=str(workspace_file.get("extension", "")),
                        mime_type=(
                            str(workspace_file.get("mime_type"))
                            if workspace_file.get("mime_type")
                            else None
                        ),
                        byte_size=workspace_file.get("byte_size") or 0,
                        csv=(
                            CsvWorkspaceMetadata(
                                row_count=int(workspace_file.get("row_count", 0)),
                                columns=[
                                    str(column)
                                    for column in workspace_file.get("columns", [])
                                ],
                                numeric_columns=[
                                    str(column)
                                    for column in workspace_file.get(
                                        "numeric_columns", []
                                    )
                                ],
                                sample_rows=[
                                    {str(key): value for key, value in row.items()}
                                    for row in workspace_file.get("sample_rows", [])
                                    if isinstance(row, dict)
                                ],
                            )
                            if str(workspace_file.get("kind", "other")) == "csv"
                            else None
                        ),
                        json=(
                            JsonWorkspaceMetadata(
                                row_count=int(workspace_file.get("row_count", 0)),
                                columns=[
                                    str(column)
                                    for column in workspace_file.get("columns", [])
                                ],
                                numeric_columns=[
                                    str(column)
                                    for column in workspace_file.get(
                                        "numeric_columns", []
                                    )
                                ],
                                sample_rows=[
                                    {str(key): value for key, value in row.items()}
                                    for row in workspace_file.get("sample_rows", [])
                                    if isinstance(row, dict)
                                ],
                            )
                            if str(workspace_file.get("kind", "other")) == "json"
                            else None
                        ),
                        pdf=(
                            PdfWorkspaceMetadata(
                                page_count=workspace_file.get("page_count") or 0
                            )
                            if str(workspace_file.get("kind", "other")) == "pdf"
                            else None
                        ),
                    )
                )
            if files:
                return files

        raw_csv_files = result.get("csv_files")
        if isinstance(raw_csv_files, list):
            files: list[WorkspaceFileMetadata] = []
            for raw_file in raw_csv_files:
                if not isinstance(raw_file, dict):
                    continue
                csv_file = cast(ClientToolCsvFile, raw_file)
                file_id = str(csv_file.get("id", "")).strip()
                if not file_id:
                    continue
                files.append(
                    WorkspaceFileMetadata(
                        id=file_id,
                        name=str(csv_file.get("name", "CSV file")),
                        kind="csv",
                        path=str(csv_file.get("path", "")),
                        extension="csv",
                        csv=CsvWorkspaceMetadata(
                            row_count=int(csv_file.get("row_count", 0)),
                            columns=[str(column) for column in csv_file.get("columns", [])],
                            numeric_columns=[
                                str(column)
                                for column in csv_file.get("numeric_columns", [])
                            ],
                            sample_rows=[
                                {str(key): value for key, value in row.items()}
                                for row in csv_file.get("sample_rows", [])
                                if isinstance(row, dict)
                            ],
                        ),
                    )
                )
            if files:
                return files

        raw_chartable_files = result.get("chartable_files")
        if not isinstance(raw_chartable_files, list):
            return []

        files: list[WorkspaceFileMetadata] = []
        for raw_file in raw_chartable_files:
            if not isinstance(raw_file, dict):
                continue
            workspace_file = cast(ClientToolWorkspaceFile, raw_file)
            file_id = str(workspace_file.get("id", "")).strip()
            if not file_id:
                continue
            kind = str(workspace_file.get("kind", "other"))
            files.append(
                WorkspaceFileMetadata(
                    id=file_id,
                    name=str(workspace_file.get("name", "Chartable file")),
                    kind=cast(Literal["csv", "json", "pdf", "other"], kind),
                    path=str(workspace_file.get("path", "")),
                    extension=str(workspace_file.get("extension", "")),
                    csv=(
                        CsvWorkspaceMetadata(
                            row_count=int(workspace_file.get("row_count", 0)),
                            columns=[str(column) for column in workspace_file.get("columns", [])],
                            numeric_columns=[
                                str(column)
                                for column in workspace_file.get("numeric_columns", [])
                            ],
                            sample_rows=[
                                {str(key): value for key, value in row.items()}
                                for row in workspace_file.get("sample_rows", [])
                                if isinstance(row, dict)
                            ],
                        )
                        if kind == "csv"
                        else None
                    ),
                    json=(
                        JsonWorkspaceMetadata(
                            row_count=int(workspace_file.get("row_count", 0)),
                            columns=[str(column) for column in workspace_file.get("columns", [])],
                            numeric_columns=[
                                str(column)
                                for column in workspace_file.get("numeric_columns", [])
                            ],
                            sample_rows=[
                                {str(key): value for key, value in row.items()}
                                for row in workspace_file.get("sample_rows", [])
                                if isinstance(row, dict)
                            ],
                        )
                        if kind == "json"
                        else None
                    ),
                )
            )
        return files

    def _runtime_metadata_patch(
        self,
        *,
        current_metadata: ThreadMetadataPatch,
        request_metadata: ThreadMetadataPatch,
    ) -> ThreadMetadataPatch:
        patch: ThreadMetadataPatch = {}
        request_surface_key = request_metadata.get("surface_key")
        request_bundle = request_metadata.get("capability_bundle")
        request_workspace_context = request_metadata.get("workspace_context")
        request_workspace_bootstrap = request_metadata.get("workspace_bootstrap")
        request_workspace_contract_version = request_metadata.get("workspace_contract_version")
        request_execution_mode = request_metadata.get("execution_mode")
        request_origin = request_metadata.get("origin")
        if request_surface_key and current_metadata.get("surface_key") != request_surface_key:
            patch["surface_key"] = request_surface_key
        if request_bundle is not None:
            current_bundle = current_metadata.get("capability_bundle")
            if current_bundle != request_bundle or patch.get("surface_key"):
                patch["capability_bundle"] = request_bundle
        if (
            request_workspace_context is not None
            and current_metadata.get("workspace_context") != request_workspace_context
        ):
            patch["workspace_context"] = request_workspace_context
        if (
            request_workspace_bootstrap is not None
            and current_metadata.get("workspace_bootstrap") != request_workspace_bootstrap
        ):
            patch["workspace_bootstrap"] = request_workspace_bootstrap
        if (
            request_workspace_contract_version == "v1"
            and current_metadata.get("workspace_contract_version")
            != request_workspace_contract_version
        ):
            patch["workspace_contract_version"] = request_workspace_contract_version
        if (
            request_execution_mode in {"interactive", "batch"}
            and current_metadata.get("execution_mode") != request_execution_mode
        ):
            patch["execution_mode"] = request_execution_mode
        if request_origin and current_metadata.get("origin") != request_origin:
            patch["origin"] = request_origin
        return patch

    async def latest_assistant_item_ids(
        self,
        thread_id: str,
        context: ReportAgentContext,
        *,
        limit: int = 40,
    ) -> list[str]:
        recent_items = await self.store.load_thread_items(
            thread_id,
            after=None,
            limit=limit,
            order="desc",
            context=context,
        )
        for item in recent_items.data:
            if item.type == "assistant_message":
                return [item.id]
        return []

    async def _latest_assistant_message_text(
        self,
        thread_id: str,
        context: ReportAgentContext,
        *,
        limit: int = 20,
    ) -> str | None:
        recent_items = await self.store.load_thread_items(
            thread_id,
            after=None,
            limit=limit,
            order="desc",
            context=context,
        )
        for item in recent_items.data:
            if item.type != "assistant_message":
                continue
            text = " ".join(
                content.text.strip()
                for content in item.content
                if getattr(content, "text", "").strip()
            ).strip()
            if text:
                return text
        return None

    @classmethod
    def _should_auto_continue_batch(
        cls,
        *,
        execution_mode: ExecutionMode,
        continuation_used: bool,
        assistant_text: str | None,
    ) -> bool:
        if execution_mode != "batch" or continuation_used:
            return False
        if not assistant_text:
            return False
        if any(pattern.search(assistant_text) for pattern in BATCH_MODE_HARD_BLOCK_PATTERNS):
            return False
        return any(pattern.search(assistant_text) for pattern in BATCH_MODE_CONTINUATION_PATTERNS)

    @staticmethod
    def _build_batch_continue_input() -> list[ResponseInputItemParam]:
        return [
            cast(
                ResponseInputItemParam,
                Message(
                    type="message",
                    role="user",
                    content=[
                        ResponseInputTextParam(
                            type="input_text",
                            text=BATCH_MODE_CONTINUE_TEXT,
                        )
                    ],
                ),
            )
        ]

    async def create_feedback_draft(
        self,
        *,
        thread_id: str,
        item_ids: list[str],
        context: ReportAgentContext,
        kind: str | None = None,
        label: str | None = None,
        message: str | None = None,
    ) -> ChatItemFeedbackRecord:
        normalized_email = (
            context.user_email.strip().lower()
            if isinstance(context.user_email, str) and context.user_email.strip()
            else None
        )
        origin = cast(
            FeedbackOrigin,
            context.thread_metadata.get("origin") or "interactive",
        )
        feedback = ChatItemFeedback(
            id=f"fb_{uuid4().hex}",
            thread_id=thread_id,
            item_ids_json=list(item_ids),
            user_email=normalized_email,
            kind=kind if kind in {"positive", "negative"} else None,
            label=label if label in {"ui", "tools", "behavior"} else None,
            message=message.strip() if isinstance(message, str) and message.strip() else None,
            origin=origin,
        )
        self.db.add(feedback)
        await self.db.commit()
        return ChatItemFeedbackRecord(
            id=feedback.id,
            thread_id=feedback.thread_id,
            item_ids=list(feedback.item_ids_json),
            user_email=feedback.user_email,
            kind=feedback.kind,
            label=feedback.label,
            message=feedback.message,
            origin=feedback.origin,
        )

    async def get_feedback_record(self, feedback_id: str) -> ChatItemFeedback | None:
        return await self.db.get(ChatItemFeedback, feedback_id)

    async def delete_feedback_record(self, feedback: ChatItemFeedback) -> None:
        await self.db.delete(feedback)
        await self.db.commit()

    async def update_feedback_record(
        self,
        feedback: ChatItemFeedback,
        payload: SubmitFeedbackDetailsPayload,
    ) -> ChatItemFeedback:
        feedback.kind = payload.kind
        feedback.label = payload.label
        feedback.message = payload.message.strip() if payload.message and payload.message.strip() else None
        await self.db.commit()
        return feedback

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
            log_event(
                self.logger,
                logging.INFO,
                "thread_metadata.updated",
                thread_id=thread.id,
                user_id=context.user_id,
                title_chars=len(thread.title or ""),
            )
            yield ProgressUpdateEvent(text="Saved thread metadata update.")
            return

        if action.type == "submit_feedback_details" and sender is not None:
            payload = TypeAdapter(SubmitFeedbackDetailsPayload).validate_python(
                action.payload or {}
            )
            feedback = await self.get_feedback_record(payload.feedback_id)
            if feedback is None:
                yield ProgressUpdateEvent(text="Feedback draft was not found.")
                return
            await self.update_feedback_record(feedback, payload)
            log_event(
                self.logger,
                logging.INFO,
                "feedback.submitted",
                thread_id=thread.id,
                user_id=context.user_id,
                feedback_id=feedback.id,
                item_ids=summarize_sequence_for_log(feedback.item_ids_json),
                kind=feedback.kind,
                label=feedback.label,
                origin=feedback.origin,
            )
            yield ThreadItemReplacedEvent(
                item=sender.model_copy(
                    update={
                        "widget": {
                            "type": "Card",
                            "size": "sm",
                            "status": {"text": "Feedback saved", "icon": "check-circle"},
                            "children": [
                                {"type": "Badge", "label": "Feedback", "color": "success", "variant": "soft", "pill": True, "size": "sm"},
                                {"type": "Title", "value": "Thanks for the feedback", "size": "sm"},
                                {
                                    "type": "Caption",
                                    "value": "The feedback agent saved your notes for this thread.",
                                    "color": "secondary",
                                    "size": "sm",
                                },
                            ],
                        },
                        "copy_text": "Feedback saved.",
                    }
                )
            )
            return

        if action.type == "cancel_feedback_details" and sender is not None:
            payload = TypeAdapter(CancelFeedbackDetailsPayload).validate_python(
                action.payload or {}
            )
            feedback = await self.get_feedback_record(payload.feedback_id)
            if feedback is not None:
                await self.delete_feedback_record(feedback)
                log_event(
                    self.logger,
                    logging.INFO,
                    "feedback.cancelled",
                    thread_id=thread.id,
                    user_id=context.user_id,
                    feedback_id=payload.feedback_id,
                )
            yield ThreadItemRemovedEvent(item_id=sender.id)
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
            log_event(
                self.logger,
                logging.INFO,
                "thread_metadata.sync_updated",
                thread_id=thread.id,
                user_id=context.user_id,
                title_chars=len(thread.title or ""),
            )
        return SyncCustomActionResponse(updated_item=sender)

    async def transcribe(
        self, audio_input: AudioInput, context: ReportAgentContext
    ) -> TranscriptionResult:
        model = "gpt-4o-mini-transcribe"
        log_event(
            self.logger,
            logging.INFO,
            "transcribe.start",
            report_id=context.report_id,
            user_id=context.user_id,
            mime_type=audio_input.mime_type,
            bytes=len(audio_input.data),
            model=model,
        )
        result = await self.openai_client.audio.transcriptions.create(
            file=("dictation.webm", audio_input.data, audio_input.media_type),
            model=model,
            response_format="verbose_json",
        )
        seconds = float(getattr(result, "duration", 0.0) or 0.0)
        transcription_cost_usd = calculate_transcription_cost_usd(model, seconds)
        context.thread_metadata["usage"] = accumulate_transcription_usage(
            context.thread_metadata.get("usage"),
            model=model,
            seconds=seconds,
        )
        await CreditService.record_cost_event(
            user_id=context.user_id,
            thread_id=context.report_id,
            cost_usd=transcription_cost_usd,
        )
        log_event(
            self.logger,
            logging.INFO,
            "transcribe.end",
            report_id=context.report_id,
            user_id=context.user_id,
            model=model,
            seconds=seconds,
            cost_usd=context.thread_metadata.get("usage", {}).get("cost_usd", 0.0),
            text_chars=len(result.text),
        )
        return TranscriptionResult(text=result.text)


async def build_chatkit_server(
    db: AsyncSession = Depends(get_db),
) -> ClientWorkspaceChatKitServer:
    return ClientWorkspaceChatKitServer(db)
