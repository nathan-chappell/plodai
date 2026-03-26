import asyncio
import base64

import pytest
from chatkit.types import AttachmentCreateParams
from fastapi import HTTPException
from sqlalchemy import select

from backend.app.agents.context import FarmAgentContext
from backend.app.chatkit.memory_store import FarmMemoryStore
from backend.app.db.session import AsyncSessionLocal
from backend.app.models.farm import FarmChatAttachment, FarmImage
from backend.app.schemas.farm import FarmCreateRequest
from backend.app.services.farm_service import FarmService
from backend.tests.fake_bucket_storage import FakeBucketStorage

ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+R2QAAAAASUVORK5CYII="
)


def test_chatkit_attachment_roundtrip_promotes_pending_upload_to_farm_image() -> None:
    async def _run() -> None:
        bucket = FakeBucketStorage()
        async with AsyncSessionLocal() as db:
            farm_service = FarmService(db)
            farm = await farm_service.create_farm(
                user_id="user_123",
                request=FarmCreateRequest(name="Walnut south"),
            )
            store = FarmMemoryStore(db, bucket_service=bucket)
            context = FarmAgentContext(
                chat_id="pending_chat",
                user_id="user_123",
                user_email="user@example.com",
                db=db,
                farm_id=farm.id,
                farm_name=farm.name,
            )

            attachment = await store.create_attachment(
                AttachmentCreateParams(
                    name="orchard.png",
                    size=len(ONE_PIXEL_PNG),
                    mime_type="image/png",
                ),
                context,
            )

            metadata = _attachment_metadata(attachment.metadata)
            upload_descriptor = attachment.upload_descriptor

            assert upload_descriptor is not None
            assert upload_descriptor.method == "PUT"
            assert upload_descriptor.headers == {"Content-Type": "image/png"}
            assert metadata["upload_state"] == "pending"
            assert metadata["storage_key"].startswith("chat_attachment/")

            uploaded_key = await bucket.upload_from_presigned_descriptor(
                descriptor_url=upload_descriptor.url,
                file_bytes=ONE_PIXEL_PNG,
                mime_type=attachment.mime_type,
            )
            assert uploaded_key == metadata["storage_key"]
            assert bucket.content_types[uploaded_key] == "image/png"

            finalized = await store.finalize_attachment(attachment, thread_id=None)
            finalized_metadata = _attachment_metadata(finalized.metadata)
            image_id = finalized_metadata["image_id"]

            assert finalized.upload_descriptor is None
            assert "upload_state" not in finalized_metadata
            assert finalized_metadata["source_kind"] == "chat_attachment"
            assert finalized_metadata["storage_key"] == uploaded_key

            image = await db.get(FarmImage, image_id)
            assert image is not None
            assert image.attachment_id == attachment.id
            assert image.source_kind == "chat_attachment"
            assert image.storage_key == uploaded_key
            assert image.status == "available"
            assert image.width == 1
            assert image.height == 1

            saved_attachment = await db.get(FarmChatAttachment, attachment.id)
            assert saved_attachment is not None

            await store.delete_attachment(attachment.id, context)

            deleted_image = await db.get(FarmImage, image_id)
            assert deleted_image is not None
            assert deleted_image.status == "deleted"
            assert uploaded_key not in bucket.objects
            assert await db.get(FarmChatAttachment, attachment.id) is None

    asyncio.run(_run())


def test_chatkit_attachment_finalize_rejects_size_mismatch() -> None:
    async def _run() -> None:
        bucket = FakeBucketStorage()
        async with AsyncSessionLocal() as db:
            farm_service = FarmService(db)
            farm = await farm_service.create_farm(
                user_id="user_123",
                request=FarmCreateRequest(name="Walnut south"),
            )
            store = FarmMemoryStore(db, bucket_service=bucket)
            context = FarmAgentContext(
                chat_id="pending_chat",
                user_id="user_123",
                user_email="user@example.com",
                db=db,
                farm_id=farm.id,
                farm_name=farm.name,
            )

            attachment = await store.create_attachment(
                AttachmentCreateParams(
                    name="orchard.png",
                    size=len(ONE_PIXEL_PNG) + 5,
                    mime_type="image/png",
                ),
                context,
            )

            metadata = _attachment_metadata(attachment.metadata)
            upload_descriptor = attachment.upload_descriptor

            assert upload_descriptor is not None

            await bucket.upload_from_presigned_descriptor(
                descriptor_url=upload_descriptor.url,
                file_bytes=ONE_PIXEL_PNG,
                mime_type=attachment.mime_type,
            )

            with pytest.raises(HTTPException) as exc_info:
                await store.finalize_attachment(attachment, thread_id=None)

            assert exc_info.value.status_code == 400
            assert "size did not match" in exc_info.value.detail
            assert metadata["storage_key"] in bucket.objects
            assert await db.get(FarmChatAttachment, attachment.id) is not None

            image_result = await db.execute(
                select(FarmImage).where(FarmImage.attachment_id == attachment.id)
            )
            assert image_result.scalar_one_or_none() is None

    asyncio.run(_run())


def _attachment_metadata(metadata: object) -> dict[str, str]:
    assert isinstance(metadata, dict)
    normalized: dict[str, str] = {}
    for key, value in metadata.items():
        if isinstance(value, str):
            normalized[key] = value
    if "storage_key" in metadata:
        assert isinstance(metadata["storage_key"], str)
        normalized["storage_key"] = metadata["storage_key"]
    if "upload_state" in metadata:
        assert isinstance(metadata["upload_state"], str)
        normalized["upload_state"] = metadata["upload_state"]
    if "source_kind" in metadata:
        assert isinstance(metadata["source_kind"], str)
        normalized["source_kind"] = metadata["source_kind"]
    if "image_id" in metadata:
        assert isinstance(metadata["image_id"], str)
        normalized["image_id"] = metadata["image_id"]
    return normalized
