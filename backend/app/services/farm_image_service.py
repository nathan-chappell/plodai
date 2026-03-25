from __future__ import annotations

import mimetypes
from datetime import UTC, datetime
from io import BytesIO
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import Settings, get_settings
from backend.app.models.farm import FarmImage
from backend.app.schemas.farm import FarmImageSummary
from backend.app.services.bucket_storage import (
    DEFAULT_STORAGE_PROVIDER,
    BucketStorageService,
    RailwayBucketService,
)
from backend.app.services.farm_service import FarmService
from backend.app.services.upload_rules import validate_farm_image_upload


class FarmImageService:
    def __init__(
        self,
        db: AsyncSession,
        *,
        settings: Settings | None = None,
        bucket_service: BucketStorageService | None = None,
    ):
        self.db = db
        self.settings = settings or get_settings()
        self.bucket_service = bucket_service or RailwayBucketService(self.settings)
        self.farm_service = FarmService(db)

    async def list_images(
        self,
        *,
        user_id: str,
        farm_id: str,
        public_base_url: str | None = None,
    ) -> list[FarmImageSummary]:
        await self.farm_service.require_farm(user_id=user_id, farm_id=farm_id)
        result = await self.db.execute(
            select(FarmImage)
            .where(
                FarmImage.farm_id == farm_id,
                FarmImage.user_id == user_id,
                FarmImage.status != "deleted",
            )
            .order_by(FarmImage.created_at.desc())
        )
        return [
            self.serialize_image(record, public_base_url=public_base_url)
            for record in result.scalars().all()
        ]

    async def upload_image(
        self,
        *,
        user_id: str,
        farm_id: str,
        file_name: str,
        mime_type: str | None,
        file_bytes: bytes,
        source_kind: str = "upload",
        chat_id: str | None = None,
        attachment_id: str | None = None,
        public_base_url: str | None = None,
    ) -> FarmImageSummary:
        await self.farm_service.require_farm(user_id=user_id, farm_id=farm_id)
        record = await self._store_image(
            user_id=user_id,
            farm_id=farm_id,
            file_name=file_name,
            mime_type=mime_type,
            file_bytes=file_bytes,
            source_kind=source_kind,
            chat_id=chat_id,
            attachment_id=attachment_id,
            storage_key=None,
        )
        return self.serialize_image(record, public_base_url=public_base_url)

    async def finalize_pending_attachment(
        self,
        *,
        user_id: str,
        farm_id: str,
        chat_id: str | None,
        attachment_id: str,
        file_name: str,
        mime_type: str | None,
        declared_size: int,
        storage_key: str,
    ) -> FarmImage:
        await self.farm_service.require_farm(user_id=user_id, farm_id=farm_id)
        validate_farm_image_upload(
            settings=self.settings,
            file_name=file_name,
            mime_type=mime_type,
            byte_size=declared_size,
        )
        metadata = await self.bucket_service.head_object(key=storage_key)
        if metadata.content_length != declared_size:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Attachment upload size did not match the initialized image metadata.",
            )
        file_bytes = await self.bucket_service.get_object_bytes(key=storage_key)
        return await self._store_image(
            user_id=user_id,
            farm_id=farm_id,
            file_name=file_name,
            mime_type=mime_type,
            file_bytes=file_bytes,
            source_kind="chat_attachment",
            chat_id=chat_id,
            attachment_id=attachment_id,
            storage_key=storage_key,
        )

    async def get_image(
        self,
        *,
        user_id: str,
        farm_id: str,
        image_id: str,
    ) -> FarmImage:
        await self.farm_service.require_farm(user_id=user_id, farm_id=farm_id)
        record = await self.db.get(FarmImage, image_id)
        if (
            record is None
            or record.user_id != user_id
            or record.farm_id != farm_id
            or record.status == "deleted"
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Farm image not found.",
            )
        return record

    async def delete_image(
        self,
        *,
        user_id: str,
        farm_id: str,
        image_id: str,
    ) -> None:
        record = await self.get_image(user_id=user_id, farm_id=farm_id, image_id=image_id)
        try:
            await self.bucket_service.delete_object(key=record.storage_key)
        except Exception:
            pass
        record.status = "deleted"
        await self.db.commit()

    async def load_image_bytes(self, record: FarmImage) -> bytes:
        return await self.bucket_service.get_object_bytes(key=record.storage_key)

    def serialize_image(
        self,
        record: FarmImage,
        *,
        public_base_url: str | None = None,
    ) -> FarmImageSummary:
        return FarmImageSummary(
            id=record.id,
            farm_id=record.farm_id,
            chat_id=record.chat_id,
            attachment_id=record.attachment_id,
            source_kind=record.source_kind,  # type: ignore[arg-type]
            name=record.name,
            mime_type=record.mime_type,
            byte_size=record.byte_size,
            width=record.width,
            height=record.height,
            preview_url=self.build_public_preview_url(
                record,
                public_base_url=public_base_url,
            ),
            created_at=self._iso(record.created_at),
            updated_at=self._iso(record.updated_at),
        )

    def build_public_preview_url(
        self,
        record: FarmImage,
        *,
        public_base_url: str | None = None,
    ) -> str:
        del public_base_url
        return self.bucket_service.build_presigned_download_url(
            key=record.storage_key,
            filename=record.name,
            mime_type=record.mime_type,
            inline=True,
        )

    async def _store_image(
        self,
        *,
        user_id: str,
        farm_id: str,
        file_name: str,
        mime_type: str | None,
        file_bytes: bytes,
        source_kind: str,
        chat_id: str | None,
        attachment_id: str | None,
        storage_key: str | None,
    ) -> FarmImage:
        resolved_mime_type = mime_type or mimetypes.guess_type(file_name)[0]
        validate_farm_image_upload(
            settings=self.settings,
            file_name=file_name,
            mime_type=resolved_mime_type,
            byte_size=len(file_bytes),
        )
        with ImageProbe(file_bytes) as probe:
            width, height = probe.size
        resolved_storage_key = storage_key or self.bucket_service.build_object_key(
            scope="farm_image",
            attachment_id=attachment_id,
        )
        if storage_key is None:
            await self.bucket_service.put_object_bytes(
                key=resolved_storage_key,
                file_bytes=file_bytes,
                mime_type=resolved_mime_type,
            )
        record = FarmImage(
            id=f"image_{uuid4().hex}",
            farm_id=farm_id,
            user_id=user_id,
            chat_id=chat_id,
            attachment_id=attachment_id,
            storage_provider=DEFAULT_STORAGE_PROVIDER,
            storage_key=resolved_storage_key,
            source_kind=source_kind,
            name=file_name,
            mime_type=resolved_mime_type,
            byte_size=len(file_bytes),
            width=width,
            height=height,
            status="available",
        )
        self.db.add(record)
        await self.db.commit()
        await self.db.refresh(record)
        return record

    def _iso(self, value: datetime) -> str:
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


class ImageProbe:
    def __init__(self, file_bytes: bytes):
        self.file_bytes = file_bytes
        self._image = None

    def __enter__(self) -> "ImageProbe":
        from PIL import Image

        self._image = Image.open(BytesIO(self.file_bytes))
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._image is not None:
            self._image.close()

    @property
    def size(self) -> tuple[int, int]:
        if self._image is None:
            raise RuntimeError("Image probe is not open.")
        width, height = self._image.size
        return int(width), int(height)
