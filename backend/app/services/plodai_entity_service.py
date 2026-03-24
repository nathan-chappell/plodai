from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from backend.app.models.chatkit import WorkspaceChat
from backend.app.models.stored_file import StoredOpenAIFile
from backend.app.models.workspace import Workspace, WorkspaceItem
from backend.app.schemas.plodai_entities import (
    PlodaiComposerEntity,
    PlodaiEntitySearchResponse,
)
from backend.app.schemas.workspace import FarmItemPayload
from backend.app.services.stored_file_service import StoredFileService


class PlodaiEntityService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.file_service = StoredFileService(db)

    async def search_entities(
        self,
        *,
        user_id: str,
        workspace_id: str,
        app_id: str,
        thread_id: str,
        query: str,
        public_base_url: str | None = None,
    ) -> PlodaiEntitySearchResponse:
        if app_id != "plodai":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="PlodAI entities are only available for the PlodAI app.",
            )

        workspace = await self.db.get(Workspace, workspace_id)
        if workspace is None or workspace.user_id != user_id or workspace.app_id != "plodai":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workspace not found.",
            )

        chat = await self.db.get(WorkspaceChat, thread_id)
        if chat is None or chat.user_id != user_id or chat.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Thread not found.",
            )

        normalized_query = query.strip().lower()
        entities = [
            *await self._search_thread_images(
                user_id=user_id,
                workspace_id=workspace_id,
                thread_id=thread_id,
                normalized_query=normalized_query,
                public_base_url=public_base_url,
            ),
            *await self._search_farm_entities(
                user_id=user_id,
                workspace_id=workspace_id,
                normalized_query=normalized_query,
            ),
        ]
        return PlodaiEntitySearchResponse(entities=entities[:24])

    async def _search_thread_images(
        self,
        *,
        user_id: str,
        workspace_id: str,
        thread_id: str,
        normalized_query: str,
        public_base_url: str | None,
    ) -> list[PlodaiComposerEntity]:
        result = await self.db.execute(
            select(StoredOpenAIFile)
            .where(
                StoredOpenAIFile.user_id == user_id,
                StoredOpenAIFile.workspace_id == workspace_id,
                StoredOpenAIFile.thread_id == thread_id,
                StoredOpenAIFile.scope == "chat_attachment",
                StoredOpenAIFile.kind == "image",
                StoredOpenAIFile.status != "deleted",
            )
            .order_by(StoredOpenAIFile.created_at.desc())
        )
        records = list(result.scalars().all())
        entities: list[PlodaiComposerEntity] = []
        for record in records:
            width = ""
            height = ""
            if record.preview_json.get("kind") == "image":
                width = str(record.preview_json.get("width") or "")
                height = str(record.preview_json.get("height") or "")
            haystack = " ".join(
                value for value in [record.name, record.mime_type or "", width, height] if value
            ).lower()
            if normalized_query and normalized_query not in haystack:
                continue
            entities.append(
                PlodaiComposerEntity(
                    id=f"thread-image:{record.id}",
                    title=record.name,
                    icon="images",
                    interactive=True,
                    group="Thread images",
                    data={
                        "entity_type": "thread_image",
                        "file_id": record.id,
                        "workspace_item_id": record.id,
                        "thread_id": thread_id,
                        "attachment_id": record.attachment_id or "",
                        "preview_url": self.file_service.build_public_preview_url(
                            record,
                            public_base_url=public_base_url,
                        ),
                        "mime_type": record.mime_type or "",
                        "width": width,
                        "height": height,
                    },
                )
            )
        return entities

    async def _search_farm_entities(
        self,
        *,
        user_id: str,
        workspace_id: str,
        normalized_query: str,
    ) -> list[PlodaiComposerEntity]:
        result = await self.db.execute(
            select(WorkspaceItem)
            .options(selectinload(WorkspaceItem.revisions))
            .where(
                WorkspaceItem.workspace_id == workspace_id,
                WorkspaceItem.created_by_user_id == user_id,
                WorkspaceItem.item_origin == "created",
                WorkspaceItem.kind == "farm.v1",
            )
            .order_by(WorkspaceItem.updated_at.desc())
            .limit(1)
        )
        farm_item = result.scalar_one_or_none()
        if farm_item is None or not farm_item.revisions:
            return []

        farm_payload = FarmItemPayload.model_validate(farm_item.revisions[-1].payload_json)
        entities: list[PlodaiComposerEntity] = []

        for crop in farm_payload.crops:
            if not _matches_query(
                normalized_query,
                crop.name,
                crop.area,
                crop.expected_yield,
                crop.notes,
                farm_payload.farm_name,
            ):
                continue
            entities.append(
                PlodaiComposerEntity(
                    id=f"farm-crop:{farm_item.id}:{crop.id}",
                    title=crop.name,
                    icon="notebook",
                    interactive=True,
                    group="Farm crops",
                    data={
                        "entity_type": "farm_crop",
                        "artifact_id": farm_item.id,
                        "farm_name": farm_payload.farm_name,
                        "item_id": crop.id,
                        "area": crop.area,
                        "expected_yield": crop.expected_yield or "",
                        "notes": crop.notes or "",
                    },
                )
            )

        for order in farm_payload.orders:
            order_item_terms: list[str | None] = []
            for order_item in order.items:
                order_item_terms.extend(
                    [
                        order_item.label,
                        order_item.quantity,
                        order_item.notes,
                    ]
                )
            if not _matches_query(
                normalized_query,
                order.title,
                order.status,
                order.summary,
                order.price_label,
                order.notes,
                order.order_url,
                farm_payload.farm_name,
                *order_item_terms,
            ):
                continue
            entities.append(
                PlodaiComposerEntity(
                    id=f"farm-order:{farm_item.id}:{order.id}",
                    title=order.title,
                    icon="cart",
                    interactive=True,
                    group="Farm orders",
                    data={
                        "entity_type": "farm_order",
                        "artifact_id": farm_item.id,
                        "farm_name": farm_payload.farm_name,
                        "item_id": order.id,
                        "status": order.status,
                        "price_label": order.price_label or "",
                        "summary": order.summary or "",
                        "notes": order.notes or "",
                        "order_url": order.order_url or "",
                    },
                )
            )

        return entities


def _matches_query(normalized_query: str, *values: str | None) -> bool:
    if not normalized_query:
        return True
    haystack = " ".join(value for value in values if value).lower()
    return normalized_query in haystack
