from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.farm import Farm, FarmImage, FarmRecord
from backend.app.schemas.farm import FarmRecordPayload, PublicFarmOrderResponse
from backend.app.services.farm_image_service import FarmImageService
from backend.app.services.farm_service import FarmService


class PublicFarmOrderService:
    def __init__(
        self,
        db: AsyncSession,
        *,
        image_service: FarmImageService | None = None,
        farm_service: FarmService | None = None,
    ):
        self.db = db
        self.image_service = image_service or FarmImageService(db)
        self.farm_service = farm_service or FarmService(db)

    async def get_public_order(
        self,
        *,
        farm_id: str,
        public_base_url: str | None = None,
        order_id: str,
    ) -> PublicFarmOrderResponse:
        record_row = await self.db.get(FarmRecord, farm_id)
        farm_row = await self.db.get(Farm, farm_id)
        if farm_row is None or record_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Farm order not found.",
            )
        record = FarmRecordPayload.model_validate(record_row.payload_json)
        order = next((candidate for candidate in record.orders if candidate.id == order_id), None)
        if order is None or order.status == "draft":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Farm order not found.",
            )

        hero_image_preview_url: str | None = None
        if isinstance(order.hero_image_file_id, str) and order.hero_image_file_id.strip():
            image = await self.db.get(FarmImage, order.hero_image_file_id)
            if image is not None and image.status != "deleted":
                hero_image_preview_url = self.image_service.build_public_preview_url(
                    image,
                    public_base_url=public_base_url,
                )

        return PublicFarmOrderResponse(
            farm_id=farm_id,
            farm_name=record.farm_name,
            location=record.location,
            order=order,
            hero_image_preview_url=hero_image_preview_url,
        )
