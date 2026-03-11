from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.chatkit import ChatItem, ChatThread


class DatabaseMemoryStore:
    def __init__(self, db: AsyncSession):
        self.db = db

    def generate_thread_id(self) -> str:
        return str(uuid4())

    def generate_item_id(self) -> str:
        return str(uuid4())

    async def list_threads(self, user_id: str | None = None) -> list[dict]:
        query = select(ChatThread).options(selectinload(ChatThread.items)).order_by(ChatThread.updated_at.desc())
        if user_id:
            query = query.where(ChatThread.user_id == user_id)
        result = await self.db.execute(query)
        threads = result.scalars().all()
        return [self._serialize_thread(thread) for thread in threads]

    async def get_thread(self, thread_id: str) -> dict | None:
        result = await self.db.execute(
            select(ChatThread).options(selectinload(ChatThread.items)).where(ChatThread.id == thread_id)
        )
        thread = result.scalar_one_or_none()
        return self._serialize_thread(thread) if thread else None

    async def get_or_create_thread(
        self,
        user_id: str,
        thread_id: str | None = None,
        title: str = "New report",
        metadata: dict | None = None,
    ) -> dict:
        if thread_id:
            existing = await self.get_thread(thread_id)
            if existing is not None:
                if metadata:
                    existing["metadata"] = {**existing.get("metadata", {}), **metadata}
                    return await self.save_thread(existing)
                return existing
        return await self.create_thread(user_id=user_id, title=title, metadata=metadata)

    async def create_thread(self, user_id: str, title: str = "New report", metadata: dict | None = None) -> dict:
        thread = ChatThread(
            id=self.generate_thread_id(),
            user_id=user_id,
            title=title,
            metadata_json=metadata or {},
        )
        self.db.add(thread)
        await self.db.commit()
        await self.db.refresh(thread)
        return self._serialize_thread(thread)

    async def save_thread(self, thread: dict) -> dict:
        result = await self.db.execute(select(ChatThread).where(ChatThread.id == thread["id"]))
        current = result.scalar_one()
        current.title = thread.get("title", current.title)
        current.metadata_json = thread.get("metadata", current.metadata_json)
        current.updated_at = datetime.now(UTC)
        await self.db.commit()
        await self.db.refresh(current)
        return self._serialize_thread(current)

    async def append_item(self, thread_id: str, role: str, item_type: str, payload: dict) -> dict:
        item = ChatItem(
            id=self.generate_item_id(),
            thread_id=thread_id,
            role=role,
            kind=item_type,
            payload=payload,
        )
        self.db.add(item)
        result = await self.db.execute(select(ChatThread).where(ChatThread.id == thread_id))
        thread = result.scalar_one()
        thread.updated_at = datetime.now(UTC)
        await self.db.commit()
        await self.db.refresh(item)
        return self._serialize_item(item)

    async def replace_items(self, thread_id: str, items: list[dict]) -> dict:
        result = await self.db.execute(
            select(ChatThread).options(selectinload(ChatThread.items)).where(ChatThread.id == thread_id)
        )
        thread = result.scalar_one()
        for item in list(thread.items):
            await self.db.delete(item)
        await self.db.flush()
        for raw in items:
            self.db.add(
                ChatItem(
                    id=raw.get("id") or self.generate_item_id(),
                    thread_id=thread_id,
                    role=raw.get("role", "assistant"),
                    kind=raw.get("type", raw.get("kind", "message")),
                    payload=raw.get("payload", {}),
                )
            )
        thread.updated_at = datetime.now(UTC)
        await self.db.commit()
        await self.db.refresh(thread)
        return self._serialize_thread(thread)

    def _serialize_thread(self, thread: ChatThread) -> dict:
        return {
            "id": thread.id,
            "user_id": thread.user_id,
            "title": thread.title,
            "metadata": thread.metadata_json,
            "items": [self._serialize_item(item) for item in sorted(thread.items, key=lambda item: item.created_at)],
            "created_at": thread.created_at.isoformat(),
            "updated_at": thread.updated_at.isoformat(),
        }

    def _serialize_item(self, item: ChatItem) -> dict:
        return {
            "id": item.id,
            "thread_id": item.thread_id,
            "role": item.role,
            "type": item.kind,
            "payload": item.payload,
            "created_at": item.created_at.isoformat(),
        }
