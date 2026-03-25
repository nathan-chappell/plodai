from __future__ import annotations

from typing import TypedDict

from chatkit.types import Attachment, FileAttachment, ImageAttachment

from backend.app.models.farm import FarmImage


class FarmAttachmentMetadata(TypedDict, total=False):
    image_id: str
    user_id: str
    farm_id: str
    storage_provider: str
    storage_key: str
    source_kind: str
    input_kind: str
    declared_size: int
    upload_state: str


def build_attachment_metadata(image: FarmImage) -> FarmAttachmentMetadata:
    return {
        "image_id": image.id,
        "user_id": image.user_id,
        "farm_id": image.farm_id,
        "storage_provider": image.storage_provider,
        "storage_key": image.storage_key,
        "source_kind": image.source_kind,
        "input_kind": "image",
    }


def build_canonical_attachment(
    *,
    image: FarmImage,
    attachment_id: str,
    thread_id: str | None,
) -> FileAttachment:
    return FileAttachment(
        id=attachment_id,
        name=image.name,
        mime_type=image.mime_type or "application/octet-stream",
        upload_descriptor=None,
        thread_id=thread_id,
        metadata=build_attachment_metadata(image),
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
    preview_url: str | None,
) -> Attachment:
    metadata = (
        canonical_attachment.metadata
        if isinstance(canonical_attachment.metadata, dict)
        else {}
    )
    if metadata.get("input_kind") != "image" or not preview_url:
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
