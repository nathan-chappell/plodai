from __future__ import annotations

from pathlib import PurePosixPath

from fastapi import HTTPException, status

from backend.app.core.config import Settings


ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def is_image_file(
    *,
    file_name: str,
    mime_type: str | None,
) -> bool:
    extension = PurePosixPath(file_name).suffix.lower()
    if extension in ALLOWED_IMAGE_EXTENSIONS:
        return True
    return bool(mime_type and mime_type.startswith("image/"))


def validate_farm_image_upload(
    *,
    settings: Settings,
    file_name: str,
    mime_type: str | None,
    byte_size: int,
) -> None:
    if not is_image_file(file_name=file_name, mime_type=mime_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PlodAI only accepts image uploads.",
        )
    if byte_size > settings.plodai_chat_attachment_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="PlodAI image uploads must be 10 MB or smaller.",
        )
