from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import get_settings
from backend.app.models.farm import (
    Farm,
    FarmChat,
    FarmChatAttachment,
    FarmChatEntry,
    FarmImage,
    FarmRecord,
)
from backend.app.schemas.farm import (
    FarmCreateRequest,
    FarmDetail,
    FarmRecordPayload,
    FarmSummary,
    FarmUpdateRequest,
)
from backend.app.services.bucket_storage import RailwayBucketService


class FarmService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_farms(
        self,
        *,
        user_id: str,
    ) -> list[FarmSummary]:
        result = await self.db.execute(
            select(Farm)
            .where(Farm.user_id == user_id)
            .order_by(Farm.updated_at.desc(), Farm.created_at.desc())
        )
        farms = list(result.scalars().all())
        if not farms:
            farms = [await self._create_farm_row(user_id=user_id, name="")]
        return [await self._serialize_farm_summary(farm) for farm in farms]

    async def create_farm(
        self,
        *,
        user_id: str,
        request: FarmCreateRequest,
    ) -> FarmDetail:
        farm = await self._create_farm_row(user_id=user_id, name=request.name)
        return await self.get_farm(user_id=user_id, farm_id=farm.id)

    async def get_farm(
        self,
        *,
        user_id: str,
        farm_id: str,
    ) -> FarmDetail:
        farm = await self.require_farm(user_id=user_id, farm_id=farm_id)
        record = await self._get_record_row(farm_id)
        summary = await self._serialize_farm_summary(farm)
        record_payload = FarmRecordPayload.model_validate(record.payload_json)
        return FarmDetail(
            **summary.model_dump(),
            location=record_payload.location,
            description=record_payload.description,
        )

    async def update_farm(
        self,
        *,
        user_id: str,
        farm_id: str,
        request: FarmUpdateRequest,
    ) -> FarmDetail:
        farm = await self.require_farm(user_id=user_id, farm_id=farm_id)
        record = await self._get_record_row(farm_id)
        payload = FarmRecordPayload.model_validate(record.payload_json)
        if "name" in request.model_fields_set and request.name is not None:
            cleaned_name = request.name.strip()
            if not cleaned_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Farm name cannot be blank.",
                )
            farm.name = cleaned_name
            record.payload_json = payload.model_copy(
                update={"farm_name": cleaned_name}
            ).model_dump(mode="json")
        await self.db.commit()
        return await self.get_farm(user_id=user_id, farm_id=farm_id)

    async def get_record(
        self,
        *,
        user_id: str,
        farm_id: str,
    ) -> FarmRecordPayload:
        await self.require_farm(user_id=user_id, farm_id=farm_id)
        record = await self._get_record_row(farm_id)
        return FarmRecordPayload.model_validate(record.payload_json)

    async def save_record(
        self,
        *,
        user_id: str,
        farm_id: str,
        record: FarmRecordPayload,
    ) -> FarmRecordPayload:
        farm = await self.require_farm(user_id=user_id, farm_id=farm_id)
        record_row = await self._get_record_row(farm_id)
        cleaned_farm_name = record.farm_name.strip()
        if not cleaned_farm_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Farm name cannot be blank.",
            )
        farm.name = cleaned_farm_name
        record_row.payload_json = record.model_dump(mode="json")
        farm.updated_at = datetime.now(UTC)
        record_row.updated_at = datetime.now(UTC)
        await self.db.commit()
        return record

    async def delete_farm(
        self,
        *,
        user_id: str,
        farm_id: str,
    ) -> None:
        farm = await self.require_farm(user_id=user_id, farm_id=farm_id)
        record = await self._get_record_row(farm_id)
        bucket_service = RailwayBucketService(get_settings())

        image_result = await self.db.execute(
            select(FarmImage).where(FarmImage.farm_id == farm_id)
        )
        images = list(image_result.scalars().all())
        chat_result = await self.db.execute(
            select(FarmChat).where(FarmChat.farm_id == farm_id)
        )
        chats = list(chat_result.scalars().all())
        chat_ids = {chat.id for chat in chats}
        image_attachment_ids = {
            image.attachment_id.strip()
            for image in images
            if image.attachment_id and image.attachment_id.strip()
        }
        storage_keys = {
            image.storage_key.strip()
            for image in images
            if image.storage_key and image.storage_key.strip()
        }

        attachment_result = await self.db.execute(select(FarmChatAttachment))
        attachments_to_delete: list[FarmChatAttachment] = []
        for attachment in attachment_result.scalars().all():
            payload = attachment.payload if isinstance(attachment.payload, dict) else {}
            metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
            thread_id = payload.get("thread_id")
            matches_farm = (
                metadata.get("farm_id") == farm_id
                or attachment.id in image_attachment_ids
                or (isinstance(thread_id, str) and thread_id in chat_ids)
            )
            if not matches_farm:
                continue
            attachments_to_delete.append(attachment)
            storage_key = metadata.get("storage_key")
            if isinstance(storage_key, str) and storage_key.strip():
                storage_keys.add(storage_key.strip())

        for storage_key in storage_keys:
            try:
                await bucket_service.delete_object(key=storage_key)
            except Exception:
                pass

        for attachment in attachments_to_delete:
            await self.db.delete(attachment)

        if chat_ids:
            await self.db.execute(
                delete(FarmChatEntry).where(FarmChatEntry.chat_id.in_(chat_ids))
            )

        for image in images:
            await self.db.delete(image)

        for chat in chats:
            await self.db.delete(chat)

        await self.db.delete(record)
        await self.db.delete(farm)
        await self.db.commit()

    async def require_farm(
        self,
        *,
        user_id: str,
        farm_id: str,
    ) -> Farm:
        farm = await self.db.get(Farm, farm_id)
        if farm is None or farm.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Farm not found.",
            )
        return farm

    async def get_chat_id(
        self,
        *,
        user_id: str,
        farm_id: str,
    ) -> str | None:
        await self.require_farm(user_id=user_id, farm_id=farm_id)
        result = await self.db.execute(
            select(FarmChat.id).where(FarmChat.farm_id == farm_id)
        )
        return result.scalar_one_or_none()

    async def _get_record_row(self, farm_id: str) -> FarmRecord:
        record = await self.db.get(FarmRecord, farm_id)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Farm record not found.",
            )
        return record

    async def _create_farm_row(
        self,
        *,
        user_id: str,
        name: str,
    ) -> Farm:
        cleaned_name = name.strip()
        farm = Farm(
            id=f"farm_{uuid4().hex}",
            user_id=user_id,
            name=cleaned_name,
        )
        self.db.add(farm)
        self.db.add(
            FarmRecord(
                farm_id=farm.id,
                payload_json=FarmRecordPayload(
                    version="v1",
                    farm_name=cleaned_name,
                    description=None,
                    location=None,
                    crops=[],
                    orders=[],
                ).model_dump(mode="json"),
            )
        )
        await self.db.commit()
        return farm

    async def _serialize_farm_summary(self, farm: Farm) -> FarmSummary:
        record = await self._get_record_row(farm.id)
        record_payload = FarmRecordPayload.model_validate(record.payload_json)
        chat_result = await self.db.execute(
            select(FarmChat.id).where(FarmChat.farm_id == farm.id)
        )
        image_count_result = await self.db.execute(
            select(func.count(FarmImage.id)).where(
                FarmImage.farm_id == farm.id,
                FarmImage.status != "deleted",
            )
        )
        return FarmSummary(
            id=farm.id,
            name=record_payload.farm_name or farm.name,
            chat_id=chat_result.scalar_one_or_none(),
            image_count=int(image_count_result.scalar_one() or 0),
            created_at=self._iso(farm.created_at),
            updated_at=self._iso(farm.updated_at),
        )

    def _iso(self, value: datetime) -> str:
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
