from __future__ import annotations

from datetime import UTC, datetime
from typing import cast

from pydantic import TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from chatkit.store import NotFoundError, Store
from chatkit.types import Attachment, Page, ThreadItem, ThreadMetadata, ThreadStatus

from backend.app.agents.context import ReportAgentContext
from backend.app.models.chatkit import (
    WorkspaceChat,
    WorkspaceWorkspaceChatAttachment,
    WorkspaceChatEntry,
)
from backend.app.models.stored_file import StoredOpenAIFile


THREAD_ITEM_ADAPTER = TypeAdapter(ThreadItem)
ATTACHMENT_ADAPTER = TypeAdapter(Attachment)


class DatabaseMemoryStore(Store[ReportAgentContext]):
    def __init__(self, db: AsyncSession):
        self.db = db

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
        return Page[ThreadItem](
            data=[self._to_thread_item(item) for item in page_records],
            has_more=has_more,
            after=next_after,
        )

    async def save_attachment(
        self, attachment: Attachment, context: ReportAgentContext
    ) -> None:
        payload = attachment.model_dump(mode="json")
        existing = await self.db.get(WorkspaceWorkspaceChatAttachment, attachment.id)
        if existing is None:
            self.db.add(
                WorkspaceWorkspaceChatAttachment(
                    id=attachment.id,
                    kind=attachment.type,
                    payload=payload,
                )
            )
        else:
            existing.kind = attachment.type
            existing.payload = payload
        metadata = attachment.metadata if isinstance(attachment.metadata, dict) else None
        stored_file_id = (
            metadata.get("stored_file_id")
            if metadata is not None
            else None
        )
        if isinstance(stored_file_id, str) and stored_file_id.strip():
            stored_file = await self.db.get(StoredOpenAIFile, stored_file_id.strip())
            if stored_file is not None:
                stored_file.attachment_id = attachment.id
                if isinstance(attachment.thread_id, str) and attachment.thread_id.strip():
                    stored_file.thread_id = attachment.thread_id.strip()
        await self.db.commit()

    async def load_attachment(
        self, attachment_id: str, context: ReportAgentContext
    ) -> Attachment:
        attachment = await self.db.get(WorkspaceWorkspaceChatAttachment, attachment_id)
        if attachment is None:
            raise NotFoundError(f"Attachment {attachment_id} was not found")
        return ATTACHMENT_ADAPTER.validate_python(attachment.payload)

    async def delete_attachment(
        self, attachment_id: str, context: ReportAgentContext
    ) -> None:
        attachment = await self.db.get(WorkspaceWorkspaceChatAttachment, attachment_id)
        if attachment is not None:
            await self.db.delete(attachment)
            await self.db.commit()

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
        payload = item.model_dump(mode="json")
        if existing is None:
            self.db.add(
                WorkspaceChatEntry(
                    id=item.id,
                    chat_id=thread_id,
                    kind=item.type,
                    payload=payload,
                    sequence=await self._next_sequence(WorkspaceChatEntry.sequence),
                )
            )
        else:
            existing.chat_id = thread_id
            existing.kind = item.type
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
        return self._to_thread_item(item)

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

    def _to_thread_metadata(self, chat: WorkspaceChat) -> ThreadMetadata:
        return ThreadMetadata(
            id=chat.id,
            title=chat.title,
            created_at=chat.created_at,
            status=TypeAdapter(ThreadStatus).validate_python(chat.status_json),
            allowed_image_domains=chat.allowed_image_domains_json,
            metadata=cast(dict, chat.metadata_json),
        )

    def _to_thread_item(self, item: WorkspaceChatEntry) -> ThreadItem:
        return THREAD_ITEM_ADAPTER.validate_python(item.payload)
