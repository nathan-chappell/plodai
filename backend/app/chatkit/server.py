from __future__ import annotations

import asyncio
from base64 import b64encode
import logging
import random
import re
from typing import Any, AsyncIterator, cast

from agents import Runner
from agents.model_settings import ModelSettings
from chatkit.actions import Action
from chatkit.agents import (
    AgentContext as ChatKitAgentContext,
    ThreadItemConverter,
)
from chatkit.server import ChatKitServer
from chatkit.types import (
    Attachment,
    AudioInput,
    ChatKitReq,
    ProgressUpdateEvent,
    SyncCustomActionResponse,
    ThreadItem,
    ThreadItemDoneEvent,
    ThreadMetadata,
    ThreadStreamEvent,
    TranscriptionResult,
    UserMessageItem,
    UserMessageTagContent,
    UserMessageTextContent,
    WidgetItem,
)
from fastapi import Depends, HTTPException, Request, status
from openai import AsyncOpenAI
from openai.types.conversations.conversation_item import ConversationItem
from openai.types.responses import (
    ResponseInputContentParam,
    ResponseInputImageParam,
    ResponseInputItemParam,
    ResponseInputMessageContentListParam,
    ResponseInputTextParam,
)
from openai.types.responses.response_function_tool_call_item import (
    ResponseFunctionToolCallItem,
)
from openai.types.responses.response_input_item_param import FunctionCallOutput, Message
from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession
from typing_extensions import assert_never

from backend.app.agents.agent_builder import build_plodai_agent
from backend.app.agents.context import (
    AdvisoryAgentContext,
    resolve_preferred_output_language,
)
from backend.app.chatkit.agent_stream import stream_agent_response_with_tool_progress
from backend.app.chatkit.memory_store import AdvisoryMemoryStore
from backend.app.chatkit.metadata import (
    AppChatMetadata,
    ChatMetadataPatch,
    merge_chat_metadata,
    parse_chat_metadata,
)
from backend.app.chatkit.usage import (
    accumulate_transcription_usage,
    accumulate_usage,
    calculate_transcription_cost_usd,
    calculate_usage_cost_usd,
    platform_logs_url,
)
from backend.app.core.config import get_settings, resolve_public_base_url
from backend.app.core.logging import get_logger, log_event, summarize_pairs_for_log
from backend.app.db.session import get_db
from backend.app.services.bucket_storage import BucketStorageService, RailwayBucketService
from backend.app.services.credit_service import CreditService
from backend.app.services.advisory_image_service import AdvisoryImageService
from backend.app.services.advisory_service import AdvisoryService

logger = get_logger("chatkit.server")

MODEL_ALIASES = {
    "default": "gpt-5.4-mini",
    "lightweight": "gpt-5.4-nano",
    "balanced": "gpt-5.4-mini",
    "powerful": "gpt-5.4",
}
DEFAULT_MODEL = MODEL_ALIASES["default"]
MAX_AGENT_TURNS = 30
VISION_IMAGE_DETAIL = "high"
RATE_LIMIT_RETRY_PATTERN = re.compile(
    r"try again in\s+(?P<seconds>\d+(?:\.\d+)?)s",
    re.IGNORECASE,
)
SAFE_AUDIO_EXTENSION_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._+-]*$", re.IGNORECASE)


def _base64_data_url(*, mime_type: str | None, file_bytes: bytes) -> str:
    resolved_mime_type = (
        mime_type.strip()
        if isinstance(mime_type, str) and mime_type.strip()
        else "application/octet-stream"
    )
    encoded = b64encode(file_bytes).decode("ascii")
    return f"data:{resolved_mime_type};base64,{encoded}"


def _transcription_upload_filename(media_type: str | None) -> str:
    normalized_media_type = (
        media_type.strip().lower()
        if isinstance(media_type, str) and media_type.strip()
        else ""
    )
    if normalized_media_type == "audio/webm":
        return "dictation.webm"
    if normalized_media_type == "audio/ogg":
        return "dictation.ogg"
    if normalized_media_type == "audio/mp4":
        return "dictation.mp4"
    if normalized_media_type.startswith("audio/"):
        subtype = normalized_media_type.split("/", 1)[1].strip()
        if SAFE_AUDIO_EXTENSION_PATTERN.fullmatch(subtype):
            return f"dictation.{subtype}"
    return "dictation.bin"


def _coerce_positive_seconds(value: object) -> float | None:
    if not isinstance(value, int | float):
        return None
    seconds = float(value)
    if seconds <= 0.0:
        return None
    return seconds


def _transcription_duration_seconds(result: object) -> float | None:
    direct_seconds = _coerce_positive_seconds(getattr(result, "duration", None))
    if direct_seconds is not None:
        return direct_seconds
    usage = getattr(result, "usage", None)
    usage_seconds = (
        usage.get("seconds")
        if isinstance(usage, dict)
        else getattr(usage, "seconds", None)
    )
    return _coerce_positive_seconds(usage_seconds)


def _current_thread_metadata(thread: ThreadMetadata) -> AppChatMetadata:
    return parse_chat_metadata(thread.metadata)


def _is_gpt_5_4_family_model(model: str | None) -> bool:
    return isinstance(model, str) and model.startswith("gpt-5.4")


def _model_settings_override_for_model(model: str | None) -> ModelSettings | None:
    if not _is_gpt_5_4_family_model(model):
        return None
    return ModelSettings(reasoning={"effort": "low", "summary": "auto"})


def _context_line(
    *,
    user_id: str | None = None,
    thread_id: str | None = None,
    case_id: str | None = None,
) -> str | None:
    return summarize_pairs_for_log(
        (
            ("user", user_id),
            ("thread", thread_id),
            ("case", case_id),
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


class AdvisoryThreadItemConverter(ThreadItemConverter):
    def __init__(
        self,
        db: AsyncSession,
        *,
        bucket_service: BucketStorageService | None = None,
    ):
        self.db = db
        self.bucket_service = bucket_service or RailwayBucketService(get_settings())
        self.image_service = AdvisoryImageService(
            db,
            settings=get_settings(),
            bucket_service=self.bucket_service,
        )
        self.current_thread: ThreadMetadata | None = None
        self.current_context: AdvisoryAgentContext | None = None

    def bind_request(
        self,
        *,
        thread: ThreadMetadata,
        context: AdvisoryAgentContext,
    ) -> None:
        self.current_thread = thread
        self.current_context = context

    async def attachment_to_message_content(
        self,
        attachment: Attachment,
    ) -> ResponseInputContentParam:
        metadata = attachment.metadata if isinstance(attachment.metadata, dict) else {}
        image_id = metadata.get("image_id")
        if not isinstance(image_id, str) or not image_id.strip():
            return {
                "type": "input_text",
                "text": f"Attachment '{attachment.name}' could not be resolved as an advisory image.",
            }
        context = self.current_context
        if context is None:
            raise RuntimeError("Advisory thread converter is not bound to a request.")
        image = await self.image_service.get_image(
            user_id=context.user_id,
            case_id=context.case_id,
            image_id=image_id.strip(),
        )
        image_bytes = await self.image_service.load_image_bytes(image)
        return ResponseInputImageParam(
            type="input_image",
            image_url=_base64_data_url(
                mime_type=image.mime_type or attachment.mime_type,
                file_bytes=image_bytes,
            ),
            detail=VISION_IMAGE_DETAIL,
        )

    async def user_message_to_input(
        self,
        item: UserMessageItem,
        is_last_message: bool = True,
    ) -> ResponseInputItemParam | list[ResponseInputItemParam] | None:
        message_text_parts: list[str] = []
        raw_tags: list[UserMessageTagContent] = []
        current_attachment_image_ids: set[str] = set()
        attachment_content: list[ResponseInputContentParam] = []

        for attachment in item.attachments:
            attachment_content.append(await self.attachment_to_message_content(attachment))
            metadata = attachment.metadata if isinstance(attachment.metadata, dict) else {}
            image_id = metadata.get("image_id")
            if isinstance(image_id, str) and image_id.strip():
                current_attachment_image_ids.add(image_id.strip())

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
                ResponseInputTextParam(type="input_text", text="".join(message_text_parts)),
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
                        current_attachment_image_ids=current_attachment_image_ids,
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
            current_attachment_image_ids=set(),
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
        current_attachment_image_ids: set[str],
    ) -> list[ResponseInputContentParam]:
        tag_data = tag.data if isinstance(tag.data, dict) else {}
        entity_type = tag_data.get("entity_type")
        if entity_type == "advisory_image":
            return await self._advisory_image_tag_to_message_contents(
                tag,
                tag_data=tag_data,
                current_attachment_image_ids=current_attachment_image_ids,
            )
        if entity_type in {
            "advisory_subject",
            "advisory_report",
            "advisory_query",
            "advisory_measurement",
            "advisory_material",
        }:
            return [self._advisory_entity_text(tag.text, tag_data)]
        return [
            {
                "type": "input_text",
                "text": f"Tagged context: {tag.text}",
            }
        ]

    async def _advisory_image_tag_to_message_contents(
        self,
        tag: UserMessageTagContent,
        *,
        tag_data: dict[str, Any],
        current_attachment_image_ids: set[str],
    ) -> list[ResponseInputContentParam]:
        image_id = tag_data.get("image_id")
        context = self.current_context
        if not isinstance(image_id, str) or not image_id.strip() or context is None:
            return [
                {
                    "type": "input_text",
                    "text": f"Tagged advisory image '{tag.text}' could not be resolved.",
                }
            ]
        image_id = image_id.strip()
        if image_id in current_attachment_image_ids:
            return [
                {
                    "type": "input_text",
                    "text": (
                        f"The tagged advisory image '{tag.text.strip() or image_id}' is already attached in this message."
                    ),
                }
            ]
        image = await self.image_service.get_image(
            user_id=context.user_id,
            case_id=context.case_id,
            image_id=image_id,
        )
        image_bytes = await self.image_service.load_image_bytes(image)
        return [
            {
                "type": "input_text",
                "text": (
                    f"Tagged advisory image '{image.name}' was explicitly referenced by the user."
                ),
            },
            ResponseInputImageParam(
                type="input_image",
                image_url=_base64_data_url(
                    mime_type=image.mime_type,
                    file_bytes=image_bytes,
                ),
                detail=VISION_IMAGE_DETAIL,
            ),
        ]

    def _advisory_entity_text(
        self,
        label: str,
        tag_data: dict[str, Any],
    ) -> ResponseInputContentParam:
        parts: list[str] = [f"Tagged advisory context: {label.strip()}."]
        for key, prefix in (
            ("kind", "Kind"),
            ("category", "Category"),
            ("type", "Type"),
            ("status", "Status"),
            ("severity", "Severity"),
            ("location", "Location"),
            ("quantity", "Quantity"),
            ("value", "Value"),
            ("unit", "Unit"),
            ("measured_at", "Measured"),
            ("observed_at", "Observed"),
            ("reported_at", "Reported"),
            ("asked_at", "Asked"),
            ("subject_names", "Subjects"),
            ("supplier_name", "Supplier"),
            ("description", "Description"),
            ("answer_summary", "Answer summary"),
            ("recommended_follow_up", "Follow-up"),
            ("purpose", "Purpose"),
            ("notes", "Notes"),
            ("supplier_url", "Supplier link"),
        ):
            value = tag_data.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(f"{prefix}: {value.strip()}.")
        return {
            "type": "input_text",
            "text": " ".join(parts),
        }


class AdvisoryChatKitServer(ChatKitServer[AdvisoryAgentContext]):
    def __init__(
        self,
        db: AsyncSession,
        *,
        case_id: str,
        public_base_url: str | None = None,
        bucket_service: BucketStorageService | None = None,
    ):
        self.settings = get_settings()
        self.db = db
        self.case_id = case_id
        self.public_base_url = public_base_url
        self.openai_client = AsyncOpenAI(
            api_key=self.settings.OPENAI_API_KEY or None,
            max_retries=self.settings.openai_max_retries,
        )
        self.bucket_service = bucket_service or RailwayBucketService(self.settings)
        self.advisory_service = AdvisoryService(db)
        self.image_service = AdvisoryImageService(
            db,
            settings=self.settings,
            bucket_service=self.bucket_service,
        )
        store = AdvisoryMemoryStore(
            db,
            public_base_url=public_base_url,
            bucket_service=self.bucket_service,
        )
        super().__init__(store=store, attachment_store=store)
        self.converter = AdvisoryThreadItemConverter(
            db,
            bucket_service=self.bucket_service,
        )

    async def build_request_context(
        self,
        raw_request: bytes | str,
        user_id: str,
        user_email: str | None,
        preferred_output_language: str | None = None,
    ) -> AdvisoryAgentContext:
        parsed_request = TypeAdapter(ChatKitReq).validate_json(raw_request)
        try:
            metadata = parse_chat_metadata(parsed_request.metadata)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc
        thread_id = getattr(parsed_request.params, "thread_id", None)
        advisory_case = await self.advisory_service.require_case(user_id=user_id, case_id=self.case_id)
        record = await self.advisory_service.get_record(user_id=user_id, case_id=self.case_id)
        images = await self.image_service.list_images(
            user_id=user_id,
            case_id=self.case_id,
            public_base_url=self.public_base_url,
        )
        chat_id = thread_id or await self.advisory_service.get_chat_id(
            user_id=user_id,
            case_id=self.case_id,
        )
        resolved_output_language = resolve_preferred_output_language(
            preferred_output_language
        )
        context = AdvisoryAgentContext(
            chat_id=chat_id or "pending_chat",
            user_id=user_id,
            user_email=user_email,
            db=self.db,
            case_id=advisory_case.id,
            case_title=record.title or advisory_case.title,
            thread_title=metadata.get("title"),
            request_metadata=metadata,
            thread_metadata=metadata,
            preferred_output_language=resolved_output_language,
            current_record=record,
            advisory_images=images,
        )
        log_event(
            logger,
            logging.INFO,
            "request_context.build",
            context=_context_line(user_id=user_id, thread_id=thread_id, case_id=self.case_id),
            request=summarize_pairs_for_log(
                (
                    ("op", parsed_request.type),
                    ("images", len(images)),
                    ("output_language", resolved_output_language),
                )
            ),
        )
        return context

    async def _process_new_thread_item_respond(
        self,
        thread: ThreadMetadata,
        item: UserMessageItem,
        context: AdvisoryAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        item = await self._finalize_new_item_attachments(item, thread_id=thread.id)
        for attachment in item.attachments:
            await self.store.bind_attachment_to_thread(
                attachment_id=attachment.id,
                thread_id=thread.id,
            )
        item = item.model_copy(
            update={
                "attachments": await self._load_display_attachments_for_item(
                    item.attachments,
                    context=context,
                )
            }
        )
        await self.store.add_thread_item(thread.id, item, context=context)
        yield ThreadItemDoneEvent(item=item)
        async for event in self._process_events(
            thread,
            context,
            lambda: self.respond(thread, item, context),
        ):
            yield event

    async def _finalize_new_item_attachments(
        self,
        item: UserMessageItem,
        *,
        thread_id: str,
    ) -> UserMessageItem:
        if not item.attachments:
            return item
        finalized_attachments: list[Attachment] = []
        for attachment in item.attachments:
            finalized_attachments.append(
                await self.store.finalize_attachment(
                    attachment,
                    thread_id=thread_id,
                )
            )
        return item.model_copy(update={"attachments": finalized_attachments})

    async def _load_display_attachments_for_item(
        self,
        attachments: list[Attachment],
        *,
        context: AdvisoryAgentContext,
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

    def _apply_metadata_patch(
        self,
        thread: ThreadMetadata,
        context: AdvisoryAgentContext,
        patch: ChatMetadataPatch,
    ) -> AppChatMetadata:
        merged_metadata = merge_chat_metadata(_current_thread_metadata(thread), patch)
        thread.metadata = dict(merged_metadata)
        context.thread_metadata = merged_metadata
        context.thread_title = thread.title
        return merged_metadata

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: AdvisoryAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        typed_metadata = _current_thread_metadata(thread)
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
        agent_input = cast(
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
            logger,
            logging.INFO,
            "respond.start",
            logs=_logs_link(conversation_id),
            context=_context_line(
                user_id=context.user_id,
                thread_id=thread.id,
                case_id=context.case_id,
            ),
            run=summarize_pairs_for_log(
                (
                    ("model", requested_model),
                    ("pending_items", len(pending_items)),
                    ("agent_input_items", len(agent_input)),
                )
            ),
        )

        agent = build_plodai_agent(
            context,
            model=requested_model,
            model_settings_override=_model_settings_override_for_model(requested_model),
        )
        agent_context = ChatKitAgentContext[AdvisoryAgentContext](
            thread=thread,
            store=self.store,
            request_context=context,
        )

        max_retries = max(0, self.settings.openai_max_retries)
        updated_usage = typed_metadata.get("usage")
        next_agent_input: str | list[ResponseInputItemParam] = agent_input
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
                async for event in stream_agent_response_with_tool_progress(
                    agent_context,
                    result,
                ):
                    yield event
                break
            except Exception as exc:
                attempt_number = attempt + 1
                total_attempts = max_retries + 1
                should_retry = attempt < max_retries and self._should_retry_exception(exc)
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
                        logger,
                        logging.ERROR,
                        "respond.error",
                        exc_info=exc,
                        context=_context_line(
                            user_id=context.user_id,
                            thread_id=thread.id,
                            case_id=context.case_id,
                        ),
                        logs=_logs_link(previous_response_id, conversation_id),
                    )
                    raise

                retry_delay_seconds = self._compute_retry_delay_seconds(exc)
                log_event(
                    logger,
                    logging.WARNING,
                    "respond.retry",
                    logs=_logs_link(conversation_id),
                    context=_context_line(
                        user_id=context.user_id,
                        thread_id=thread.id,
                        case_id=context.case_id,
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
        updated_usage = (
            accumulate_usage(
                cast(dict[str, Any] | None, updated_usage),
                result.context_wrapper.usage,
                model=requested_model,
            )
            if result.context_wrapper.usage is not None
            else updated_usage
        )
        await CreditService.record_cost_event(
            user_id=context.user_id,
            thread_id=thread.id,
            response_id=result_response_id,
            cost_usd=response_cost_usd,
        )
        self._apply_metadata_patch(
            thread,
            context,
            {
                "title": thread.title or typed_metadata.get("title"),
                "openai_conversation_id": result_conversation_id,
                "openai_previous_response_id": result_response_id,
                "usage": cast(dict[str, object] | None, updated_usage),
                "origin": typed_metadata.get("origin"),
            },
        )

        log_event(
            logger,
            logging.INFO,
            "respond.end",
            logs=_logs_link(result_response_id, result_conversation_id),
            context=_context_line(
                user_id=context.user_id,
                thread_id=thread.id,
                case_id=context.case_id,
            ),
            usage=_usage_line(updated_usage, model=requested_model),
        )

    def _resolve_requested_model(
        self,
        *,
        input_user_message: UserMessageItem | None,
        recent_items: list[ThreadItem],
    ) -> str:
        if input_user_message is not None and input_user_message.inference_options.model:
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
        context: AdvisoryAgentContext,
    ) -> str:
        conversation = await self.openai_client.conversations.create(
            metadata={
                "app": "plodai",
                "thread_id": thread.id,
                "case_id": context.case_id,
                "user_id": context.user_id,
                **(
                    {"thread_title": thread.title[:512]}
                    if isinstance(thread.title, str) and thread.title.strip()
                    else {}
                ),
            }
        )
        log_event(
            logger,
            logging.INFO,
            "respond.conversation_created",
            logs=_logs_link(conversation.id),
            context=_context_line(
                user_id=context.user_id,
                thread_id=thread.id,
                case_id=context.case_id,
            ),
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
        self,
        conversation_id: str,
        *,
        limit: int = 100,
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
        self,
        conversation_id: str,
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
        return [
            cast(ResponseFunctionToolCallItem, item)
            for item in reversed(trailing_items)
            if item.type == "function_call" and item.call_id not in resolved_call_ids
        ]

    async def _close_dangling_tool_calls(
        self,
        conversation_id: str,
        exc: Exception,
    ) -> int:
        dangling_tool_calls = await self._find_dangling_tool_calls(conversation_id)
        if not dangling_tool_calls:
            return 0
        outputs: list[FunctionCallOutput] = []
        for index, item in enumerate(dangling_tool_calls):
            outputs.append(
                {
                    "type": "function_call_output",
                    "call_id": item.call_id,
                    "output": (
                        "The previous model run ended unexpectedly before this tool call received an output. "
                        f"Underlying error: {str(exc)}"
                        if index == 0
                        else "The previous model run ended unexpectedly before this tool call received an output."
                    ),
                }
            )
        await self.openai_client.conversations.items.create(
            conversation_id,
            items=outputs,
        )
        return len(dangling_tool_calls)

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
            if boundary_item.type == "client_tool_call" and boundary_item.status == "completed":
                return [boundary_item]
            return []
        return chronological_items[boundary_index + 1 :]

    async def action(
        self,
        thread: ThreadMetadata,
        action: Action[str, Any],
        sender: WidgetItem | None,
        context: AdvisoryAgentContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        if action.type == "update_chat_metadata" and isinstance(action.payload, dict):
            patch = cast(ChatMetadataPatch, action.payload)
            merged = self._apply_metadata_patch(thread, context, patch)
            if title := patch.get("title"):
                thread.title = title
            context.thread_metadata = merged
            yield ProgressUpdateEvent(text="Saved chat metadata update.")
            return
        yield ProgressUpdateEvent(text=f"Unhandled action: {action.type}")

    async def sync_action(
        self,
        thread: ThreadMetadata,
        action: Action[str, Any],
        sender: WidgetItem | None,
        context: AdvisoryAgentContext,
    ) -> SyncCustomActionResponse:
        if action.type == "update_chat_metadata" and isinstance(action.payload, dict):
            patch = cast(ChatMetadataPatch, action.payload)
            self._apply_metadata_patch(thread, context, patch)
            if title := patch.get("title"):
                thread.title = title
            await self.store.save_thread(thread, context=context)
        return SyncCustomActionResponse(updated_item=sender)

    async def transcribe(
        self,
        audio_input: AudioInput,
        context: AdvisoryAgentContext,
    ) -> TranscriptionResult:
        model = "gpt-4o-mini-transcribe"
        upload_filename = _transcription_upload_filename(audio_input.media_type)
        log_event(
            logger,
            logging.INFO,
            "transcribe.start",
            context=_context_line(
                user_id=context.user_id,
                thread_id=context.chat_id,
                case_id=context.case_id,
            ),
            audio=summarize_pairs_for_log(
                (
                    ("media_type", audio_input.media_type),
                    ("bytes", len(audio_input.data)),
                    ("filename", upload_filename),
                )
            ),
        )
        try:
            result = await self.openai_client.audio.transcriptions.create(
                file=(upload_filename, audio_input.data, audio_input.media_type),
                model=model,
                response_format="json",
            )
        except Exception as exc:
            log_event(
                logger,
                logging.ERROR,
                "transcribe.error",
                exc_info=exc,
                context=_context_line(
                    user_id=context.user_id,
                    thread_id=context.chat_id,
                    case_id=context.case_id,
                ),
                audio=summarize_pairs_for_log(
                    (
                        ("media_type", audio_input.media_type),
                        ("bytes", len(audio_input.data)),
                        ("filename", upload_filename),
                    )
                ),
                error=f"{type(exc).__name__}: {exc}",
            )
            raise

        transcript_text = (
            result.text if isinstance(getattr(result, "text", None), str) else ""
        )
        seconds = _transcription_duration_seconds(result)
        if seconds is not None:
            context.thread_metadata = merge_chat_metadata(
                context.thread_metadata,
                {
                    "usage": accumulate_transcription_usage(
                        cast(
                            dict[str, Any] | None,
                            context.thread_metadata.get("usage"),
                        ),
                        model=model,
                        seconds=seconds,
                    )
                },
            )
            await CreditService.record_cost_event(
                user_id=context.user_id,
                thread_id=context.chat_id,
                cost_usd=calculate_transcription_cost_usd(model, seconds),
            )

        log_event(
            logger,
            logging.INFO,
            "transcribe.end",
            context=_context_line(
                user_id=context.user_id,
                thread_id=context.chat_id,
                case_id=context.case_id,
            ),
            result=summarize_pairs_for_log(
                (
                    ("model", model),
                    ("text_length", len(transcript_text)),
                    (
                        "duration_seconds",
                        f"{seconds:.3f}" if seconds is not None else None,
                    ),
                    ("billing_data", seconds is not None),
                )
            ),
        )
        return TranscriptionResult(text=transcript_text)


async def build_chatkit_server(
    case_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AdvisoryChatKitServer:
    return AdvisoryChatKitServer(
        db,
        case_id=case_id,
        public_base_url=resolve_public_base_url(str(request.base_url)),
    )
