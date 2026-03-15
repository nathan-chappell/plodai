from __future__ import annotations

from datetime import UTC, datetime
from typing import cast

from pydantic import TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from chatkit.store import NotFoundError, Store
from chatkit.types import Attachment, Page, ThreadItem, ThreadMetadata, ThreadStatus

from backend.app.agents.context import ReportAgentContext
from backend.app.models.chatkit import ChatAttachment, ChatItem, ChatThread


THREAD_ITEM_ADAPTER = TypeAdapter(ThreadItem)
ATTACHMENT_ADAPTER = TypeAdapter(Attachment)


class DatabaseMemoryStore(Store[ReportAgentContext]):
    def __init__(self, db: AsyncSession):
        self.db = db

    async def load_thread(
        self, thread_id: str, context: ReportAgentContext
    ) -> ThreadMetadata:
        thread = await self._get_thread(thread_id)
        return self._to_thread_metadata(thread)

    async def save_thread(
        self, thread: ThreadMetadata, context: ReportAgentContext
    ) -> None:
        existing = await self.db.get(ChatThread, thread.id)
        next_sequence = await self._next_sequence(ChatThread.updated_sequence)
        if existing is None:
            self.db.add(
                ChatThread(
                    id=thread.id,
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
        await self.db.commit()

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: ReportAgentContext,
    ) -> Page[ThreadItem]:
        await self._get_thread(thread_id)
        query = select(ChatItem).where(ChatItem.thread_id == thread_id)
        query = await self._apply_item_cursor(query, after, order)
        query = query.order_by(
            ChatItem.sequence.desc() if order == "desc" else ChatItem.sequence.asc()
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
        existing = await self.db.get(ChatAttachment, attachment.id)
        if existing is None:
            self.db.add(
                ChatAttachment(
                    id=attachment.id,
                    kind=attachment.type,
                    payload=payload,
                )
            )
        else:
            existing.kind = attachment.type
            existing.payload = payload
        await self.db.commit()

    async def load_attachment(
        self, attachment_id: str, context: ReportAgentContext
    ) -> Attachment:
        attachment = await self.db.get(ChatAttachment, attachment_id)
        if attachment is None:
            raise NotFoundError(f"Attachment {attachment_id} was not found")
        return ATTACHMENT_ADAPTER.validate_python(attachment.payload)

    async def delete_attachment(
        self, attachment_id: str, context: ReportAgentContext
    ) -> None:
        attachment = await self.db.get(ChatAttachment, attachment_id)
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
        query = select(ChatThread).where(ChatThread.user_id == context.user_id)
        query = await self._apply_thread_cursor(query, after, order)
        query = query.order_by(
            ChatThread.updated_sequence.desc()
            if order == "desc"
            else ChatThread.updated_sequence.asc()
        )
        query = query.limit(limit + 1)
        result = await self.db.execute(query)
        records = list(result.scalars().all())

        has_more = len(records) > limit
        page_records = records[:limit]
        next_after = page_records[-1].id if has_more and page_records else None
        return Page[ThreadMetadata](
            data=[self._to_thread_metadata(thread) for thread in page_records],
            has_more=has_more,
            after=next_after,
        )

    async def add_thread_item(
        self, thread_id: str, item: ThreadItem, context: ReportAgentContext
    ) -> None:
        existing = await self.db.get(ChatItem, item.id)
        payload = item.model_dump(mode="json")
        if existing is None:
            self.db.add(
                ChatItem(
                    id=item.id,
                    thread_id=thread_id,
                    kind=item.type,
                    payload=payload,
                    sequence=await self._next_sequence(ChatItem.sequence),
                )
            )
        else:
            existing.thread_id = thread_id
            existing.kind = item.type
            existing.payload = payload
        await self._touch_thread(thread_id)
        await self.db.commit()

    async def save_item(
        self, thread_id: str, item: ThreadItem, context: ReportAgentContext
    ) -> None:
        await self.add_thread_item(thread_id, item, context)

    async def load_item(
        self, thread_id: str, item_id: str, context: ReportAgentContext
    ) -> ThreadItem:
        item = await self.db.get(ChatItem, item_id)
        if item is None or item.thread_id != thread_id:
            raise NotFoundError(f"Thread item {item_id} was not found")
        return self._to_thread_item(item)

    async def delete_thread(self, thread_id: str, context: ReportAgentContext) -> None:
        thread = await self.db.get(ChatThread, thread_id)
        if thread is None:
            return
        await self.db.delete(thread)
        await self.db.commit()

    async def delete_thread_item(
        self, thread_id: str, item_id: str, context: ReportAgentContext
    ) -> None:
        item = await self.db.get(ChatItem, item_id)
        if item is None or item.thread_id != thread_id:
            return
        await self.db.delete(item)
        await self._touch_thread(thread_id)
        await self.db.commit()

    async def _get_thread(self, thread_id: str) -> ChatThread:
        result = await self.db.execute(
            select(ChatThread).where(ChatThread.id == thread_id)
        )
        thread = result.scalar_one_or_none()
        if thread is None:
            raise NotFoundError(f"Thread {thread_id} was not found")
        return thread

    async def _touch_thread(self, thread_id: str) -> None:
        thread = await self.db.get(ChatThread, thread_id)
        if thread is not None:
            thread.updated_sequence = await self._next_sequence(
                ChatThread.updated_sequence
            )
            thread.updated_at = datetime.now(UTC)

    async def _apply_thread_cursor(self, query, after: str | None, order: str):
        if after is None:
            return query
        cursor = await self.db.get(ChatThread, after)
        if cursor is None:
            return query
        if order == "desc":
            return query.where(ChatThread.updated_sequence < cursor.updated_sequence)
        return query.where(ChatThread.updated_sequence > cursor.updated_sequence)

    async def _apply_item_cursor(self, query, after: str | None, order: str):
        if after is None:
            return query
        cursor = await self.db.get(ChatItem, after)
        if cursor is None:
            return query
        if order == "desc":
            return query.where(ChatItem.sequence < cursor.sequence)
        return query.where(ChatItem.sequence > cursor.sequence)

    async def _next_sequence(self, column) -> int:
        result = await self.db.execute(select(func.max(column)))
        current = result.scalar_one()
        return int(current or 0) + 1

    def _to_thread_metadata(self, thread: ChatThread) -> ThreadMetadata:
        return ThreadMetadata(
            id=thread.id,
            title=thread.title,
            created_at=thread.created_at,
            status=TypeAdapter(ThreadStatus).validate_python(thread.status_json),
            allowed_image_domains=thread.allowed_image_domains_json,
            metadata=cast(dict, thread.metadata_json),
        )

    def _to_thread_item(self, item: ChatItem) -> ThreadItem:
        return THREAD_ITEM_ADAPTER.validate_python(item.payload)
