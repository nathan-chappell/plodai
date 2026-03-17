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
from openai.types.responses import ResponseFunctionCallOutputItemListParam
from openai.types.responses.response_function_tool_call_item import (
    ResponseFunctionToolCallItem,
)
from openai.types.responses.response_input_item_param import (
    FunctionCallOutput,
    ResponseInputItemParam,
)
from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.agents.agent_builder import build_registered_agent
from backend.app.agents.context import ReportAgentContext
from backend.app.agents.query_models import build_query_plan_model
from backend.app.agents.workspace_file import (
    CsvWorkspaceMetadata,
    PdfWorkspaceMetadata,
    WorkspaceFileMetadata,
)
from backend.app.chatkit.client_tools import (
    ClientToolCsvFile,
    ClientToolResultPayload,
    ClientToolWorkspaceFile,
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
    calculate_transcription_cost_usd,
    calculate_usage_cost_usd,
    platform_logs_url,
)
from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger, summarize_for_log
from backend.app.db.session import get_db
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
        file_input = result.get("file_input")
        query_id = result.get("query_id") or result.get("queryId")
        row_count = result.get("row_count")
        csv_files = result.get("csv_files")
        sanitized_result = dict(result)
        sanitized_result.pop("imageDataUrl", None)
        sanitized_result.pop("image_data_url", None)
        if isinstance(file_input, dict):
            sanitized_file_input = dict(file_input)
            if "file_data" in sanitized_file_input:
                sanitized_file_input["file_data"] = "[omitted_base64_file_data]"
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

        if isinstance(file_input, dict):
            filename = file_input.get("filename")
            file_data = file_input.get("file_data")
            if (
                isinstance(filename, str)
                and filename
                and isinstance(file_data, str)
                and file_data
            ):
                rich_output.append(
                    {
                        "type": "input_file",
                        "filename": filename,
                        "file_data": file_data,
                    }
                )

        if rich_output:
            function_call_output["output"] = rich_output

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
        self, raw_request: bytes | str, user_id: str
    ) -> ReportAgentContext:
        parsed_request = TypeAdapter(ChatKitReq).validate_json(raw_request)
        metadata = normalize_thread_metadata(parsed_request.metadata)
        thread_id = getattr(parsed_request.params, "thread_id", None)
        recent_items = await self._load_recent_items(thread_id, user_id)
        files = self._files_from_recent_items(recent_items)
        context = ReportAgentContext(
            report_id=thread_id or "pending_thread",
            user_id=user_id,
            db=self.db,
            chart_cache=dict(metadata.get("chart_cache") or {}),
            thread_metadata=metadata,
            available_files=files,
            capability_manifest=metadata.get("capability_manifest"),
        )
        query_plan_model, _ = build_query_plan_model(context.available_datasets)
        context.query_plan_model = query_plan_model

        self.logger.info(
            f"request_context.build op={parsed_request.type} thread_id={thread_id} user_id={user_id} file_count={len(files)} dataset_count={len(context.available_datasets)}"
        )

        return context

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
        context.available_files = self._files_from_recent_items(recent_item_data)
        context.query_plan_model, _ = build_query_plan_model(context.available_datasets)
        context.capability_manifest = typed_metadata.get("capability_manifest")

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
            f"respond.start thread_id={thread.id} user_id={context.user_id} model={requested_model} "
            f"pending_items={len(pending_items)} agent_input_items={len(agent_input)} "
            f"datasets={summarize_for_log(context.dataset_ids)} conversation_id={conversation_id} "
            f"conversation_logs={platform_logs_url(conversation_id)} previous_response_id={previous_response_id} "
            f"response_logs={platform_logs_url(previous_response_id)}"
        )

        agent = build_registered_agent(context, model=requested_model)
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
                    f"respond.retry thread_id={thread.id} user_id={context.user_id} conversation_id={conversation_id} "
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
                        f"respond.error thread_id={thread.id} user_id={context.user_id} conversation_id={conversation_id} previous_response_id={previous_response_id}"
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
            typed_metadata.get("usage"),
            result.context_wrapper.usage,
            model=requested_model,
        )
        await CreditService.record_cost_event(
            user_id=context.user_id,
            thread_id=thread.id,
            response_id=result_response_id,
            cost_usd=response_cost_usd,
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
            f"respond.end thread_id={thread.id} user_id={context.user_id} "
            f"conversation_id={result_conversation_id} conversation_logs={platform_logs_url(result_conversation_id)} "
            f"response_id={result_response_id} response_logs={platform_logs_url(result_response_id)} "
            f"input_tokens={updated_usage.get('input_tokens', 0)} output_tokens={updated_usage.get('output_tokens', 0)} "
            f"cost_usd={updated_usage.get('cost_usd', 0.0)} title={summarize_for_log(thread.title or '')}"
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
        self.logger.info(
            f"respond.conversation_created thread_id={thread.id} user_id={context.user_id} conversation_id={conversation.id} conversation_logs={platform_logs_url(conversation.id)}"
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
        self, thread_id: str | None, user_id: str
    ) -> list[ThreadItem]:
        if not thread_id:
            return []
        context = ReportAgentContext(report_id=thread_id, user_id=user_id, db=self.db)
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
        for item in recent_items:
            if item.type != "client_tool_call":
                continue
            if item.status != "completed":
                continue
            result = coerce_client_tool_result(item.output)
            if item.name == "list_workspace_files":
                files = self._workspace_files_from_client_tool_result(result)
                if files:
                    return files
            if item.name == "list_attached_csv_files":
                files = self._workspace_files_from_client_tool_result(result)
                if files:
                    return files
        return []

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
                            Literal["csv", "pdf", "other"],
                            str(workspace_file.get("kind", "other")),
                        ),
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
        if not isinstance(raw_csv_files, list):
            return []

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
        return files

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
                f"thread_metadata.updated thread_id={thread.id} user_id={context.user_id} title={summarize_for_log(thread.title or '')}"
            )
            yield ProgressUpdateEvent(text="Saved thread metadata update.")
            return

        if action.type == "register_capability_manifest" and isinstance(
            action.payload, dict
        ):
            capability_manifest = normalize_thread_metadata(
                {"capability_manifest": action.payload.get("capability_manifest")}
            ).get("capability_manifest")
            if capability_manifest is None:
                yield ProgressUpdateEvent(
                    text="Capability manifest registration was rejected because it was incomplete or invalid."
                )
                return
            current_metadata = normalize_thread_metadata(thread.metadata)
            patch: ThreadMetadataPatch = {
                "capability_manifest": capability_manifest,
            }
            thread.metadata = dict(merge_thread_metadata(current_metadata, patch))
            await self.store.save_thread(thread, context=context)
            self.logger.info(
                f"capability_manifest.registered thread_id={thread.id} user_id={context.user_id} "
                f"capability_id={summarize_for_log(capability_manifest.get('capability_id'))} "
                f"tool_count={len(capability_manifest.get('client_tools') or [])}"
            )
            yield ProgressUpdateEvent(
                text=(
                    f"Registered capability manifest for "
                    f"{capability_manifest.get('agent_name')}."
                )
            )
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
                f"thread_metadata.sync_updated thread_id={thread.id} user_id={context.user_id} title={summarize_for_log(thread.title or '')}"
            )
        elif action.type == "register_capability_manifest" and isinstance(
            action.payload, dict
        ):
            capability_manifest = normalize_thread_metadata(
                {"capability_manifest": action.payload.get("capability_manifest")}
            ).get("capability_manifest")
            if capability_manifest is None:
                return SyncCustomActionResponse(updated_item=sender)
            current_metadata = normalize_thread_metadata(thread.metadata)
            patch: ThreadMetadataPatch = {
                "capability_manifest": capability_manifest,
            }
            thread.metadata = dict(merge_thread_metadata(current_metadata, patch))
            await self.store.save_thread(thread, context=context)
            self.logger.info(
                f"capability_manifest.sync_registered thread_id={thread.id} user_id={context.user_id} "
                f"capability_id={summarize_for_log(capability_manifest.get('capability_id'))} "
                f"tool_count={len(capability_manifest.get('client_tools') or [])}"
            )
        return SyncCustomActionResponse(updated_item=sender)

    async def transcribe(
        self, audio_input: AudioInput, context: ReportAgentContext
    ) -> TranscriptionResult:
        model = "gpt-4o-mini-transcribe"
        self.logger.info(
            f"transcribe.start report_id={context.report_id} user_id={context.user_id} mime_type={audio_input.mime_type} bytes={len(audio_input.data)} model={model}"
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
        self.logger.info(
            f"transcribe.end report_id={context.report_id} user_id={context.user_id} model={model} seconds={seconds} "
            f"cost_usd={context.thread_metadata.get('usage', {}).get('cost_usd', 0.0)} text_chars={len(result.text)}"
        )
        return TranscriptionResult(text=result.text)


async def build_chatkit_server(
    db: AsyncSession = Depends(get_db),
) -> ReportFoundryChatKitServer:
    return ReportFoundryChatKitServer(db)
