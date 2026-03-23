from __future__ import annotations

from base64 import b64encode
from io import BytesIO
from typing import Any

from chatkit.types import Attachment, FileAttachment, ImageAttachment

from backend.app.models.stored_file import StoredOpenAIFile
from backend.app.schemas.stored_file import (
    SerializedChatAttachment,
    SerializedFileChatAttachment,
    SerializedImageChatAttachment,
    StoredFileScope,
)

THUMBNAIL_MAX_DIMENSION = 320


def build_attachment_metadata(
    *,
    stored_file: StoredOpenAIFile,
    scope: StoredFileScope,
) -> dict[str, object]:
    return {
        "stored_file_id": stored_file.id,
        "openai_file_id": stored_file.openai_file_id,
        "attach_mode": (
            "document_tool_only" if scope == "document_thread_file" else "model_input"
        ),
        "input_kind": "image" if stored_file.kind == "image" else "file",
        "byte_size": stored_file.byte_size,
        "scope": scope,
    }


def build_canonical_attachment(
    *,
    stored_file: StoredOpenAIFile,
    attachment_id: str,
    scope: StoredFileScope,
    thread_id: str | None,
) -> FileAttachment:
    return FileAttachment(
        id=attachment_id,
        name=stored_file.name,
        mime_type=stored_file.mime_type or "application/octet-stream",
        upload_descriptor=None,
        thread_id=thread_id,
        metadata=build_attachment_metadata(stored_file=stored_file, scope=scope),
    )


def normalize_attachment_for_storage(attachment: Attachment) -> FileAttachment:
    metadata = attachment.metadata if isinstance(attachment.metadata, dict) else None
    return FileAttachment(
        id=attachment.id,
        name=attachment.name,
        mime_type=attachment.mime_type,
        upload_descriptor=attachment.upload_descriptor,
        thread_id=attachment.thread_id,
        metadata=metadata,
    )


def build_display_attachment(
    *,
    canonical_attachment: Attachment,
    file_bytes: bytes | None,
) -> Attachment:
    metadata = (
        canonical_attachment.metadata
        if isinstance(canonical_attachment.metadata, dict)
        else {}
    )
    if metadata.get("input_kind") != "image" or file_bytes is None:
        return canonical_attachment

    preview_url = build_image_thumbnail_data_url(file_bytes=file_bytes)
    if not isinstance(preview_url, str) or not preview_url:
        return canonical_attachment

    return ImageAttachment(
        id=canonical_attachment.id,
        name=canonical_attachment.name,
        mime_type=canonical_attachment.mime_type,
        preview_url=preview_url,
        upload_descriptor=canonical_attachment.upload_descriptor,
        thread_id=canonical_attachment.thread_id,
        metadata=metadata,
    )


def serialize_attachment(attachment: Attachment) -> SerializedChatAttachment:
    base_fields = {
        "id": attachment.id,
        "name": attachment.name,
        "mime_type": attachment.mime_type or "application/octet-stream",
    }
    if attachment.type == "image":
        return SerializedImageChatAttachment(
            **base_fields,
            preview_url=str(attachment.preview_url),
        )
    return SerializedFileChatAttachment(**base_fields)


def build_image_thumbnail_data_url(
    *,
    file_bytes: bytes,
    max_dimension: int = THUMBNAIL_MAX_DIMENSION,
) -> str | None:
    try:
        from PIL import Image, ImageOps
    except Exception:
        return None

    try:
        with Image.open(BytesIO(file_bytes)) as source_image:
            image = ImageOps.exif_transpose(source_image)
            thumbnail = image.copy()
            thumbnail.thumbnail((max_dimension, max_dimension))

            if "A" in thumbnail.getbands():
                mime_type = "image/png"
                save_format = "PNG"
            else:
                mime_type = "image/jpeg"
                save_format = "JPEG"
                if thumbnail.mode != "RGB":
                    thumbnail = thumbnail.convert("RGB")

            buffer = BytesIO()
            save_kwargs: dict[str, Any] = {
                "format": save_format,
                "optimize": True,
            }
            if save_format == "JPEG":
                save_kwargs["quality"] = 82
            thumbnail.save(buffer, **save_kwargs)
    except Exception:
        return None

    encoded = b64encode(buffer.getvalue()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"
