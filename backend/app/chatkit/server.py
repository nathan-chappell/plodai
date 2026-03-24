from __future__ import annotations

import asyncio
from base64 import b64decode
from binascii import Error as BinasciiError
from datetime import UTC, datetime
import json
import logging
import random
import re
from hashlib import sha256
from typing import Any, AsyncIterator, cast

from agents import Runner
from agents.model_settings import ModelSettings
from chatkit.actions import Action
from chatkit.agents import (
    AgentContext as ChatKitAgentContext,
    ThreadItemConverter,
    stream_agent_response,
)
from chatkit.server import ChatKitServer
from chatkit.types import (
    Attachment,
    AudioInput,
    ChatKitReq,
    ClientToolCallItem,
    ProgressUpdateEvent,
    SyncCustomActionResponse,
    ThreadItemDoneEvent,
    ThreadItem,
    ThreadItemRemovedEvent,
    ThreadMetadata,
    ThreadStreamEvent,
    TranscriptionResult,
    UserMessageItem,
    UserMessageTagContent,
    UserMessageTextContent,
    WidgetItem,
)
from fastapi import Depends, Request
from openai import AsyncOpenAI
from openai.types.conversations.conversation_item import ConversationItem
from openai.types.responses import (
    ResponseFunctionCallOutputItemListParam,
    ResponseFunctionToolCallParam,
    ResponseInputContentParam,
    ResponseInputMessageContentListParam,
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
from openai.types.shared import Reasoning
from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession
from typing_extensions import assert_never

from backend.app.agents.agent_builder import build_registered_agent
from backend.app.agents.context import ReportAgentContext
from backend.app.agents.query_models import build_query_plan_model
from backend.app.chatkit.client_tools import (
    ClientToolResultPayload,
    coerce_client_tool_result,
)
from backend.app.chatkit.feedback_types import (
    CancelFeedbackSessionPayload,
    SubmitFeedbackSessionPayload,
)
from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.chatkit.metadata import (
    PlodaiThreadImageRef,
    PendingFeedbackSession,
    ChatMetadataPatch,
    build_plodai_image_ref_patch,
    merge_chat_metadata,
    parse_chat_metadata,
    resolve_plodai_thread_image_ref,
)
from backend.app.chatkit.runtime_state import (
    resolve_thread_runtime_state,
    workspace_files_from_workspace_state,
)
from backend.app.chatkit.usage import (
    accumulate_transcription_usage,
    accumulate_usage,
    calculate_transcription_cost_usd,
    calculate_usage_cost_usd,
    platform_logs_url,
)
from backend.app.core.config import get_settings
from backend.app.core.config import resolve_public_base_url
from backend.app.core.logging import (
    get_logger,
    log_event,
    summarize_mapping_keys_for_log,
    summarize_pairs_for_log,
    summarize_sequence_for_log,
)
from backend.app.db.session import get_db
from backend.app.models.stored_file import StoredOpenAIFile
from backend.app.services.credit_service import CreditService

logger = get_logger("chatkit.server")

MODEL_ALIASES = {
    "default": "gpt-5.4-mini",
    "lightweight": "gpt-5.4-nano",
    "balanced": "gpt-5.4-mini",
    "powerful": "gpt-5.4",
}
DEFAULT_MODEL = MODEL_ALIASES["default"]
MAX_AGENT_TURNS = 30
RATE_LIMIT_RETRY_PATTERN = re.compile(
    r"try again in\s+(?P<seconds>\d+(?:\.\d+)?)s",
    re.IGNORECASE,
)


def _current_thread_metadata(thread: ThreadMetadata) -> dict[str, Any]:
    return parse_chat_metadata(thread.metadata)


def _is_gpt_5_4_family_model(model: str | None) -> bool:
    return isinstance(model, str) and model.startswith("gpt-5.4")


def _model_settings_override_for_model(model: str | None) -> ModelSettings | None:
    if not _is_gpt_5_4_family_model(model):
        return None
    return ModelSettings(
        reasoning=Reasoning(
            effort="low",
            summary="auto",
        )
    )


def _context_line(
    *,
    user_id: str | None = None,
    thread_id: str | None = None,
    report_id: str | None = None,
) -> str | None:
    return summarize_pairs_for_log(
        (
            ("user", user_id),
            ("thread", thread_id),
            ("report", report_id),
        )
    )


def _logs_link(*identifiers: str | None) -> str | None:
    for identifier in identifiers:
        if identifier:
            return platform_logs_url(identifier)
    return None


def _format_cost_usd(value: float | None) -> str | None:
    if value is None:
        return None
    text = f"{value:.8f}".rstrip("0").rstrip(".")
    return text or "0"


def _usage_line(usage: object, *, model: str | None = None) -> str | None:
    fields: list[tuple[str, object]] = []
    if model:
        fields.append(("model", model))
    if isinstance(usage, dict):
        fields.extend(
            (
                ("input", usage.get("input_tokens", 0)),
                ("output", usage.get("output_tokens", 0)),
                ("cost_usd", _format_cost_usd(float(usage.get("cost_usd", 0.0)))),
            )
        )
    return summarize_pairs_for_log(fields)


def _normalize_feedback_message(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _result_line(result: ClientToolResultPayload | None) -> str | None:
    summary = _summarize_client_tool_result_for_log(result)
    if set(summary.keys()) == {"result"}:
        raw_result = summary.get("result")
        return str(raw_result) if raw_result is not None else None
    return summarize_pairs_for_log(
        [
            ("keys" if key == "result_keys" else key, value)
            for key, value in summary.items()
        ]
    )


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
    workspace_context = result.get("workspace_context")
    if isinstance(workspace_context, dict):
        workspace_id = workspace_context.get("workspace_id")
        if isinstance(workspace_id, str) and workspace_id:
            summary["workspace_id"] = workspace_id
    file_input = result.get("file_input")
    if isinstance(file_input, dict):
        summary["has_file_input"] = True
        summary["file_input_keys"] = summarize_mapping_keys_for_log(file_input)
    for key in ("files", "datasets", "pdf_files", "reports"):
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


class ClientToolResultConverter(ThreadItemConverter):
    def __init__(
        self,
        openai_client: AsyncOpenAI,
        upload_cache: dict[str, str],
        db: AsyncSession,
    ):
        self.openai_client = openai_client
        self.upload_cache = upload_cache
        self.db = db
        self.current_thread: ThreadMetadata | None = None
        self.current_context: ReportAgentContext | None = None
        self.current_metadata: dict[str, Any] = {}

    def bind_request(
        self,
        *,
        thread: ThreadMetadata,
        context: ReportAgentContext,
    ) -> None:
        self.current_thread = thread
        self.current_context = context
        self.current_metadata = parse_chat_metadata(thread.metadata)

    async def attachment_to_message_content(self, attachment: Attachment):
        metadata = attachment.metadata if isinstance(attachment.metadata, dict) else {}
        attach_mode = metadata.get("attach_mode")
        stored_file_id = metadata.get("stored_file_id")
        openai_file_id = metadata.get("openai_file_id")
        input_kind = metadata.get("input_kind")
        if attach_mode == "document_tool_only":
            file_label = attachment.name.strip() if attachment.name.strip() else "document"
            file_id_suffix = (
                f" Internal file id: {stored_file_id}."
                if isinstance(stored_file_id, str) and stored_file_id.strip()
                else ""
            )
            return {
                "type": "input_text",
                "text": (
                    f"Document file '{file_label}' is available through the document tools."
                    f"{file_id_suffix}"
                ),
            }
        if not isinstance(openai_file_id, str) or not openai_file_id.strip():
            return {
                "type": "input_text",
                "text": f"Attachment '{attachment.name}' is available but could not be attached as a model file.",
            }
        if input_kind == "image":
            return {
                "type": "input_image",
                "file_id": openai_file_id.strip(),
                "detail": "high",
            }
        return {
            "type": "input_file",
            "file_id": openai_file_id.strip(),
        }

    async def user_message_to_input(
        self, item: UserMessageItem, is_last_message: bool = True
    ) -> ResponseInputItemParam | list[ResponseInputItemParam] | None:
        message_text_parts: list[str] = []
        raw_tags: list[UserMessageTagContent] = []
        current_attachment_file_ids: set[str] = set()
        attachment_content: list[ResponseInputContentParam] = []

        for attachment in item.attachments:
            attachment_content.append(await self.attachment_to_message_content(attachment))
            metadata = attachment.metadata if isinstance(attachment.metadata, dict) else {}
            stored_file_id = metadata.get("stored_file_id")
            if isinstance(stored_file_id, str) and stored_file_id.strip():
                current_attachment_file_ids.add(stored_file_id.strip())

        for part in item.content:
            if isinstance(part, UserMessageTextContent):
                message_text_parts.append(part.text)
            elif isinstance(part, UserMessageTagContent):
                message_text_parts.append(f"@{part.text}")
                raw_tags.append(part)
            else:
                assert_never(part)

        user_text_item = Message(
            role="user",
            type="message",
            content=[
                ResponseInputTextParam(
                    type="input_text", text="".join(message_text_parts)
                ),
                *attachment_content,
            ],
        )

        context_items: list[ResponseInputItemParam] = []
        if item.quoted_text and is_last_message:
            context_items.append(
                Message(
                    role="user",
                    type="message",
                    content=[
                        ResponseInputTextParam(
                            type="input_text",
                            text=f"The user is referring to this in particular: \n{item.quoted_text}",
                        )
                    ],
                )
            )

        if raw_tags:
            seen: set[str] = set()
            uniq_tags: list[UserMessageTagContent] = []
            for tag in raw_tags:
                tag_key = tag.id.strip() if tag.id.strip() else tag.text.strip()
                if tag_key in seen:
                    continue
                seen.add(tag_key)
                uniq_tags.append(tag)

            tag_content: ResponseInputMessageContentListParam = []
            for tag in uniq_tags:
                tag_content.extend(
                    await self._tag_to_message_contents(
                        tag,
                        current_attachment_file_ids=current_attachment_file_ids,
                    )
                )

            if tag_content:
                context_items.append(
                    Message(
                        role="user",
                        type="message",
                        content=[
                            ResponseInputTextParam(
                                type="input_text",
                                text=(
                                    "# User-provided context for @-mentions\n"
                                    "- When referencing resolved entities, use their canonical names without '@'.\n"
                                    "- The '@' form appears only in user text and should not be echoed."
                                ),
                            ),
                            *tag_content,
                        ],
                    )
                )

        return [user_text_item, *context_items]

    async def tag_to_message_content(
        self,
        tag: UserMessageTagContent,
    ) -> ResponseInputContentParam:
        tag_content = await self._tag_to_message_contents(
            tag,
            current_attachment_file_ids=set(),
        )
        if tag_content:
            return tag_content[0]
        return {
            "type": "input_text",
            "text": f"Tagged context: {tag.text}",
        }

    async def _tag_to_message_contents(
        self,
        tag: UserMessageTagContent,
        *,
        current_attachment_file_ids: set[str],
    ) -> list[ResponseInputContentParam]:
        if not self._is_plodai_thread():
            return [
                {
                    "type": "input_text",
                    "text": f"Tagged context: {tag.text}",
                }
            ]

        tag_data = tag.data if isinstance(tag.data, dict) else {}
        entity_type = tag_data.get("entity_type")
        if entity_type == "thread_image":
            return await self._thread_image_tag_to_message_contents(
                tag,
                tag_data=tag_data,
                current_attachment_file_ids=current_attachment_file_ids,
            )
        if entity_type in {
            "farm_crop",
            "farm_order",
        }:
            return self._farm_tag_to_message_contents(
                tag,
                tag_data=tag_data,
            )
        return [
            {
                "type": "input_text",
                "text": f"Tagged context: {tag.text}",
            }
        ]

    def _is_plodai_thread(self) -> bool:
        workspace_state = self.current_metadata.get("workspace_state")
        return (
            isinstance(workspace_state, dict)
            and workspace_state.get("app_id") == "plodai"
            and self.current_context is not None
            and self.current_thread is not None
        )

    async def _thread_image_tag_to_message_contents(
        self,
        tag: UserMessageTagContent,
        *,
        tag_data: dict[str, Any],
        current_attachment_file_ids: set[str],
    ) -> list[ResponseInputContentParam]:
        stored_file_id = tag_data.get("stored_file_id") or tag_data.get("file_id")
        attachment_id = tag_data.get("attachment_id")
        if not isinstance(stored_file_id, str) or not stored_file_id.strip():
            return [self._missing_thread_image_text(tag.text)]
        stored_file_id = stored_file_id.strip()
        if stored_file_id in current_attachment_file_ids:
            return [
                {
                    "type": "input_text",
                    "text": (
                        f"The user explicitly referenced the currently attached image '{tag.text.strip() or stored_file_id}'."
                    ),
                }
            ]

        ref = resolve_plodai_thread_image_ref(
            self.current_metadata,
            stored_file_id=stored_file_id,
            attachment_id=attachment_id.strip()
            if isinstance(attachment_id, str) and attachment_id.strip()
            else None,
        )
        if ref is None:
            return [self._missing_thread_image_text(tag.text)]

        record = await self._load_thread_image_record(ref)
        if record is None:
            return [
                {
                    "type": "input_text",
                    "text": (
                        f"Tagged thread image '{ref['name']}' is unavailable because it expired or was removed. "
                        "Ask the user to reattach it if visual inspection is still needed."
                    ),
                }
            ]

        return [
            {
                "type": "input_text",
                "text": (
                    f"Tagged thread image '{ref['name']}' was explicitly referenced from earlier in this thread. "
                    "Inspect it as part of the current request."
                ),
            },
            {
                "type": "input_image",
                "file_id": record.openai_file_id,
                "detail": "high",
            },
        ]

    async def _load_thread_image_record(
        self,
        ref: PlodaiThreadImageRef,
    ) -> StoredOpenAIFile | None:
        context = self.current_context
        thread = self.current_thread
        if context is None or thread is None:
            return None

        record = await self.db.get(StoredOpenAIFile, ref["stored_file_id"])
        if record is None:
            return None
        if record.user_id != context.user_id:
            return None
        if record.workspace_id != context.workspace_id or record.thread_id != thread.id:
            return None
        if record.status == "deleted" or record.kind != "image":
            return None
        if record.attachment_id != ref["attachment_id"]:
            return None
        expires_at = record.expires_at
        if expires_at is not None:
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if expires_at <= datetime.now(UTC):
                return None
        if not isinstance(record.openai_file_id, str) or not record.openai_file_id.strip():
            return None
        return record

    def _farm_tag_to_message_contents(
        self,
        tag: UserMessageTagContent,
        *,
        tag_data: dict[str, Any],
    ) -> list[ResponseInputContentParam]:
        artifact_id = tag_data.get("artifact_id")
        workspace_state = self.current_metadata.get("workspace_state")
        workspace_items = (
            workspace_state.get("items", [])
            if isinstance(workspace_state, dict)
            else []
        )
        has_farm_artifact = isinstance(artifact_id, str) and any(
            item.get("id") == artifact_id and item.get("kind") == "farm.v1"
            for item in workspace_items
            if isinstance(item, dict)
        )
        if not has_farm_artifact:
            return [
                {
                    "type": "input_text",
                    "text": f"Tagged farm context '{tag.text}' is unavailable.",
                }
            ]

        entity_type = tag_data.get("entity_type")
        farm_name = tag_data.get("farm_name")
        farm_label = (
            farm_name.strip()
            if isinstance(farm_name, str) and farm_name.strip()
            else "the farm"
        )
        parts: list[str] = [f"Tagged farm context from {farm_label}: {tag.text.strip()}."]
        if entity_type == "farm_crop":
            area = tag_data.get("area")
            expected_yield = tag_data.get("expected_yield")
            notes = tag_data.get("notes")
            if isinstance(area, str) and area.strip():
                parts.append(f"Area: {area.strip()}.")
            if isinstance(expected_yield, str) and expected_yield.strip():
                parts.append(f"Expected yield: {expected_yield.strip()}.")
            if isinstance(notes, str) and notes.strip():
                parts.append(f"Notes: {notes.strip()}.")
        elif entity_type == "farm_order":
            status = tag_data.get("status")
            price_label = tag_data.get("price_label")
            summary = tag_data.get("summary")
            order_url = tag_data.get("order_url")
            notes = tag_data.get("notes")
            if isinstance(status, str) and status.strip():
                parts.append(f"Status: {status.strip()}.")
            if isinstance(price_label, str) and price_label.strip():
                parts.append(f"Price: {price_label.strip()}.")
            if isinstance(summary, str) and summary.strip():
                parts.append(f"Summary: {summary.strip()}.")
            if isinstance(notes, str) and notes.strip():
                parts.append(f"Notes: {notes.strip()}.")
            if isinstance(order_url, str) and order_url.strip():
                parts.append(f"Order link: {order_url.strip()}.")

        return [
            {
                "type": "input_text",
                "text": " ".join(parts),
            }
        ]

    def _missing_thread_image_text(self, label: str) -> ResponseInputContentParam:
        resolved_label = label.strip() or "thread image"
        return {
            "type": "input_text",
            "text": (
                f"Tagged thread image '{resolved_label}' could not be resolved from saved thread attachments. "
                "Ask the user to reattach it if visual inspection is needed."
            ),
        }

    async def client_tool_call_to_input(self, item: ClientToolCallItem):
        if item.status == "pending" or item.output is None:
            return None
        result = coerce_client_tool_result(item.output)
        result_summary = _result_line(result)
        log_event(
            logger,
            logging.INFO,
            "tool.output.received",
            rendered=[
                f"{item.name or 'unknown_tool'} [{summarize_pairs_for_log((('id', item.call_id), ('status', item.status))) or 'call=unknown'}]",
                *([f"result={result_summary}"] if result_summary else []),
            ],
        )
        return await self.client_tool_result_to_input(
            result,
            call_id=item.call_id,
            tool_name=item.name,
            tool_arguments=item.arguments,
        )

    async def client_tool_result_to_input(
        self,
        result: ClientToolResultPayload | None,
        *,
        call_id: str,
        tool_name: str | None = None,
        tool_arguments: object | None = None,
    ):
        if result is None:
            return None

        image_url = result.get("imageDataUrl") or result.get("image_data_url")
        file_input = result.get("file_input")
        query_id = result.get("query_id") or result.get("queryId")
        row_count = result.get("row_count")
        datasets = result.get("datasets")
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
        function_call: ResponseFunctionToolCallParam = {
            "type": "function_call",
            "call_id": call_id,
            "name": tool_name or "unknown_tool",
            "arguments": json.dumps(
                tool_arguments if isinstance(tool_arguments, dict) else {},
                ensure_ascii=True,
            ),
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
            if isinstance(datasets, list):
                description += f" Datasets available: {len(datasets)}."
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

        return cast(list[ResponseInputItemParam], [function_call, function_call_output])

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
                mime_type
                if isinstance(mime_type, str) and mime_type
                else "application/octet-stream",
            ),
            purpose="user_data",
            expires_after={
                "anchor": "created_at",
                "seconds": get_settings().stored_file_default_expiry_seconds,
            },
        )
        self.upload_cache[cache_key] = uploaded_file.id
        return uploaded_file.id


class ClientWorkspaceChatKitServer(ChatKitServer[ReportAgentContext]):
    def __init__(self, db: AsyncSession, *, public_base_url: str | None = None):
        self.settings = get_settings()
        self.db = db
        self.openai_client = AsyncOpenAI(
            api_key=self.settings.OPENAI_API_KEY or None,
            max_retries=self.settings.openai_max_retries,
        )
        self._uploaded_file_ids: dict[str, str] = {}
        store = DatabaseMemoryStore(
            db,
            public_base_url=public_base_url,
            openai_client=self.openai_client,
        )
        super().__init__(store=store, attachment_store=store)
        self.converter = ClientToolResultConverter(
            self.openai_client,
            self._uploaded_file_ids,
            db,
        )
        self.logger = logger

    async def build_request_context(
        self, raw_request: bytes | str, user_id: str, user_email: str | None
    ) -> ReportAgentContext:
        parsed_request = TypeAdapter(ChatKitReq).validate_json(raw_request)
        metadata = parse_chat_metadata(parsed_request.metadata)
        thread_id = getattr(parsed_request.params, "thread_id", None)
        context = ReportAgentContext(
            report_id=thread_id or "pending_thread",
            user_id=user_id,
            user_email=user_email,
            db=self.db,
            workspace_id=(
                metadata.get("workspace_state", {}).get("workspace_id")
                if metadata.get("workspace_state") is not None
                else None
            ),
            workspace_name=(
                metadata.get("workspace_state", {}).get("workspace_name")
                if metadata.get("workspace_state") is not None
                else None
            ),
            chart_cache=dict(metadata.get("chart_cache") or {}),
            request_metadata=metadata,
            thread_metadata=metadata,
            available_files=workspace_files_from_workspace_state(
                metadata.get("workspace_state")
            ),
            available_artifacts=list(
                [
                    item
                    for item in metadata.get("workspace_state", {}).get("items", [])
                    if item.get("origin") == "created"
                ]
                if metadata.get("workspace_state") is not None
                else []
            ),
            agent_bundle=metadata.get("agent_bundle"),
        )
        context.query_plan_model, _ = build_query_plan_model(context.available_datasets)

        log_event(
            self.logger,
            logging.INFO,
            "request_context.build",
            context=_context_line(user_id=user_id, thread_id=thread_id),
            request=summarize_pairs_for_log(
                (
                    ("op", parsed_request.type),
                    ("files", len(context.available_files)),
                    ("datasets", len(context.available_datasets)),
                )
            ),
        )

        return context

    async def _process_new_thread_item_respond(
        self,
        thread: ThreadMetadata,
        item: UserMessageItem,
        context: ReportAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        for attachment in item.attachments:
            await self.store.bind_attachment_to_thread(
                attachment_id=attachment.id,
                thread_id=thread.id,
            )

        display_attachments = await self._load_display_attachments_for_item(
            item.attachments,
            context=context,
        )
        item = item.model_copy(update={"attachments": display_attachments})

        await self._sync_plodai_thread_image_refs(
            thread=thread,
            context=context,
            attachments=item.attachments,
        )

        await self.store.add_thread_item(thread.id, item, context=context)
        yield ThreadItemDoneEvent(item=item)

        async for event in self._process_events(
            thread,
            context,
            lambda: self.respond(thread, item, context),
        ):
            yield event

    async def _load_display_attachments_for_item(
        self,
        attachments: list[Attachment],
        *,
        context: ReportAgentContext,
    ) -> list[Attachment]:
        display_attachments: list[Attachment] = []
        for attachment in attachments:
            display_attachments.append(
                await self.store.load_attachment(
                    attachment.id,
                    context=context,
                    hydrate_preview=True,
                )
            )
        return display_attachments

    async def _sync_plodai_thread_image_refs(
        self,
        *,
        thread: ThreadMetadata,
        context: ReportAgentContext,
        attachments: list[Attachment],
    ) -> None:
        workspace_state = parse_chat_metadata(thread.metadata).get("workspace_state")
        if not isinstance(workspace_state, dict) or workspace_state.get("app_id") != "plodai":
            return

        refs = await self._build_plodai_thread_image_refs_from_attachments(attachments)
        patch = build_plodai_image_ref_patch(
            parse_chat_metadata(thread.metadata),
            refs,
        )
        if patch is None:
            return

        self._apply_metadata_patch(thread, context, patch)
        await self.store.save_thread(thread, context=context)

    async def _build_plodai_thread_image_refs_from_attachments(
        self,
        attachments: list[Attachment],
    ) -> list[PlodaiThreadImageRef]:
        refs: list[PlodaiThreadImageRef] = []
        for attachment in attachments:
            metadata = attachment.metadata if isinstance(attachment.metadata, dict) else {}
            stored_file_id = metadata.get("stored_file_id")
            if (
                metadata.get("input_kind") != "image"
                or not isinstance(stored_file_id, str)
                or not stored_file_id.strip()
            ):
                continue

            record = await self.db.get(StoredOpenAIFile, stored_file_id.strip())
            width: int | None = None
            height: int | None = None
            if record is not None and record.preview_json.get("kind") == "image":
                raw_width = record.preview_json.get("width")
                raw_height = record.preview_json.get("height")
                width = raw_width if isinstance(raw_width, int) and raw_width >= 0 else None
                height = raw_height if isinstance(raw_height, int) and raw_height >= 0 else None

            refs.append(
                {
                    "stored_file_id": stored_file_id.strip(),
                    "attachment_id": attachment.id,
                    "name": attachment.name.strip() or "image",
                    "mime_type": (
                        attachment.mime_type.strip()
                        if isinstance(attachment.mime_type, str)
                        and attachment.mime_type.strip()
                        else "application/octet-stream"
                    ),
                    "width": width,
                    "height": height,
                }
            )
        return refs

    def _apply_metadata_patch(
        self,
        thread: ThreadMetadata,
        context: ReportAgentContext,
        patch: ChatMetadataPatch,
    ) -> dict[str, Any]:
        current_metadata = _current_thread_metadata(thread)
        merged_metadata = merge_chat_metadata(current_metadata, patch)
        thread.metadata = dict(merged_metadata)
        context.thread_metadata = merged_metadata
        context.thread_title = thread.title
        return merged_metadata

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: ReportAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        runtime_state = resolve_thread_runtime_state(thread=thread, context=context)
        typed_metadata = runtime_state.metadata
        if context.agent_bundle is None:
            raise RuntimeError(
                "No registered agent bundle is available for this thread or request surface."
            )

        recent_items = await self.store.load_thread_items(
            thread.id,
            after=None,
            limit=20,
            order="desc",
            context=context,
        )
        recent_item_data = recent_items.data
        context.assistant_turn_count = sum(
            1 for item in recent_item_data if item.type == "assistant_message"
        )
        pending_items = self._collect_pending_items(
            recent_item_data,
            has_openai_conversation=bool(typed_metadata.get("openai_conversation_id")),
        )
        if input_user_message is not None and not any(
            item.id == input_user_message.id for item in pending_items
        ):
            pending_items.append(input_user_message)
        self.converter.bind_request(thread=thread, context=context)
        agent_input: str | list[ResponseInputItemParam] = cast(
            list[ResponseInputItemParam],
            await self.converter.to_agent_input(pending_items),
        )
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
            logs=_logs_link(conversation_id),
            context=_context_line(user_id=context.user_id, thread_id=thread.id),
            run=summarize_pairs_for_log(
                (
                    ("model", requested_model),
                    ("pending_items", len(pending_items)),
                    ("agent_input_items", len(agent_input)),
                    ("datasets", len(context.dataset_ids)),
                )
            ),
            dataset_ids=summarize_sequence_for_log(context.dataset_ids),
        )

        agent = build_registered_agent(
            context,
            model=requested_model,
            model_settings_override=_model_settings_override_for_model(
                requested_model
            ),
        )
        agent_context = ChatKitAgentContext[ReportAgentContext](
            thread=thread, store=self.store, request_context=context
        )
        max_retries = max(0, self.settings.openai_max_retries)
        updated_usage = typed_metadata.get("usage")
        next_agent_input: str | list[ResponseInputItemParam] = agent_input
        result = None
        agent_context.client_tool_call = None
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
                should_retry = (
                    attempt < max_retries
                    and self._should_retry_exception(exc)
                )
                recovered_tool_calls = 0

                if conversation_id and run_started:
                    recovered_tool_calls = await self._close_dangling_tool_calls(
                        conversation_id,
                        exc,
                    )

                if not should_retry:
                    if recovered_tool_calls:
                        yield ProgressUpdateEvent(
                            text=f"Recovered {recovered_tool_calls} unfinished tool call(s) before stopping."
                        )
                    log_event(
                        self.logger,
                        logging.ERROR,
                        "respond.error",
                        exc_info=exc,
                        context=_context_line(
                            user_id=context.user_id, thread_id=thread.id
                        ),
                        logs=_logs_link(previous_response_id, conversation_id),
                    )
                    raise

                retry_delay_seconds = self._compute_retry_delay_seconds(exc)

                log_event(
                    self.logger,
                    logging.WARNING,
                    "respond.retry",
                    logs=_logs_link(conversation_id),
                    context=_context_line(
                        user_id=context.user_id, thread_id=thread.id
                    ),
                    retry=summarize_pairs_for_log(
                        (
                            ("attempt", f"{attempt_number}/{total_attempts}"),
                            ("delay_seconds", f"{retry_delay_seconds:.3f}"),
                        )
                    ),
                    error=str(exc),
                )
                yield ProgressUpdateEvent(
                    text=(
                        f"The model run hit an error. Waiting about {retry_delay_seconds:.1f}s before retry "
                        f"({attempt_number}/{total_attempts})."
                    )
                )

                if recovered_tool_calls:
                    yield ProgressUpdateEvent(
                        text=f"Recovered {recovered_tool_calls} unfinished tool call(s) before retrying."
                    )

                if retry_delay_seconds >= 5:
                    yield ProgressUpdateEvent(
                        text="Still working. The server will keep retrying automatically."
                    )

                await asyncio.sleep(retry_delay_seconds)
                yield ProgressUpdateEvent(text="Retrying the OpenAI run now.")

                if run_started:
                    next_agent_input = cast(list[ResponseInputItemParam], [])

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
        typed_metadata = self._apply_metadata_patch(
            thread,
            context,
            cast(
                ChatMetadataPatch,
                {
                    "title": thread.title or typed_metadata.get("title"),
                    "openai_conversation_id": result_conversation_id,
                    "openai_previous_response_id": result_response_id,
                    "chart_cache": context.chart_cache,
                    "usage": updated_usage,
                },
            ),
        )
        context.chart_cache = dict(typed_metadata.get("chart_cache") or {})
        conversation_id = result_conversation_id
        previous_response_id = result_response_id

        log_event(
            self.logger,
            logging.INFO,
            "respond.end",
            logs=_logs_link(result_response_id, conversation_id),
            context=_context_line(user_id=context.user_id, thread_id=thread.id),
            usage=_usage_line(updated_usage, model=requested_model),
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
            logs=_logs_link(conversation.id),
            context=_context_line(user_id=context.user_id, thread_id=thread.id),
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

    def _should_retry_exception(self, exc: Exception) -> bool:
        status_code = getattr(exc, "status_code", None)
        if not isinstance(status_code, int):
            return True
        if status_code in {408, 409, 429}:
            return True
        return status_code >= 500

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
            logs=_logs_link(conversation_id),
            summary=summarize_pairs_for_log(
                (
                    ("trailing_items", len(trailing_items)),
                    ("dangling_tool_calls", len(dangling_tool_calls)),
                    (
                        "dangling_call_ids",
                        summarize_sequence_for_log(
                            [item.call_id for item in dangling_tool_calls]
                        ),
                    ),
                )
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
            logs=_logs_link(conversation_id),
            recovery=summarize_pairs_for_log(
                (
                    ("count", len(dangling_tool_calls)),
                    (
                        "call_ids",
                        summarize_sequence_for_log(
                            [item.call_id for item in dangling_tool_calls]
                        ),
                    ),
                )
            ),
        )
        return len(dangling_tool_calls)

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

    @staticmethod
    def _feedback_session_from_metadata(
        metadata: object,
    ) -> PendingFeedbackSession | None:
        if not isinstance(metadata, dict):
            return None
        session = metadata.get("feedback_session")
        return cast(PendingFeedbackSession, session) if isinstance(session, dict) else None

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
        if action.type == "update_chat_metadata" and isinstance(action.payload, dict):
            current_metadata = parse_chat_metadata(thread.metadata)
            patch = cast(ChatMetadataPatch, action.payload)
            thread.metadata = dict(merge_chat_metadata(current_metadata, patch))
            if title := patch.get("title"):
                thread.title = title
            context.thread_title = thread.title
            log_event(
                self.logger,
                logging.INFO,
                "chat_metadata.updated",
                context=_context_line(user_id=context.user_id, thread_id=thread.id),
                changes=summarize_mapping_keys_for_log(patch),
            )
            yield ProgressUpdateEvent(text="Saved thread metadata update.")
            return

        if action.type == "submit_feedback_session" and sender is not None:
            payload = TypeAdapter(SubmitFeedbackSessionPayload).validate_python(
                action.payload or {}
            )
            current_metadata = parse_chat_metadata(thread.metadata)
            session = self._feedback_session_from_metadata(current_metadata)
            if session is None or session.get("session_id") != payload.session_id:
                yield ProgressUpdateEvent(text="Feedback session was not found.")
                return
            selected_option = _normalize_feedback_message(payload.selected_option)
            message = _normalize_feedback_message(payload.message)
            final_message = message
            if final_message is None and selected_option in session["recommended_options"]:
                final_message = selected_option
            if final_message is None:
                yield ProgressUpdateEvent(
                    text="Choose one of the suggested notes or write a short feedback message before saving."
                )
                return
            final_sentiment = payload.sentiment
            if final_sentiment not in {"positive", "negative"}:
                final_sentiment = session.get("inferred_sentiment")
            if final_sentiment not in {"positive", "negative"}:
                yield ProgressUpdateEvent(
                    text="Choose Positive or Negative before saving feedback."
                )
                return
            updated_session: PendingFeedbackSession = {
                **session,
                "message_draft": final_message,
                "inferred_sentiment": final_sentiment,
            }
            merged_metadata = merge_chat_metadata(
                current_metadata,
                cast(ChatMetadataPatch, {"feedback_session": updated_session}),
            )
            thread.metadata = dict(merged_metadata)
            context.thread_metadata = merged_metadata
            await self.store.save_thread(thread, context=context)
            log_event(
                self.logger,
                logging.INFO,
                "feedback.confirmed",
                context=_context_line(user_id=context.user_id, thread_id=thread.id),
                feedback=summarize_pairs_for_log(
                    (
                        ("session_id", payload.session_id),
                        ("sentiment", final_sentiment),
                        ("item_ids", summarize_sequence_for_log(session["item_ids"])),
                    )
                ),
            )
            yield ThreadItemRemovedEvent(item_id=sender.id)
            return

        if action.type == "cancel_feedback_session" and sender is not None:
            payload = TypeAdapter(CancelFeedbackSessionPayload).validate_python(
                action.payload or {}
            )
            current_metadata = parse_chat_metadata(thread.metadata)
            session = self._feedback_session_from_metadata(current_metadata)
            if session is not None and session.get("session_id") == payload.session_id:
                merged_metadata = merge_chat_metadata(
                    current_metadata,
                    cast(ChatMetadataPatch, {"feedback_session": None}),
                )
                thread.metadata = dict(merged_metadata)
                context.thread_metadata = merged_metadata
                await self.store.save_thread(thread, context=context)
                log_event(
                    self.logger,
                    logging.INFO,
                    "feedback.cancelled",
                    context=_context_line(user_id=context.user_id, thread_id=thread.id),
                    session_id=payload.session_id,
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
        if action.type == "update_chat_metadata" and isinstance(action.payload, dict):
            current_metadata = parse_chat_metadata(thread.metadata)
            patch = cast(ChatMetadataPatch, action.payload)
            thread.metadata = dict(merge_chat_metadata(current_metadata, patch))
            if title := patch.get("title"):
                thread.title = title
            await self.store.save_thread(thread, context=context)
            log_event(
                self.logger,
                logging.INFO,
                "chat_metadata.sync_updated",
                context=_context_line(user_id=context.user_id, thread_id=thread.id),
                changes=summarize_mapping_keys_for_log(patch),
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
            context=_context_line(user_id=context.user_id, report_id=context.report_id),
            request=summarize_pairs_for_log(
                (
                    ("model", model),
                    ("mime_type", audio_input.mime_type),
                    ("bytes", len(audio_input.data)),
                )
            ),
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
            context=_context_line(user_id=context.user_id, report_id=context.report_id),
            usage=summarize_pairs_for_log(
                (
                    ("model", model),
                    ("seconds", seconds),
                    (
                        "cost_usd",
                        _format_cost_usd(
                            float(
                                context.thread_metadata.get("usage", {}).get(
                                    "cost_usd", 0.0
                                )
                            )
                        ),
                    ),
                )
            ),
        )
        return TranscriptionResult(text=result.text)


async def build_chatkit_server(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ClientWorkspaceChatKitServer:
    return ClientWorkspaceChatKitServer(
        db,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )
