from __future__ import annotations

import hashlib
import hmac
import logging
from base64 import urlsafe_b64decode, urlsafe_b64encode
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import cast

from fastapi import HTTPException, status
from openai import AsyncOpenAI
from pydantic import TypeAdapter
from sqlalchemy import func, select
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

from backend.app.agents.context import ReportAgentContext
from backend.app.chatkit.attachment_payloads import (
    build_display_attachment,
    normalize_attachment_for_storage,
)
from backend.app.chatkit.metadata import (
    build_remove_agriculture_image_ref_patch,
    merge_chat_metadata,
    parse_chat_metadata,
)
from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger, log_event, summarize_pairs_for_log
from backend.app.models.chatkit import (
    WorkspaceChat,
    WorkspaceWorkspaceChatAttachment,
    WorkspaceChatEntry,
)
from backend.app.models.stored_file import StoredOpenAIFile
from backend.app.models.workspace import Workspace


THREAD_ITEM_ADAPTER = TypeAdapter(ThreadItem)
ATTACHMENT_ADAPTER = TypeAdapter(Attachment)
UPLOAD_TOKEN_TTL_SECONDS = 15 * 60
logger = get_logger("chatkit.memory_store")


@dataclass(kw_only=True)
class PendingAttachmentUpload:
    attachment: Attachment
    user_id: str
    workspace_id: str
    app_id: str
    declared_size: int
    is_completed: bool = False


class DatabaseMemoryStore(
    Store[ReportAgentContext],
    AttachmentStore[ReportAgentContext],
):
    def __init__(
        self,
        db: AsyncSession,
        *,
        settings: Settings | None = None,
        public_base_url: str | None = None,
        openai_client: AsyncOpenAI | None = None,
    ):
        self.db = db
        self.settings = settings or get_settings()
        self.public_base_url = (public_base_url or "http://localhost").rstrip("/")
        self._openai_client = openai_client

    @property
    def openai_client(self) -> AsyncOpenAI:
        if self._openai_client is None:
            self._openai_client = AsyncOpenAI(
                api_key=self.settings.OPENAI_API_KEY or None,
                max_retries=self.settings.openai_max_retries,
            )
        return self._openai_client

    async def create_attachment(
        self,
        input: AttachmentCreateParams,
        context: ReportAgentContext,
    ) -> Attachment:
        workspace = await self._require_workspace(context)
        self._validate_pending_attachment_input(
            workspace=workspace,
            file_name=input.name,
            mime_type=input.mime_type,
            byte_size=input.size,
        )

        attachment_id = self.generate_attachment_id(input.mime_type, context)
        token = self._build_upload_token(
            attachment_id=attachment_id,
            user_id=context.user_id,
        )
        upload_url = (
            f"{self.public_base_url}/api/chatkit/attachments/"
            f"{attachment_id}/content?token={token}"
        )
        return FileAttachment(
            id=attachment_id,
            name=input.name,
            mime_type=input.mime_type,
            upload_descriptor=AttachmentUploadDescriptor(
                url=upload_url,
                method="POST",
            ),
            thread_id=None,
            metadata={
                "user_id": context.user_id,
                "workspace_id": workspace.id,
                "app_id": workspace.app_id,
                "declared_size": input.size,
                "scope": "chat_attachment",
                "attach_mode": "model_input",
                "input_kind": (
                    "image"
                    if _kind_for_attachment_input(
                        file_name=input.name,
                        mime_type=input.mime_type,
                    )
                    == "image"
                    else "file"
                ),
                "upload_state": "pending",
            },
        )

    async def load_thread(
        self, thread_id: str, context: ReportAgentContext
    ) -> ThreadMetadata:
        chat = await self._get_chat(thread_id)
        return self._to_thread_metadata(chat)

    async def save_thread(
        self, thread: ThreadMetadata, context: ReportAgentContext
    ) -> None:
        existing = await self.db.get(WorkspaceChat, thread.id)
        next_sequence = await self._next_sequence(WorkspaceChat.updated_sequence)
        if existing is None:
            if context.workspace_id is None:
                raise ValueError("workspace_id is required to create a chat")
            self.db.add(
                WorkspaceChat(
                    id=thread.id,
                    user_id=context.user_id,
                    workspace_id=context.workspace_id,
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
            if context.workspace_id is not None:
                existing.workspace_id = context.workspace_id
        await self.db.commit()

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: ReportAgentContext,
    ) -> Page[ThreadItem]:
        await self._get_chat(thread_id)
        query = select(WorkspaceChatEntry).where(WorkspaceChatEntry.chat_id == thread_id)
        query = await self._apply_item_cursor(query, after, order)
        query = query.order_by(
            WorkspaceChatEntry.sequence.desc()
            if order == "desc"
            else WorkspaceChatEntry.sequence.asc()
        )
        query = query.limit(limit + 1)
        result = await self.db.execute(query)
        records = list(result.scalars().all())

        has_more = len(records) > limit
        page_records = records[:limit]
        next_after = page_records[-1].id if has_more and page_records else None
        hydrated_items = [await self._to_thread_item(item) for item in page_records]
        return Page[ThreadItem](
            data=hydrated_items,
            has_more=has_more,
            after=next_after,
        )

    async def save_attachment(
        self, attachment: Attachment, context: ReportAgentContext
    ) -> None:
        canonical_attachment = normalize_attachment_for_storage(attachment)
        payload = canonical_attachment.model_dump(mode="json")
        existing = await self.db.get(WorkspaceWorkspaceChatAttachment, attachment.id)
        if existing is None:
            self.db.add(
                WorkspaceWorkspaceChatAttachment(
                    id=attachment.id,
                    kind=canonical_attachment.type,
                    payload=payload,
                )
            )
        else:
            existing.kind = canonical_attachment.type
            existing.payload = payload
        metadata = (
            canonical_attachment.metadata
            if isinstance(canonical_attachment.metadata, dict)
            else None
        )
        stored_file_id = (
            metadata.get("stored_file_id")
            if metadata is not None
            else None
        )
        if isinstance(stored_file_id, str) and stored_file_id.strip():
            stored_file = await self.db.get(StoredOpenAIFile, stored_file_id.strip())
            if stored_file is not None:
                stored_file.attachment_id = canonical_attachment.id
                if (
                    isinstance(canonical_attachment.thread_id, str)
                    and canonical_attachment.thread_id.strip()
                ):
                    stored_file.thread_id = canonical_attachment.thread_id.strip()
        await self.db.commit()

    async def load_attachment(
        self,
        attachment_id: str,
        context: ReportAgentContext,
        *,
        hydrate_preview: bool = False,
    ) -> Attachment:
        attachment = await self.db.get(WorkspaceWorkspaceChatAttachment, attachment_id)
        if attachment is None:
            raise NotFoundError(f"Attachment {attachment_id} was not found")
        parsed_attachment = ATTACHMENT_ADAPTER.validate_python(attachment.payload)
        if not hydrate_preview:
            return parsed_attachment
        return await self._hydrate_attachment_for_display(parsed_attachment)

    async def bind_attachment_to_thread(
        self,
        *,
        attachment_id: str,
        thread_id: str,
    ) -> None:
        attachment = await self.db.get(WorkspaceWorkspaceChatAttachment, attachment_id)
        if attachment is None:
            raise NotFoundError(f"Attachment {attachment_id} was not found")

        parsed_attachment = ATTACHMENT_ADAPTER.validate_python(attachment.payload)
        canonical_attachment = normalize_attachment_for_storage(
            parsed_attachment.model_copy(update={"thread_id": thread_id})
        )
        attachment.kind = canonical_attachment.type
        attachment.payload = canonical_attachment.model_dump(mode="json")

        metadata = (
            canonical_attachment.metadata
            if isinstance(canonical_attachment.metadata, dict)
            else None
        )
        stored_file_id = (
            metadata.get("stored_file_id")
            if metadata is not None
            else None
        )
        if isinstance(stored_file_id, str) and stored_file_id.strip():
            stored_file = await self.db.get(StoredOpenAIFile, stored_file_id.strip())
            if stored_file is not None:
                stored_file.attachment_id = canonical_attachment.id
                stored_file.thread_id = thread_id
        await self.db.commit()

    async def delete_attachment(
        self, attachment_id: str, context: ReportAgentContext
    ) -> None:
        result = await self.db.execute(
            select(StoredOpenAIFile).where(
                StoredOpenAIFile.attachment_id == attachment_id,
                StoredOpenAIFile.status != "deleted",
            )
        )
        stored_files = list(result.scalars().all())
        for stored_file in stored_files:
            if isinstance(stored_file.thread_id, str) and stored_file.thread_id.strip():
                chat = await self.db.get(WorkspaceChat, stored_file.thread_id.strip())
                if chat is not None and isinstance(chat.metadata_json, dict):
                    current_metadata = parse_chat_metadata(chat.metadata_json)
                    patch = build_remove_agriculture_image_ref_patch(
                        current_metadata,
                        stored_file_id=stored_file.id,
                        attachment_id=attachment_id,
                    )
                    if patch is not None:
                        chat.metadata_json = merge_chat_metadata(current_metadata, patch)
            try:
                await self.openai_client.files.delete(stored_file.openai_file_id)
            except Exception:
                log_event(
                    logger,
                    logging.WARNING,
                    "attachment.remote_delete_failed",
                    summary=summarize_pairs_for_log(
                        (
                            ("attachment", attachment_id),
                            ("stored_file", stored_file.id),
                        )
                    ),
                )
            stored_file.status = "deleted"

        attachment = await self.db.get(WorkspaceWorkspaceChatAttachment, attachment_id)
        if attachment is not None:
            await self.db.delete(attachment)
        await self.db.commit()

    async def resolve_pending_attachment_upload(
        self,
        *,
        attachment_id: str,
        token: str,
    ) -> PendingAttachmentUpload:
        try:
            attachment = await self.load_attachment(attachment_id, context=None)
        except NotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment upload not found.",
            ) from exc
        metadata = attachment.metadata if isinstance(attachment.metadata, dict) else None
        if metadata is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment upload not found.",
            )

        user_id = metadata.get("user_id")
        workspace_id = metadata.get("workspace_id")
        app_id = metadata.get("app_id")
        declared_size = metadata.get("declared_size")
        if (
            not isinstance(user_id, str)
            or not user_id.strip()
            or not isinstance(workspace_id, str)
            or not workspace_id.strip()
            or not isinstance(app_id, str)
            or not app_id.strip()
            or not isinstance(declared_size, int)
            or declared_size < 0
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment upload not found.",
            )

        self._assert_upload_token(
            attachment_id=attachment_id,
            user_id=user_id.strip(),
            token=token,
        )
        return PendingAttachmentUpload(
            attachment=attachment,
            user_id=user_id.strip(),
            workspace_id=workspace_id.strip(),
            app_id=app_id.strip(),
            declared_size=declared_size,
            is_completed=attachment.upload_descriptor is None,
        )

    async def load_threads(
        self,
        limit: int,
        after: str | None,
        order: str,
        context: ReportAgentContext,
    ) -> Page[ThreadMetadata]:
        query = select(WorkspaceChat).where(WorkspaceChat.user_id == context.user_id)
        if context.workspace_id is not None:
            query = query.where(WorkspaceChat.workspace_id == context.workspace_id)
        query = await self._apply_thread_cursor(query, after, order)
        query = query.order_by(
            WorkspaceChat.updated_sequence.desc()
            if order == "desc"
            else WorkspaceChat.updated_sequence.asc()
        )
        query = query.limit(limit + 1)
        result = await self.db.execute(query)
        records = list(result.scalars().all())

        has_more = len(records) > limit
        page_records = records[:limit]
        next_after = page_records[-1].id if has_more and page_records else None
        return Page[ThreadMetadata](
            data=[self._to_thread_metadata(chat) for chat in page_records],
            has_more=has_more,
            after=next_after,
        )

    async def add_thread_item(
        self, thread_id: str, item: ThreadItem, context: ReportAgentContext
    ) -> None:
        existing = await self.db.get(WorkspaceChatEntry, item.id)
        attachments = getattr(item, "attachments", None)
        if isinstance(attachments, list) and attachments:
            canonical_item = item.model_copy(
                update={
                    "attachments": [
                        normalize_attachment_for_storage(attachment)
                        for attachment in attachments
                    ]
                }
            )
        else:
            canonical_item = item
        payload = canonical_item.model_dump(mode="json")
        if existing is None:
            self.db.add(
                WorkspaceChatEntry(
                    id=canonical_item.id,
                    chat_id=thread_id,
                    kind=canonical_item.type,
                    payload=payload,
                    sequence=await self._next_sequence(WorkspaceChatEntry.sequence),
                )
            )
        else:
            existing.chat_id = thread_id
            existing.kind = canonical_item.type
            existing.payload = payload
        await self._touch_chat(thread_id)
        await self.db.commit()

    async def save_item(
        self, thread_id: str, item: ThreadItem, context: ReportAgentContext
    ) -> None:
        await self.add_thread_item(thread_id, item, context)

    async def load_item(
        self, thread_id: str, item_id: str, context: ReportAgentContext
    ) -> ThreadItem:
        item = await self.db.get(WorkspaceChatEntry, item_id)
        if item is None or item.chat_id != thread_id:
            raise NotFoundError(f"Thread item {item_id} was not found")
        return await self._to_thread_item(item)

    async def delete_thread(self, thread_id: str, context: ReportAgentContext) -> None:
        chat = await self.db.get(WorkspaceChat, thread_id)
        if chat is None:
            return
        await self.db.delete(chat)
        await self.db.commit()

    async def delete_thread_item(
        self, thread_id: str, item_id: str, context: ReportAgentContext
    ) -> None:
        item = await self.db.get(WorkspaceChatEntry, item_id)
        if item is None or item.chat_id != thread_id:
            return
        await self.db.delete(item)
        await self._touch_chat(thread_id)
        await self.db.commit()

    async def _get_chat(self, thread_id: str) -> WorkspaceChat:
        result = await self.db.execute(
            select(WorkspaceChat).where(WorkspaceChat.id == thread_id)
        )
        chat = result.scalar_one_or_none()
        if chat is None:
            raise NotFoundError(f"Thread {thread_id} was not found")
        return chat

    async def _touch_chat(self, thread_id: str) -> None:
        chat = await self.db.get(WorkspaceChat, thread_id)
        if chat is not None:
            chat.updated_sequence = await self._next_sequence(
                WorkspaceChat.updated_sequence
            )
            chat.updated_at = datetime.now(UTC)

    async def _apply_thread_cursor(self, query, after: str | None, order: str):
        if after is None:
            return query
        cursor = await self.db.get(WorkspaceChat, after)
        if cursor is None:
            return query
        if order == "desc":
            return query.where(WorkspaceChat.updated_sequence < cursor.updated_sequence)
        return query.where(WorkspaceChat.updated_sequence > cursor.updated_sequence)

    async def _apply_item_cursor(self, query, after: str | None, order: str):
        if after is None:
            return query
        cursor = await self.db.get(WorkspaceChatEntry, after)
        if cursor is None:
            return query
        if order == "desc":
            return query.where(WorkspaceChatEntry.sequence < cursor.sequence)
        return query.where(WorkspaceChatEntry.sequence > cursor.sequence)

    async def _next_sequence(self, column) -> int:
        result = await self.db.execute(select(func.max(column)))
        current = result.scalar_one()
        return int(current or 0) + 1

    async def _require_workspace(self, context: ReportAgentContext) -> Workspace:
        workspace_id = context.workspace_id
        if not isinstance(workspace_id, str) or not workspace_id.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="workspace_id is required for attachment uploads.",
            )
        workspace = await self.db.get(Workspace, workspace_id.strip())
        if workspace is None or workspace.user_id != context.user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workspace not found.",
            )
        return workspace

    def _validate_pending_attachment_input(
        self,
        *,
        workspace: Workspace,
        file_name: str,
        mime_type: str,
        byte_size: int,
    ) -> None:
        if workspace.app_id == "agriculture":
            if (
                _kind_for_attachment_input(file_name=file_name, mime_type=mime_type)
                != "image"
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Agriculture chat attachments must be image files.",
                )
            if byte_size > self.settings.agriculture_chat_attachment_max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    detail="Agriculture chat attachments must be 10 MB or smaller.",
                )

        if byte_size > self.settings.chat_attachment_max_model_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="The selected file is too large for this upload path.",
            )

    def _build_upload_token(
        self,
        *,
        attachment_id: str,
        user_id: str,
    ) -> str:
        expires_ts = int(
            (
                datetime.now(UTC)
                + timedelta(seconds=UPLOAD_TOKEN_TTL_SECONDS)
            ).timestamp()
        )
        payload = f"{attachment_id}:{user_id}:{expires_ts}"
        signature = hmac.new(
            self._upload_secret(),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        encoded = urlsafe_b64encode(f"{expires_ts}:{signature}".encode("utf-8"))
        return encoded.decode("utf-8").rstrip("=")

    def _assert_upload_token(
        self,
        *,
        attachment_id: str,
        user_id: str,
        token: str,
    ) -> None:
        padded_token = token + "=" * (-len(token) % 4)
        try:
            decoded = urlsafe_b64decode(padded_token.encode("utf-8")).decode("utf-8")
            expires_raw, signature = decoded.split(":", 1)
            expires_ts = int(expires_raw)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment upload not found.",
            ) from exc

        if expires_ts <= int(datetime.now(UTC).timestamp()):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment upload has expired.",
            )

        payload = f"{attachment_id}:{user_id}:{expires_ts}"
        expected_signature = hmac.new(
            self._upload_secret(),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_signature):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment upload not found.",
            )

    def _upload_secret(self) -> bytes:
        secret = (
            self.settings.CLERK_SECRET_KEY
            or self.settings.CLERK_JWT_KEY
            or self.settings.OPENAI_API_KEY
            or "ai-portfolio-chatkit-attachment-secret"
        )
        return secret.encode("utf-8")

    def _to_thread_metadata(self, chat: WorkspaceChat) -> ThreadMetadata:
        return ThreadMetadata(
            id=chat.id,
            title=chat.title,
            created_at=chat.created_at,
            status=TypeAdapter(ThreadStatus).validate_python(chat.status_json),
            allowed_image_domains=chat.allowed_image_domains_json,
            metadata=cast(dict, chat.metadata_json),
        )

    async def _to_thread_item(self, item: WorkspaceChatEntry) -> ThreadItem:
        parsed_item = THREAD_ITEM_ADAPTER.validate_python(item.payload)
        attachments = getattr(parsed_item, "attachments", None)
        if not isinstance(attachments, list) or not attachments:
            return parsed_item

        hydrated_attachments: list[Attachment] = []
        for attachment in attachments:
            hydrated_attachments.append(
                await self._hydrate_attachment_for_display(attachment)
            )
        return parsed_item.model_copy(update={"attachments": hydrated_attachments})

    async def _hydrate_attachment_for_display(
        self,
        attachment: Attachment,
    ) -> Attachment:
        metadata = attachment.metadata if isinstance(attachment.metadata, dict) else {}
        if metadata.get("input_kind") != "image" or attachment.upload_descriptor is not None:
            return attachment

        stored_file_id = metadata.get("stored_file_id")
        if not isinstance(stored_file_id, str) or not stored_file_id.strip():
            return attachment

        record = await self.db.get(StoredOpenAIFile, stored_file_id.strip())
        if (
            record is None
            or record.status == "deleted"
            or record.kind != "image"
            or not isinstance(record.openai_file_id, str)
            or not record.openai_file_id.strip()
        ):
            return attachment

        expires_at = record.expires_at
        if expires_at is not None and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at is not None and expires_at <= datetime.now(UTC):
            return attachment

        try:
            binary_response = await self.openai_client.files.content(record.openai_file_id)
            file_bytes = await binary_response.aread()
        except Exception:
            log_event(
                logger,
                logging.WARNING,
                "attachment.preview_hydrate_failed",
                summary=summarize_pairs_for_log(
                    (("attachment", attachment.id), ("stored_file", record.id))
                ),
            )
            return attachment

        return build_display_attachment(
            canonical_attachment=attachment,
            file_bytes=file_bytes,
        )


def _kind_for_attachment_input(
    *,
    file_name: str,
    mime_type: str | None,
) -> str:
    extension = PurePosixPath(file_name).suffix.lower()
    if extension in {".png", ".jpg", ".jpeg", ".webp"}:
        return "image"
    if isinstance(mime_type, str) and mime_type.startswith("image/"):
        return "image"
    return "other"
