from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException, status
from pydantic import TypeAdapter
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from chatkit.store import AttachmentStore, NotFoundError, Store
from chatkit.types import (
    Attachment,
    AttachmentCreateParams,
    AttachmentUploadDescriptor,
    FileAttachment,
    Page,
    ThreadItem,
    ThreadMetadata,
    ThreadStatus,
)

from backend.app.agents.context import AdvisoryAgentContext
from backend.app.chatkit.attachment_payloads import (
    build_canonical_attachment,
    build_display_attachment,
    normalize_attachment_for_storage,
)
from backend.app.core.config import Settings, get_settings, resolve_public_base_url
from backend.app.models.advisory import (
    AdvisoryCase,
    AdvisoryChat,
    AdvisoryChatAttachment,
    AdvisoryChatEntry,
    AdvisoryImage,
)
from backend.app.services.bucket_storage import BucketStorageService, RailwayBucketService
from backend.app.services.advisory_image_service import AdvisoryImageService
from backend.app.services.upload_rules import validate_advisory_image_upload

THREAD_ITEM_ADAPTER = TypeAdapter(ThreadItem)
ATTACHMENT_ADAPTER = TypeAdapter(Attachment)


class AdvisoryMemoryStore(
    Store[AdvisoryAgentContext],
    AttachmentStore[AdvisoryAgentContext],
):
    def __init__(
        self,
        db: AsyncSession,
        *,
        settings: Settings | None = None,
        public_base_url: str | None = None,
        bucket_service: BucketStorageService | None = None,
    ):
        self.db = db
        self.settings = settings or get_settings()
        self.public_base_url = resolve_public_base_url(
            public_base_url,
            settings=self.settings,
        )
        self.bucket_service = bucket_service or RailwayBucketService(self.settings)
        self.image_service = AdvisoryImageService(
            db,
            settings=self.settings,
            bucket_service=self.bucket_service,
        )

    def generate_thread_id(self, context: AdvisoryAgentContext) -> str:
        if context.chat_id and context.chat_id != "pending_chat":
            return context.chat_id
        return f"chat_{uuid4().hex}"

    async def create_attachment(
        self,
        input: AttachmentCreateParams,
        context: AdvisoryAgentContext,
    ) -> Attachment:
        await self._require_case(context)
        validate_advisory_image_upload(
            settings=self.settings,
            file_name=input.name,
            mime_type=input.mime_type,
            byte_size=input.size,
        )
        attachment_id = self.generate_attachment_id(input.mime_type, context)
        storage_key = self.bucket_service.build_object_key(
            scope="chat_attachment",
            attachment_id=attachment_id,
        )
        upload = self.bucket_service.build_presigned_upload(
            key=storage_key,
            mime_type=input.mime_type,
            file_name=input.name,
        )
        attachment = FileAttachment(
            id=attachment_id,
            name=input.name,
            mime_type=input.mime_type,
            upload_descriptor=AttachmentUploadDescriptor(
                url=upload.url,
                method="PUT",
                headers=upload.headers,
            ),
            thread_id=None,
            metadata={
                "user_id": context.user_id,
                "case_id": context.case_id,
                "declared_size": input.size,
                "storage_provider": self.bucket_service.storage_provider,
                "storage_key": storage_key,
                "input_kind": "image",
                "upload_state": "pending",
            },
        )
        await self.save_attachment(attachment, context)
        return attachment

    async def load_thread(
        self,
        thread_id: str,
        context: AdvisoryAgentContext,
    ) -> ThreadMetadata:
        chat = await self._get_chat(thread_id, context)
        return self._to_thread_metadata(chat)

    async def save_thread(
        self,
        thread: ThreadMetadata,
        context: AdvisoryAgentContext,
    ) -> None:
        existing = await self.db.get(AdvisoryChat, thread.id)
        next_sequence = await self._next_sequence(AdvisoryChat.updated_sequence)
        if existing is None:
            self.db.add(
                AdvisoryChat(
                    id=thread.id,
                    case_id=context.case_id,
                    user_id=context.user_id,
                    title=thread.title,
                    metadata_json=thread.metadata,
                    status_json=thread.status.model_dump(),
                    allowed_image_domains_json=thread.allowed_image_domains,
                    updated_sequence=next_sequence,
                )
            )
        else:
            existing.title = thread.title
            existing.metadata_json = thread.metadata
            existing.status_json = thread.status.model_dump()
            existing.allowed_image_domains_json = thread.allowed_image_domains
            existing.updated_sequence = next_sequence
            existing.updated_at = datetime.now(UTC)
            existing.case_id = context.case_id
            existing.user_id = context.user_id
        await self.db.commit()

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: AdvisoryAgentContext,
    ) -> Page[ThreadItem]:
        await self._get_chat(thread_id, context)
        query = select(AdvisoryChatEntry).where(AdvisoryChatEntry.chat_id == thread_id)
        query = await self._apply_item_cursor(query, after, order)
        query = query.order_by(
            AdvisoryChatEntry.sequence.desc()
            if order == "desc"
            else AdvisoryChatEntry.sequence.asc()
        )
        query = query.limit(limit + 1)
        result = await self.db.execute(query)
        records = list(result.scalars().all())
        has_more = len(records) > limit
        page_records = records[:limit]
        next_after = page_records[-1].id if has_more and page_records else None
        return Page[ThreadItem](
            data=[await self._to_thread_item(record) for record in page_records],
            has_more=has_more,
            after=next_after,
        )

    async def save_attachment(
        self,
        attachment: Attachment,
        context: AdvisoryAgentContext,
    ) -> None:
        canonical_attachment = normalize_attachment_for_storage(attachment)
        payload = canonical_attachment.model_dump(mode="json")
        existing = await self.db.get(AdvisoryChatAttachment, canonical_attachment.id)
        if existing is None:
            self.db.add(
                AdvisoryChatAttachment(
                    id=canonical_attachment.id,
                    kind=canonical_attachment.type,
                    payload=payload,
                )
            )
        else:
            existing.kind = canonical_attachment.type
            existing.payload = payload
        await self.db.commit()

    async def load_attachment(
        self,
        attachment_id: str,
        context: AdvisoryAgentContext,
        *,
        hydrate_preview: bool = False,
    ) -> Attachment:
        record = await self.db.get(AdvisoryChatAttachment, attachment_id)
        if record is None:
            raise NotFoundError(f"Attachment {attachment_id} was not found")
        attachment = ATTACHMENT_ADAPTER.validate_python(record.payload)
        if not hydrate_preview:
            return attachment
        return await self._hydrate_attachment_for_display(attachment)

    async def bind_attachment_to_thread(
        self,
        *,
        attachment_id: str,
        thread_id: str,
    ) -> None:
        record = await self.db.get(AdvisoryChatAttachment, attachment_id)
        if record is None:
            raise NotFoundError(f"Attachment {attachment_id} was not found")
        attachment = ATTACHMENT_ADAPTER.validate_python(record.payload)
        canonical_attachment = normalize_attachment_for_storage(
            attachment.model_copy(update={"thread_id": thread_id})
        )
        record.kind = canonical_attachment.type
        record.payload = canonical_attachment.model_dump(mode="json")
        metadata = (
            canonical_attachment.metadata
            if isinstance(canonical_attachment.metadata, dict)
            else {}
        )
        image_id = metadata.get("image_id")
        if isinstance(image_id, str) and image_id.strip():
            image = await self.db.get(AdvisoryImage, image_id.strip())
            if image is not None:
                image.chat_id = thread_id
                image.attachment_id = attachment_id
        await self.db.commit()

    async def delete_attachment(
        self,
        attachment_id: str,
        context: AdvisoryAgentContext,
    ) -> None:
        record = await self.db.get(AdvisoryChatAttachment, attachment_id)
        if record is None:
            return
        attachment = ATTACHMENT_ADAPTER.validate_python(record.payload)
        metadata = attachment.metadata if isinstance(attachment.metadata, dict) else {}
        image_id = metadata.get("image_id")
        if isinstance(image_id, str) and image_id.strip():
            image = await self.db.get(AdvisoryImage, image_id.strip())
            if image is not None:
                image.status = "deleted"
                try:
                    await self.bucket_service.delete_object(key=image.storage_key)
                except Exception:
                    pass
        await self.db.delete(record)
        await self.db.commit()

    async def finalize_attachment(
        self,
        attachment: Attachment,
        *,
        thread_id: str | None,
    ) -> Attachment:
        metadata = attachment.metadata if isinstance(attachment.metadata, dict) else {}
        if metadata.get("upload_state") != "pending":
            return normalize_attachment_for_storage(
                attachment.model_copy(update={"thread_id": thread_id})
            )
        user_id = metadata.get("user_id")
        case_id = metadata.get("case_id")
        declared_size = metadata.get("declared_size")
        storage_key = metadata.get("storage_key")
        if (
            not isinstance(user_id, str)
            or not user_id.strip()
            or not isinstance(case_id, str)
            or not case_id.strip()
            or not isinstance(declared_size, int)
            or declared_size < 0
            or not isinstance(storage_key, str)
            or not storage_key.strip()
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Attachment upload metadata was incomplete.",
            )
        image = await self.image_service.finalize_pending_attachment(
            user_id=user_id.strip(),
            case_id=case_id.strip(),
            chat_id=thread_id,
            attachment_id=attachment.id,
            file_name=attachment.name,
            mime_type=attachment.mime_type,
            declared_size=declared_size,
            storage_key=storage_key.strip(),
        )
        canonical_attachment = build_canonical_attachment(
            image=image,
            attachment_id=attachment.id,
            thread_id=thread_id,
        )
        await self.save_attachment(canonical_attachment, context=None)  # type: ignore[arg-type]
        return canonical_attachment

    async def load_threads(
        self,
        limit: int,
        after: str | None,
        order: str,
        context: AdvisoryAgentContext,
    ) -> Page[ThreadMetadata]:
        query = select(AdvisoryChat).where(
            AdvisoryChat.user_id == context.user_id,
            AdvisoryChat.case_id == context.case_id,
        )
        query = await self._apply_thread_cursor(query, after, order)
        query = query.order_by(
            AdvisoryChat.updated_sequence.desc()
            if order == "desc"
            else AdvisoryChat.updated_sequence.asc()
        )
        query = query.limit(limit + 1)
        result = await self.db.execute(query)
        records = list(result.scalars().all())
        has_more = len(records) > limit
        page_records = records[:limit]
        next_after = page_records[-1].id if has_more and page_records else None
        return Page[ThreadMetadata](
            data=[self._to_thread_metadata(record) for record in page_records],
            has_more=has_more,
            after=next_after,
        )

    async def add_thread_item(
        self,
        thread_id: str,
        item: ThreadItem,
        context: AdvisoryAgentContext,
    ) -> None:
        existing = await self.db.get(AdvisoryChatEntry, item.id)
        attachments = getattr(item, "attachments", None)
        if isinstance(attachments, list) and attachments:
            item = item.model_copy(
                update={
                    "attachments": [
                        normalize_attachment_for_storage(attachment)
                        for attachment in attachments
                    ]
                }
            )
        payload = item.model_dump(mode="json")
        if existing is None:
            self.db.add(
                AdvisoryChatEntry(
                    id=item.id,
                    chat_id=thread_id,
                    kind=item.type,
                    payload=payload,
                    sequence=await self._next_sequence(AdvisoryChatEntry.sequence),
                )
            )
        else:
            existing.chat_id = thread_id
            existing.kind = item.type
            existing.payload = payload
        await self._touch_chat(thread_id)
        await self.db.commit()

    async def save_item(
        self,
        thread_id: str,
        item: ThreadItem,
        context: AdvisoryAgentContext,
    ) -> None:
        await self.add_thread_item(thread_id, item, context)

    async def load_item(
        self,
        thread_id: str,
        item_id: str,
        context: AdvisoryAgentContext,
    ) -> ThreadItem:
        record = await self.db.get(AdvisoryChatEntry, item_id)
        if record is None or record.chat_id != thread_id:
            raise NotFoundError(f"Thread item {item_id} was not found")
        return await self._to_thread_item(record)

    async def delete_thread(
        self,
        thread_id: str,
        context: AdvisoryAgentContext,
    ) -> None:
        chat = await self.db.get(AdvisoryChat, thread_id)
        if chat is None:
            return
        await self.db.execute(delete(AdvisoryChatEntry).where(AdvisoryChatEntry.chat_id == thread_id))
        await self.db.delete(chat)
        await self.db.commit()

    async def delete_thread_item(
        self,
        thread_id: str,
        item_id: str,
        context: AdvisoryAgentContext,
    ) -> None:
        record = await self.db.get(AdvisoryChatEntry, item_id)
        if record is None or record.chat_id != thread_id:
            return
        await self.db.delete(record)
        await self._touch_chat(thread_id)
        await self.db.commit()

    async def _get_chat(self, thread_id: str, context: AdvisoryAgentContext) -> AdvisoryChat:
        result = await self.db.execute(
            select(AdvisoryChat).where(
                AdvisoryChat.id == thread_id,
                AdvisoryChat.user_id == context.user_id,
                AdvisoryChat.case_id == context.case_id,
            )
        )
        chat = result.scalar_one_or_none()
        if chat is None:
            raise NotFoundError(f"Thread {thread_id} was not found")
        return chat

    async def _touch_chat(self, thread_id: str) -> None:
        chat = await self.db.get(AdvisoryChat, thread_id)
        if chat is not None:
            chat.updated_sequence = await self._next_sequence(AdvisoryChat.updated_sequence)
            chat.updated_at = datetime.now(UTC)

    async def _apply_thread_cursor(self, query, after: str | None, order: str):
        if after is None:
            return query
        cursor = await self.db.get(AdvisoryChat, after)
        if cursor is None:
            return query
        if order == "desc":
            return query.where(AdvisoryChat.updated_sequence < cursor.updated_sequence)
        return query.where(AdvisoryChat.updated_sequence > cursor.updated_sequence)

    async def _apply_item_cursor(self, query, after: str | None, order: str):
        if after is None:
            return query
        cursor = await self.db.get(AdvisoryChatEntry, after)
        if cursor is None:
            return query
        if order == "desc":
            return query.where(AdvisoryChatEntry.sequence < cursor.sequence)
        return query.where(AdvisoryChatEntry.sequence > cursor.sequence)

    async def _next_sequence(self, column) -> int:
        result = await self.db.execute(select(func.max(column)))
        return int(result.scalar_one() or 0) + 1

    async def _require_case(self, context: AdvisoryAgentContext) -> AdvisoryCase:
        advisory_case = await self.db.get(AdvisoryCase, context.case_id)
        if advisory_case is None or advisory_case.user_id != context.user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Advisory case not found.",
            )
        return advisory_case

    def _to_thread_metadata(self, chat: AdvisoryChat) -> ThreadMetadata:
        return ThreadMetadata(
            id=chat.id,
            title=chat.title,
            created_at=chat.created_at,
            status=TypeAdapter(ThreadStatus).validate_python(chat.status_json),
            allowed_image_domains=chat.allowed_image_domains_json,
            metadata=dict(chat.metadata_json),
        )

    async def _to_thread_item(self, item: AdvisoryChatEntry) -> ThreadItem:
        parsed_item = THREAD_ITEM_ADAPTER.validate_python(item.payload)
        attachments = getattr(parsed_item, "attachments", None)
        if not isinstance(attachments, list) or not attachments:
            return parsed_item
        return parsed_item.model_copy(
            update={
                "attachments": [
                    await self._hydrate_attachment_for_display(attachment)
                    for attachment in attachments
                ]
            }
        )

    async def _hydrate_attachment_for_display(
        self,
        attachment: Attachment,
    ) -> Attachment:
        metadata = attachment.metadata if isinstance(attachment.metadata, dict) else {}
        if metadata.get("input_kind") != "image" or attachment.upload_descriptor is not None:
            return attachment
        image_id = metadata.get("image_id")
        if not isinstance(image_id, str) or not image_id.strip():
            return attachment
        image = await self.db.get(AdvisoryImage, image_id.strip())
        if image is None or image.status == "deleted":
            return attachment
        return build_display_attachment(
            canonical_attachment=attachment,
            preview_url=self.image_service.build_public_preview_url(image),
        )
