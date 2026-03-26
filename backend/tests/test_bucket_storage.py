import asyncio
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from fastapi import HTTPException

from backend.app.services.bucket_storage import RailwayBucketService

PRESIGNED_URL_TTL_SECONDS = 5


def _http_put_bytes(url: str, *, payload: bytes, headers: dict[str, str]) -> int:
    request = Request(
        url,
        data=payload,
        headers=headers,
        method="PUT",
    )
    with urlopen(request, timeout=20) as response:
        return response.getcode()


def _http_get_bytes(url: str) -> bytes:
    request = Request(url, method="GET")
    with urlopen(request, timeout=20) as response:
        return response.read()


def _http_error_for_get(url: str) -> tuple[int, bytes]:
    request = Request(url, method="GET")
    try:
        with urlopen(request, timeout=20):
            raise AssertionError("expected the signed GET request to fail")
    except HTTPError as exc:
        return exc.code, exc.read()


def test_railway_bucket_service_supports_live_presigned_upload_roundtrip() -> None:
    async def _run() -> None:
        service = RailwayBucketService()
        assert service.is_configured(), "Bucket service is not configured for this environment."

        service.settings.storage_bucket_upload_url_ttl_seconds = PRESIGNED_URL_TTL_SECONDS
        service.settings.storage_bucket_download_url_ttl_seconds = PRESIGNED_URL_TTL_SECONDS

        key = service.build_object_key(
            scope="bucket_smoke_test",
            attachment_id="presigned-roundtrip.txt",
        )
        payload = b"railway bucket smoke test\n"
        mime_type = "text/plain"

        upload = service.build_presigned_upload(
            key=key,
            mime_type=mime_type,
            file_name="presigned-roundtrip.txt",
        )
        try:
            upload_status = await asyncio.to_thread(
                _http_put_bytes,
                upload.url,
                payload=payload,
                headers=upload.headers,
            )
            assert 200 <= upload_status < 300

            metadata = await service.head_object(key=key)
            assert metadata.content_length == len(payload)
            assert metadata.content_type == mime_type

            download_url = service.build_presigned_download_url(
                key=key,
                filename="presigned-roundtrip.txt",
                mime_type=mime_type,
                inline=False,
            )
            downloaded = await asyncio.to_thread(_http_get_bytes, download_url)
            assert downloaded == payload

            expiring_download_url = service.build_presigned_download_url(
                key=key,
                filename="presigned-roundtrip.txt",
                mime_type=mime_type,
                inline=False,
            )
            await asyncio.sleep(PRESIGNED_URL_TTL_SECONDS + 1)

            expired_status, _expired_body = await asyncio.to_thread(
                _http_error_for_get,
                expiring_download_url,
            )
            assert expired_status in {400, 403}

            await service.delete_object(key=key)

            with pytest.raises(HTTPException) as missing_head:
                await service.head_object(key=key)
            assert missing_head.value.status_code == 404

            with pytest.raises(HTTPException) as missing_get:
                await service.get_object_bytes(key=key)
            assert missing_get.value.status_code == 404

            deleted_download_url = service.build_presigned_download_url(
                key=key,
                filename="presigned-roundtrip.txt",
                mime_type=mime_type,
                inline=False,
            )
            deleted_status, _deleted_body = await asyncio.to_thread(
                _http_error_for_get,
                deleted_download_url,
            )
            assert deleted_status == 404
        finally:
            try:
                await service.delete_object(key=key)
            except Exception:
                pass

    asyncio.run(_run())
