from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import timedelta
from io import BytesIO
from pathlib import PurePosixPath
from typing import Protocol, cast
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import HTTPException, status
from minio import Minio
from minio.error import S3Error, ServerError
from minio.helpers import md5sum_hash
from minio.xml import Element, SubElement, getbytes

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
        self._cached_client: Minio | None = None

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
        suffix = (
            attachment_id.strip()
            if isinstance(attachment_id, str) and attachment_id.strip()
            else uuid4().hex
        )
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
        headers: dict[str, str] = {}
        if isinstance(mime_type, str) and mime_type:
            headers["Content-Type"] = mime_type
        url = client.presigned_put_object(
            self._bucket_name(),
            key,
            expires=timedelta(
                seconds=self.settings.storage_bucket_upload_url_ttl_seconds,
            ),
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
        response_headers: dict[str, str] = {
            "response-content-disposition": f'{disposition}; filename="{safe_filename}"',
        }
        if isinstance(mime_type, str) and mime_type:
            response_headers["response-content-type"] = mime_type
        return client.presigned_get_object(
            self._bucket_name(),
            key,
            expires=timedelta(
                seconds=self.settings.storage_bucket_download_url_ttl_seconds,
            ),
            response_headers=response_headers,
        )

    async def put_object_bytes(
        self,
        *,
        key: str,
        file_bytes: bytes,
        mime_type: str | None,
    ) -> None:
        await asyncio.to_thread(
            self._put_object_bytes_sync,
            key,
            file_bytes,
            mime_type,
        )

    async def head_object(self, *, key: str) -> BucketObjectMetadata:
        try:
            response = await asyncio.to_thread(
                self._client().stat_object,
                self._bucket_name(),
                key,
            )
        except Exception as exc:
            if self._is_missing_error(exc):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Attachment upload not found.",
                ) from exc
            raise
        return BucketObjectMetadata(
            content_length=int(response.size or 0),
            content_type=response.content_type,
            etag=response.etag,
        )

    async def get_object_bytes(self, *, key: str) -> bytes:
        try:
            response = await asyncio.to_thread(
                self._client().get_object,
                self._bucket_name(),
                key,
            )
        except Exception as exc:
            if self._is_missing_error(exc):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Stored file not found.",
                ) from exc
            raise
        try:
            return await asyncio.to_thread(response.read)
        finally:
            response.close()
            response.release_conn()

    async def delete_object(self, *, key: str) -> None:
        await asyncio.to_thread(
            self._client().remove_object,
            self._bucket_name(),
            key,
        )

    async def ensure_cors(self, *, allowed_origins: list[str]) -> None:
        origins = [
            origin
            for origin in dict.fromkeys(allowed_origins)
            if isinstance(origin, str) and origin
        ]
        if not origins:
            return
        cors_body = self._build_cors_configuration_body(origins)
        await asyncio.to_thread(
            self._put_bucket_cors_sync,
            cors_body,
        )

    def _bucket_name(self) -> str:
        bucket_name = self.settings.storage_bucket_name
        if isinstance(bucket_name, str) and bucket_name.strip():
            return bucket_name.strip()
        raise RuntimeError(
            "storage bucket configuration is incomplete: missing bucket name"
        )

    def _client(self) -> Minio:
        if not self.is_configured():
            raise RuntimeError("storage bucket configuration is incomplete")
        if self._cached_client is None:
            endpoint, secure = self._parse_endpoint()
            client = Minio(
                endpoint,
                access_key=self.settings.storage_bucket_access_key_id,
                secret_key=self.settings.storage_bucket_secret_access_key,
                region=self.settings.storage_bucket_region,
                secure=secure,
            )
            if self.settings.storage_bucket_url_style == "path":
                client.disable_virtual_style_endpoint()
            else:
                client.enable_virtual_style_endpoint()
            self._cached_client = client
        return self._cached_client

    def _parse_endpoint(self) -> tuple[str, bool]:
        raw_endpoint = self.settings.storage_bucket_endpoint.strip()
        parsed = urlsplit(
            raw_endpoint if "://" in raw_endpoint else f"https://{raw_endpoint}"
        )
        endpoint = parsed.netloc or parsed.path
        if not endpoint:
            raise RuntimeError(
                "storage bucket configuration is incomplete: missing endpoint"
            )
        return endpoint, parsed.scheme != "http"

    def _put_object_bytes_sync(
        self,
        key: str,
        file_bytes: bytes,
        mime_type: str | None,
    ) -> None:
        data = BytesIO(file_bytes)
        self._client().put_object(
            self._bucket_name(),
            key,
            data,
            len(file_bytes),
            content_type=mime_type or "application/octet-stream",
        )

    def _build_cors_configuration_body(self, allowed_origins: list[str]) -> bytes:
        root = Element("CORSConfiguration")
        rule = SubElement(root, "CORSRule")
        for method in ("GET", "HEAD", "PUT"):
            SubElement(rule, "AllowedMethod", method)
        for origin in allowed_origins:
            SubElement(rule, "AllowedOrigin", origin)
        SubElement(rule, "AllowedHeader", "*")
        for header in ("Content-Length", "Content-Type", "ETag"):
            SubElement(rule, "ExposeHeader", header)
        SubElement(rule, "MaxAgeSeconds", "300")
        return getbytes(root)

    def _put_bucket_cors_sync(self, cors_body: bytes) -> None:
        self._client()._execute(
            "PUT",
            self._bucket_name(),
            body=cors_body,
            headers={"Content-MD5": cast(str, md5sum_hash(cors_body))},
            query_params={"cors": ""},
        )

    @staticmethod
    def _is_missing_error(exc: Exception) -> bool:
        if isinstance(exc, S3Error):
            return (exc.code or "") in {
                "404",
                "NoSuchKey",
                "NoSuchObject",
                "NotFound",
            }
        if isinstance(exc, ServerError):
            return exc.status_code == 404
        status_code = getattr(exc, "status_code", None)
        return status_code == 404
