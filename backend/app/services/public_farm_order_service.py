from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.models.stored_file import StoredOpenAIFile
from backend.app.models.workspace import Workspace, WorkspaceItem
from backend.app.schemas.workspace import FarmItemPayload, PublicFarmOrderResponse
from backend.app.services.stored_file_service import StoredFileService


class PublicFarmOrderService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.file_service = StoredFileService(db)

    async def get_public_order(
        self,
        *,
        workspace_id: str,
        order_id: str,
        public_base_url: str | None = None,
    ) -> PublicFarmOrderResponse:
        workspace = await self.db.get(Workspace, workspace_id)
        if workspace is None or workspace.app_id != "agriculture":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Farm order not found.",
            )

        result = await self.db.execute(
            select(WorkspaceItem)
            .options(selectinload(WorkspaceItem.revisions))
            .where(
                WorkspaceItem.workspace_id == workspace_id,
                WorkspaceItem.item_origin == "created",
                WorkspaceItem.kind == "farm.v1",
            )
            .order_by(WorkspaceItem.updated_at.desc())
            .limit(1)
        )
        farm_item = result.scalar_one_or_none()
        if farm_item is None or not farm_item.revisions:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Farm order not found.",
            )

        farm_payload = FarmItemPayload.model_validate(farm_item.revisions[-1].payload_json)
        order = next((candidate for candidate in farm_payload.orders if candidate.id == order_id), None)
        if order is None or order.status == "draft":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Farm order not found.",
            )

        hero_image_preview_url: str | None = None
        if isinstance(order.hero_image_file_id, str) and order.hero_image_file_id.strip():
            record = await self.db.get(StoredOpenAIFile, order.hero_image_file_id)
            if record is not None and record.status != "deleted" and record.kind == "image":
                hero_image_preview_url = self.file_service.build_public_preview_url(
                    record,
                    public_base_url=public_base_url,
                )

        return PublicFarmOrderResponse(
            workspace_id=workspace_id,
            farm_name=farm_payload.farm_name,
            location=farm_payload.location,
            order=order,
            hero_image_preview_url=hero_image_preview_url,
        )
