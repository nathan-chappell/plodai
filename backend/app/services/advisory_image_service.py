from __future__ import annotations

import mimetypes
from datetime import UTC, datetime
from io import BytesIO
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import Settings, get_settings
from backend.app.models.advisory import AdvisoryImage
from backend.app.schemas.advisory import AdvisoryImageSummary
from backend.app.services.bucket_storage import (
    DEFAULT_STORAGE_PROVIDER,
    BucketStorageService,
    RailwayBucketService,
)
from backend.app.services.advisory_service import AdvisoryService
from backend.app.services.upload_rules import validate_advisory_image_upload


class AdvisoryImageService:
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
        self.advisory_service = AdvisoryService(db)

    async def list_images(
        self,
        *,
        user_id: str,
        case_id: str,
        public_base_url: str | None = None,
    ) -> list[AdvisoryImageSummary]:
        await self.advisory_service.require_case(user_id=user_id, case_id=case_id)
        result = await self.db.execute(
            select(AdvisoryImage)
            .where(
                AdvisoryImage.case_id == case_id,
                AdvisoryImage.user_id == user_id,
                AdvisoryImage.status != "deleted",
            )
            .order_by(AdvisoryImage.created_at.desc())
        )
        return [
            self.serialize_image(record, public_base_url=public_base_url)
            for record in result.scalars().all()
        ]

    async def upload_image(
        self,
        *,
        user_id: str,
        case_id: str,
        file_name: str,
        mime_type: str | None,
        file_bytes: bytes,
        source_kind: str = "upload",
        chat_id: str | None = None,
        attachment_id: str | None = None,
        public_base_url: str | None = None,
    ) -> AdvisoryImageSummary:
        await self.advisory_service.require_case(user_id=user_id, case_id=case_id)
        record = await self._store_image(
            user_id=user_id,
            case_id=case_id,
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
        case_id: str,
        chat_id: str | None,
        attachment_id: str,
        file_name: str,
        mime_type: str | None,
        declared_size: int,
        storage_key: str,
    ) -> AdvisoryImage:
        await self.advisory_service.require_case(user_id=user_id, case_id=case_id)
        validate_advisory_image_upload(
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
            case_id=case_id,
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
        case_id: str,
        image_id: str,
    ) -> AdvisoryImage:
        await self.advisory_service.require_case(user_id=user_id, case_id=case_id)
        record = await self.db.get(AdvisoryImage, image_id)
        if (
            record is None
            or record.user_id != user_id
            or record.case_id != case_id
            or record.status == "deleted"
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Advisory image not found.",
            )
        return record

    async def delete_image(
        self,
        *,
        user_id: str,
        case_id: str,
        image_id: str,
    ) -> None:
        record = await self.get_image(user_id=user_id, case_id=case_id, image_id=image_id)
        try:
            await self.bucket_service.delete_object(key=record.storage_key)
        except Exception:
            pass
        record.status = "deleted"
        await self.db.commit()

    async def save_image_observation(
        self,
        *,
        user_id: str,
        case_id: str,
        image_id: str,
        detailed_description: str,
        location_label: str | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        public_base_url: str | None = None,
    ) -> AdvisoryImageSummary:
        record = await self.get_image(user_id=user_id, case_id=case_id, image_id=image_id)
        cleaned_description = detailed_description.strip()
        if not cleaned_description:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Image description must be a non-empty string.",
            )
        if (latitude is None) != (longitude is None):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Latitude and longitude must be saved together.",
            )
        if latitude is not None and not -90 <= latitude <= 90:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Latitude must be between -90 and 90.",
            )
        if longitude is not None and not -180 <= longitude <= 180:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Longitude must be between -180 and 180.",
            )

        record.detailed_description = cleaned_description
        if location_label is not None:
            record.location_label = _clean_optional_text(location_label)
        if latitude is not None and longitude is not None:
            record.latitude = float(latitude)
            record.longitude = float(longitude)
        await self.db.commit()
        await self.db.refresh(record)
        return self.serialize_image(record, public_base_url=public_base_url)

    async def load_image_bytes(self, record: AdvisoryImage) -> bytes:
        return await self.bucket_service.get_object_bytes(key=record.storage_key)

    def serialize_image(
        self,
        record: AdvisoryImage,
        *,
        public_base_url: str | None = None,
    ) -> AdvisoryImageSummary:
        return AdvisoryImageSummary(
            id=record.id,
            case_id=record.case_id,
            chat_id=record.chat_id,
            attachment_id=record.attachment_id,
            source_kind=record.source_kind,  # type: ignore[arg-type]
            name=record.name,
            mime_type=record.mime_type,
            byte_size=record.byte_size,
            width=record.width,
            height=record.height,
            detailed_description=record.detailed_description,
            location_label=record.location_label,
            latitude=record.latitude,
            longitude=record.longitude,
            preview_url=self.build_public_preview_url(
                record,
                public_base_url=public_base_url,
            ),
            created_at=self._iso(record.created_at),
            updated_at=self._iso(record.updated_at),
        )

    def build_public_preview_url(
        self,
        record: AdvisoryImage,
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
        case_id: str,
        file_name: str,
        mime_type: str | None,
        file_bytes: bytes,
        source_kind: str,
        chat_id: str | None,
        attachment_id: str | None,
        storage_key: str | None,
    ) -> AdvisoryImage:
        resolved_mime_type = mime_type or mimetypes.guess_type(file_name)[0]
        validate_advisory_image_upload(
            settings=self.settings,
            file_name=file_name,
            mime_type=resolved_mime_type,
            byte_size=len(file_bytes),
        )
        with ImageProbe(file_bytes) as probe:
            width, height = probe.size
        resolved_storage_key = storage_key or self.bucket_service.build_object_key(
            scope="advisory_image",
            attachment_id=attachment_id,
        )
        if storage_key is None:
            await self.bucket_service.put_object_bytes(
                key=resolved_storage_key,
                file_bytes=file_bytes,
                mime_type=resolved_mime_type,
            )
        gps_location = extract_image_gps_location(file_bytes)
        record = AdvisoryImage(
            id=f"image_{uuid4().hex}",
            case_id=case_id,
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
            latitude=gps_location[0] if gps_location is not None else None,
            longitude=gps_location[1] if gps_location is not None else None,
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


def extract_image_gps_location(file_bytes: bytes) -> tuple[float, float] | None:
    try:
        from PIL import ExifTags, Image

        with Image.open(BytesIO(file_bytes)) as image:
            exif = image.getexif()
            if not exif:
                return None
            gps_tag = next(
                tag for tag, name in ExifTags.TAGS.items() if name == "GPSInfo"
            )
            raw_gps = exif.get_ifd(gps_tag)
    except Exception:
        return None

    if not raw_gps:
        return None
    gps = {
        ExifTags.GPSTAGS.get(key, key): value
        for key, value in raw_gps.items()
    }
    latitude = _gps_coordinate(gps.get("GPSLatitude"), gps.get("GPSLatitudeRef"))
    longitude = _gps_coordinate(gps.get("GPSLongitude"), gps.get("GPSLongitudeRef"))
    if latitude is None or longitude is None:
        return None
    return latitude, longitude


def _gps_coordinate(value: object, reference: object) -> float | None:
    if not isinstance(value, (tuple, list)) or len(value) != 3:
        return None
    decimal = (
        _rational_float(value[0])
        + (_rational_float(value[1]) / 60)
        + (_rational_float(value[2]) / 3600)
    )
    ref = str(reference or "").upper()
    if ref in {"S", "W"}:
        decimal *= -1
    return decimal


def _rational_float(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        numerator = getattr(value, "numerator", None)
        denominator = getattr(value, "denominator", None)
        if isinstance(numerator, int) and isinstance(denominator, int) and denominator:
            return numerator / denominator
    return 0.0


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None
