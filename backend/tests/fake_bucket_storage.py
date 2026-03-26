from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from fastapi import HTTPException, status

from backend.app.services.bucket_storage import (
    DEFAULT_STORAGE_PROVIDER,
    BucketObjectMetadata,
    BucketPresignedUpload,
)


@dataclass
class FakeBucketStorage:
    storage_provider: str = DEFAULT_STORAGE_PROVIDER
    objects: dict[str, bytes] = field(default_factory=dict)
    content_types: dict[str, str | None] = field(default_factory=dict)
    ensured_cors_origins: list[list[str]] = field(default_factory=list)

    def is_configured(self) -> bool:
        return True

    def build_object_key(
        self,
        *,
        scope: str,
        attachment_id: str | None = None,
    ) -> str:
        suffix = attachment_id.strip() if isinstance(attachment_id, str) and attachment_id.strip() else uuid4().hex
        return f"{scope}/{uuid4().hex}/{suffix}"

    def build_presigned_upload(
        self,
        *,
        key: str,
        mime_type: str | None,
        file_name: str | None = None,
    ) -> BucketPresignedUpload:
        del file_name
        headers: dict[str, str] = {}
        if isinstance(mime_type, str) and mime_type:
            headers["Content-Type"] = mime_type
        return BucketPresignedUpload(
            url=f"https://bucket.test/{key}?kind=put",
            headers=headers,
        )

    def build_presigned_download_url(
        self,
        *,
        key: str,
        filename: str | None,
        mime_type: str | None,
        inline: bool,
    ) -> str:
        disposition = "inline" if inline else "attachment"
        safe_name = filename or "download"
        suffix = f"?kind=get&disposition={disposition}&filename={safe_name}"
        if isinstance(mime_type, str) and mime_type:
            suffix += f"&content_type={mime_type}"
        return f"https://bucket.test/{key}{suffix}"

    async def put_object_bytes(
        self,
        *,
        key: str,
        file_bytes: bytes,
        mime_type: str | None,
    ) -> None:
        self.objects[key] = file_bytes
        self.content_types[key] = mime_type

    async def head_object(self, *, key: str) -> BucketObjectMetadata:
        if key not in self.objects:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment upload not found.",
            )
        return BucketObjectMetadata(
            content_length=len(self.objects[key]),
            content_type=self.content_types.get(key),
            etag=f"etag-{key}",
        )

    async def get_object_bytes(self, *, key: str) -> bytes:
        if key not in self.objects:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stored file not found.",
            )
        return self.objects[key]

    async def delete_object(self, *, key: str) -> None:
        self.objects.pop(key, None)
        self.content_types.pop(key, None)

    async def ensure_cors(self, *, allowed_origins: list[str]) -> None:
        deduped = [origin for origin in dict.fromkeys(allowed_origins) if origin]
        self.ensured_cors_origins.append(deduped)

    async def upload_from_presigned_descriptor(
        self,
        *,
        descriptor_url: object,
        file_bytes: bytes,
        mime_type: str | None,
    ) -> str:
        parsed = urlparse(str(descriptor_url))
        if parse_qs(parsed.query).get("kind") != ["put"]:
            raise AssertionError("expected a fake presigned PUT URL")
        key = parsed.path.lstrip("/")
        await self.put_object_bytes(
            key=key,
            file_bytes=file_bytes,
            mime_type=mime_type,
        )
        return key


def fake_bucket_service_factory(bucket: FakeBucketStorage):
    def _factory(*_: object, **__: object) -> FakeBucketStorage:
        return bucket

    return _factory


def fake_bucket_service_namespace(bucket: FakeBucketStorage) -> SimpleNamespace:
    return SimpleNamespace(
        RailwayBucketService=fake_bucket_service_factory(bucket),
    )
