from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Protocol
from uuid import uuid4

from fastapi import HTTPException, status

from backend.app.core.config import Settings, get_settings

DEFAULT_STORAGE_PROVIDER = "railway_bucket"


@dataclass(kw_only=True)
class BucketObjectMetadata:
    content_length: int
    content_type: str | None = None
    etag: str | None = None


@dataclass(kw_only=True)
class BucketPresignedUpload:
    url: str
    headers: dict[str, str]


class BucketStorageService(Protocol):
    storage_provider: str

    def build_object_key(
        self,
        *,
        scope: str,
        attachment_id: str | None = None,
    ) -> str: ...

    def build_presigned_upload(
        self,
        *,
        key: str,
        mime_type: str | None,
        file_name: str | None = None,
    ) -> BucketPresignedUpload: ...

    def build_presigned_download_url(
        self,
        *,
        key: str,
        filename: str | None,
        mime_type: str | None,
        inline: bool,
    ) -> str: ...

    async def put_object_bytes(
        self,
        *,
        key: str,
        file_bytes: bytes,
        mime_type: str | None,
    ) -> None: ...

    async def head_object(self, *, key: str) -> BucketObjectMetadata: ...

    async def get_object_bytes(self, *, key: str) -> bytes: ...

    async def delete_object(self, *, key: str) -> None: ...

    async def ensure_cors(self, *, allowed_origins: list[str]) -> None: ...


class RailwayBucketService:
    storage_provider = DEFAULT_STORAGE_PROVIDER

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def is_configured(self) -> bool:
        return all(
            [
                self.settings.storage_bucket_endpoint,
                self.settings.storage_bucket_name,
                self.settings.storage_bucket_access_key_id,
                self.settings.storage_bucket_secret_access_key,
                self.settings.storage_bucket_region,
            ]
        )

    def build_object_key(
        self,
        *,
        scope: str,
        attachment_id: str | None = None,
    ) -> str:
        prefix = scope.strip("/") or "uploads"
        suffix = attachment_id.strip() if isinstance(attachment_id, str) and attachment_id.strip() else uuid4().hex
        return f"{prefix}/{uuid4().hex}/{suffix}"

    def build_presigned_upload(
        self,
        *,
        key: str,
        mime_type: str | None,
        file_name: str | None = None,
    ) -> BucketPresignedUpload:
        del file_name
        client = self._client()
        params: dict[str, str] = {
            "Bucket": self._bucket_name(),
            "Key": key,
        }
        headers: dict[str, str] = {}
        if isinstance(mime_type, str) and mime_type:
            params["ContentType"] = mime_type
            headers["Content-Type"] = mime_type
        url = client.generate_presigned_url(
            "put_object",
            Params=params,
            ExpiresIn=self.settings.storage_bucket_upload_url_ttl_seconds,
            HttpMethod="PUT",
        )
        return BucketPresignedUpload(url=url, headers=headers)

    def build_presigned_download_url(
        self,
        *,
        key: str,
        filename: str | None,
        mime_type: str | None,
        inline: bool,
    ) -> str:
        client = self._client()
        disposition = "inline" if inline else "attachment"
        safe_filename = (
            PurePosixPath(filename).name
            if isinstance(filename, str) and filename.strip()
            else "download"
        )
        params: dict[str, str] = {
            "Bucket": self._bucket_name(),
            "Key": key,
            "ResponseContentDisposition": f'{disposition}; filename="{safe_filename}"',
        }
        if isinstance(mime_type, str) and mime_type:
            params["ResponseContentType"] = mime_type
        return client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=self.settings.storage_bucket_download_url_ttl_seconds,
            HttpMethod="GET",
        )

    async def put_object_bytes(
        self,
        *,
        key: str,
        file_bytes: bytes,
        mime_type: str | None,
    ) -> None:
        await asyncio.to_thread(
            self._client().put_object,
            Bucket=self._bucket_name(),
            Key=key,
            Body=file_bytes,
            ContentType=mime_type or "application/octet-stream",
        )

    async def head_object(self, *, key: str) -> BucketObjectMetadata:
        try:
            response = await asyncio.to_thread(
                self._client().head_object,
                Bucket=self._bucket_name(),
                Key=key,
            )
        except Exception as exc:
            if self._is_missing_error(exc):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Attachment upload not found.",
                ) from exc
            raise
        return BucketObjectMetadata(
            content_length=int(response.get("ContentLength", 0)),
            content_type=response.get("ContentType"),
            etag=response.get("ETag"),
        )

    async def get_object_bytes(self, *, key: str) -> bytes:
        try:
            response = await asyncio.to_thread(
                self._client().get_object,
                Bucket=self._bucket_name(),
                Key=key,
            )
        except Exception as exc:
            if self._is_missing_error(exc):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Stored file not found.",
                ) from exc
            raise
        body = response["Body"]
        return await asyncio.to_thread(body.read)

    async def delete_object(self, *, key: str) -> None:
        await asyncio.to_thread(
            self._client().delete_object,
            Bucket=self._bucket_name(),
            Key=key,
        )

    async def ensure_cors(self, *, allowed_origins: list[str]) -> None:
        origins = [origin for origin in dict.fromkeys(allowed_origins) if isinstance(origin, str) and origin]
        if not origins:
            return
        cors_configuration = {
            "CORSRules": [
                {
                    "AllowedMethods": ["GET", "HEAD", "PUT"],
                    "AllowedOrigins": origins,
                    "AllowedHeaders": ["*"],
                    "ExposeHeaders": ["Content-Length", "Content-Type", "ETag"],
                    "MaxAgeSeconds": 300,
                }
            ]
        }
        await asyncio.to_thread(
            self._client().put_bucket_cors,
            Bucket=self._bucket_name(),
            CORSConfiguration=cors_configuration,
        )

    def _bucket_name(self) -> str:
        bucket_name = self.settings.storage_bucket_name
        if isinstance(bucket_name, str) and bucket_name.strip():
            return bucket_name.strip()
        raise RuntimeError("storage bucket configuration is incomplete: missing bucket name")

    def _client(self):
        if not self.is_configured():
            raise RuntimeError("storage bucket configuration is incomplete")

        import boto3
        from botocore.client import Config

        return boto3.client(
            "s3",
            endpoint_url=self.settings.storage_bucket_endpoint,
            aws_access_key_id=self.settings.storage_bucket_access_key_id,
            aws_secret_access_key=self.settings.storage_bucket_secret_access_key,
            region_name=self.settings.storage_bucket_region,
            config=Config(
                signature_version="s3v4",
                s3={
                    "addressing_style": self.settings.storage_bucket_url_style,
                },
            ),
        )

    @staticmethod
    def _is_missing_error(exc: Exception) -> bool:
        response = getattr(exc, "response", None)
        if not isinstance(response, dict):
            return False
        error = response.get("Error")
        if not isinstance(error, dict):
            return False
        code = str(error.get("Code") or "")
        return code in {"404", "NoSuchKey", "NotFound"}
