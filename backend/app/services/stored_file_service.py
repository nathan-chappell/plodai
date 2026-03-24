from __future__ import annotations

import hashlib
import hmac
import csv
import json
import logging
import mimetypes
from base64 import urlsafe_b64decode, urlsafe_b64encode
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from io import BytesIO, StringIO
from pathlib import PurePosixPath
from typing import Literal
from uuid import uuid4

from chatkit.types import Attachment
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.chatkit.attachment_payloads import (
    build_canonical_attachment,
    build_display_attachment,
    serialize_attachment,
)
from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.chatkit.metadata import (
    build_remove_plodai_image_ref_patch,
    merge_chat_metadata,
    parse_chat_metadata,
)
from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger, log_event, summarize_pairs_for_log
from backend.app.models.chatkit import WorkspaceChat, WorkspaceWorkspaceChatAttachment
from backend.app.models.stored_file import StoredFile
from backend.app.models.workspace import Workspace
from backend.app.schemas.stored_file import (
    ChatAttachmentDeleteResponse,
    ChatAttachmentUploadResponse,
    DatasetStoredFilePreview,
    DeleteDocumentFileResponse,
    DocumentFileSummary,
    DocumentFileListResponse,
    EmptyStoredFilePreview,
    ImageStoredFilePreview,
    PdfStoredFilePreview,
    SerializedChatAttachment,
    StoredFileKind,
    StoredFilePreview,
    StoredFileScope,
    StoredFileSourceKind,
    StoredFileSummary,
)
from backend.app.services.bucket_storage import (
    DEFAULT_STORAGE_PROVIDER,
    BucketStorageService,
    RailwayBucketService,
)

logger = get_logger("services.stored_file")


@dataclass(kw_only=True)
class StoredUploadResult:
    stored_file: StoredFile
    thread_id: str | None = None


class StoredFileService:
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

    async def create_chat_attachment_upload(
        self,
        *,
        user_id: str,
        workspace_id: str,
        app_id: str,
        file_name: str,
        mime_type: str | None,
        file_bytes: bytes,
        attachment_id: str,
        scope: StoredFileScope,
        thread_id: str | None,
        create_attachment: bool,
        source_kind: StoredFileSourceKind | None = None,
        parent_file_id: str | None = None,
        preview_json: dict[str, object] | None = None,
        public_base_url: str | None = None,
    ) -> ChatAttachmentUploadResponse:
        workspace = await self._get_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id=app_id,
        )
        self._validate_workspace_upload(
            workspace=workspace,
            file_name=file_name,
            mime_type=mime_type,
            file_bytes=file_bytes,
            scope=scope,
        )
        ensured_thread_id = thread_id
        if scope == "document_thread_file":
            ensured_thread_id = await self.ensure_document_thread_id(
                user_id=user_id,
                workspace=workspace,
                thread_id=thread_id,
            )
        resolved_source_kind = source_kind or "upload"
        if resolved_source_kind not in {"upload", "url_import", "derived"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported source_kind.",
            )

        stored_file = await self._store_file_bytes(
            user_id=user_id,
            app_id=workspace.app_id,
            workspace_id=workspace.id,
            thread_id=ensured_thread_id,
            attachment_id=attachment_id if create_attachment else None,
            scope=scope,
            source_kind=resolved_source_kind,
            parent_file_id=parent_file_id,
            file_name=file_name,
            mime_type=mime_type,
            file_bytes=file_bytes,
            preview_json=preview_json,
        )
        serialized_attachment: SerializedChatAttachment | None = None
        if create_attachment:
            canonical_attachment = build_canonical_attachment(
                stored_file=stored_file,
                attachment_id=attachment_id,
                scope=scope,
                thread_id=ensured_thread_id,
            )
            await DatabaseMemoryStore(
                self.db,
                settings=self.settings,
                public_base_url=public_base_url,
                bucket_service=self.bucket_service,
            ).save_attachment(
                canonical_attachment,
                context=None,
            )
            preview_url = (
                self.build_public_preview_url(
                    stored_file,
                    public_base_url=public_base_url,
                )
                if stored_file.kind == "image"
                else None
            )
            display_attachment = build_display_attachment(
                canonical_attachment=canonical_attachment,
                file_bytes=None,
                preview_url=preview_url,
            )
            serialized_attachment = serialize_attachment(display_attachment)

        return ChatAttachmentUploadResponse(
            attachment=serialized_attachment,
            stored_file=self.serialize_stored_file(stored_file),
            thread_id=ensured_thread_id,
        )

    async def list_document_files(
        self,
        *,
        user_id: str,
        thread_id: str,
    ) -> DocumentFileListResponse:
        await self._get_chat(thread_id=thread_id, user_id=user_id)
        result = await self.db.execute(
            select(StoredFile)
            .where(
                StoredFile.user_id == user_id,
                StoredFile.thread_id == thread_id,
                StoredFile.scope == "document_thread_file",
                StoredFile.status != "deleted",
            )
            .order_by(StoredFile.created_at.desc())
        )
        records = list(result.scalars().all())
        return DocumentFileListResponse(
            thread_id=thread_id,
            files=[self.serialize_document_file(record) for record in records],
        )

    async def delete_document_file(
        self,
        *,
        user_id: str,
        thread_id: str,
        file_id: str,
    ) -> DeleteDocumentFileResponse:
        record = await self.get_document_file(
            user_id=user_id,
            thread_id=thread_id,
            file_id=file_id,
        )
        await self._delete_file_record(record)
        return DeleteDocumentFileResponse(
            thread_id=thread_id,
            file_id=file_id,
            deleted=True,
        )

    async def delete_chat_attachment(
        self,
        *,
        user_id: str,
        attachment_id: str,
    ) -> ChatAttachmentDeleteResponse:
        result = await self.db.execute(
            select(StoredFile).where(
                StoredFile.user_id == user_id,
                StoredFile.attachment_id == attachment_id,
            )
        )
        record = result.scalar_one_or_none()
        attachment = await self.db.get(WorkspaceWorkspaceChatAttachment, attachment_id)
        if record is not None and isinstance(record.thread_id, str) and record.thread_id.strip():
            chat = await self.db.get(WorkspaceChat, record.thread_id.strip())
            if chat is not None and chat.user_id == user_id and isinstance(chat.metadata_json, dict):
                current_metadata = parse_chat_metadata(chat.metadata_json)
                patch = build_remove_plodai_image_ref_patch(
                    current_metadata,
                    stored_file_id=record.id,
                    attachment_id=attachment_id,
                )
                if patch is not None:
                    chat.metadata_json = merge_chat_metadata(current_metadata, patch)
        if attachment is not None:
            await self.db.delete(attachment)
        if record is not None:
            await self._delete_file_record(record, commit=False)
        await self.db.commit()
        return ChatAttachmentDeleteResponse(
            attachment_id=attachment_id,
            deleted=record is not None or attachment is not None,
        )

    async def get_stored_file(
        self,
        *,
        user_id: str,
        file_id: str,
    ) -> StoredFile:
        record = await self.db.get(StoredFile, file_id)
        if record is None or record.user_id != user_id or record.status == "deleted":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stored file not found.",
            )
        return record

    async def get_document_file(
        self,
        *,
        user_id: str,
        thread_id: str,
        file_id: str,
    ) -> StoredFile:
        record = await self.get_stored_file(user_id=user_id, file_id=file_id)
        if record.scope != "document_thread_file" or record.thread_id != thread_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document file not found.",
            )
        return record

    async def load_file_bytes(self, record: StoredFile) -> bytes:
        return await self.bucket_service.get_object_bytes(key=record.storage_key)

    async def load_dataset_rows(self, record: StoredFile) -> list[dict[str, object]]:
        if record.kind not in {"csv", "json"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The selected file is not a supported dataset.",
            )
        file_bytes = await self.load_file_bytes(record)
        return _load_dataset_rows(
            kind=record.kind,  # type: ignore[arg-type]
            file_bytes=file_bytes,
        )

    async def create_document_revision(
        self,
        *,
        parent_record: StoredFile,
        file_name: str,
        file_bytes: bytes,
        mime_type: str | None = None,
        source_kind: StoredFileSourceKind = "derived",
    ) -> StoredFile:
        return await self._store_file_bytes(
            user_id=parent_record.user_id,
            app_id=parent_record.app_id,
            workspace_id=parent_record.workspace_id,
            thread_id=parent_record.thread_id,
            attachment_id=None,
            scope="document_thread_file",
            source_kind=source_kind,
            parent_file_id=parent_record.id,
            file_name=file_name,
            mime_type=mime_type or parent_record.mime_type,
            file_bytes=file_bytes,
        )

    async def ensure_document_thread_id(
        self,
        *,
        user_id: str,
        workspace: Workspace,
        thread_id: str | None,
    ) -> str:
        if thread_id:
            chat = await self._get_chat(thread_id=thread_id, user_id=user_id)
            if chat.workspace_id != workspace.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Thread does not belong to this workspace.",
                )
            return chat.id

        existing_chat_id = workspace.active_chat_id
        if existing_chat_id:
            existing_chat = await self._get_chat(
                thread_id=existing_chat_id,
                user_id=user_id,
            )
            return existing_chat.id

        new_chat = WorkspaceChat(
            id=f"thread_{uuid4().hex}",
            user_id=user_id,
            workspace_id=workspace.id,
            title="Documents",
            metadata_json={},
            status_json={"type": "active"},
            allowed_image_domains_json=None,
            updated_sequence=1,
        )
        self.db.add(new_chat)
        workspace.active_chat_id = new_chat.id
        await self.db.commit()
        return new_chat.id

    def serialize_stored_file(self, record: StoredFile) -> StoredFileSummary:
        return StoredFileSummary(
            id=record.id,
            storage_provider=record.storage_provider,
            storage_key=record.storage_key,
            scope=record.scope,  # type: ignore[arg-type]
            source_kind=record.source_kind,  # type: ignore[arg-type]
            app_id=record.app_id,
            workspace_id=record.workspace_id,
            thread_id=record.thread_id,
            attachment_id=record.attachment_id,
            parent_file_id=record.parent_file_id,
            name=record.name,
            kind=record.kind,  # type: ignore[arg-type]
            extension=record.extension,
            mime_type=record.mime_type,
            byte_size=record.byte_size,
            status=record.status,  # type: ignore[arg-type]
            preview=self._preview_from_json(record.preview_json),
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )

    def serialize_document_file(self, record: StoredFile) -> DocumentFileSummary:
        summary = self.serialize_stored_file(record)
        return DocumentFileSummary.model_validate(summary.model_dump())

    def build_public_preview_url(
        self,
        record: StoredFile,
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

    def build_public_content_url(
        self,
        record: StoredFile,
        *,
        inline: bool = True,
    ) -> str:
        return self.bucket_service.build_presigned_download_url(
            key=record.storage_key,
            filename=record.name,
            mime_type=record.mime_type,
            inline=inline,
        )

    async def get_preview_file(
        self,
        *,
        file_id: str,
        token: str,
    ) -> StoredFile:
        record = await self.db.get(StoredFile, file_id)
        if record is None or record.status == "deleted" or record.kind != "image":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stored file preview not found.",
            )
        self._assert_preview_token(record, token)
        return record

    async def finalize_pending_attachment(
        self,
        *,
        user_id: str,
        workspace_id: str,
        app_id: str,
        thread_id: str | None,
        attachment_id: str,
        scope: StoredFileScope,
        file_name: str,
        mime_type: str | None,
        declared_size: int,
        storage_key: str,
    ) -> StoredFile:
        workspace = await self._get_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id=app_id,
        )
        self._validate_workspace_upload_constraints(
            workspace=workspace,
            file_name=file_name,
            mime_type=mime_type,
            byte_size=declared_size,
            scope=scope,
        )
        metadata = await self.bucket_service.head_object(key=storage_key)
        if metadata.content_length != declared_size:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Attachment upload size did not match the initialized file metadata.",
            )
        file_bytes = await self.bucket_service.get_object_bytes(key=storage_key)
        return await self._create_stored_file_record(
            user_id=user_id,
            app_id=app_id,
            workspace_id=workspace_id,
            thread_id=thread_id,
            attachment_id=attachment_id,
            scope=scope,
            source_kind="upload",
            parent_file_id=None,
            file_name=file_name,
            mime_type=mime_type,
            file_bytes=file_bytes,
            preview_json=None,
            storage_key=storage_key,
        )

    async def _store_file_bytes(
        self,
        *,
        user_id: str,
        app_id: str | None,
        workspace_id: str | None,
        thread_id: str | None,
        attachment_id: str | None,
        scope: StoredFileScope,
        source_kind: StoredFileSourceKind,
        parent_file_id: str | None,
        file_name: str,
        mime_type: str | None,
        file_bytes: bytes,
        preview_json: dict[str, object] | None = None,
    ) -> StoredFile:
        resolved_mime_type = mime_type or mimetypes.guess_type(file_name)[0]
        byte_size = len(file_bytes)
        self._validate_max_bytes(scope=scope, byte_size=byte_size)
        storage_key = self.bucket_service.build_object_key(
            scope=scope,
            attachment_id=attachment_id,
        )
        await self.bucket_service.put_object_bytes(
            key=storage_key,
            file_bytes=file_bytes,
            mime_type=resolved_mime_type,
        )
        return await self._create_stored_file_record(
            user_id=user_id,
            app_id=app_id,
            workspace_id=workspace_id,
            thread_id=thread_id,
            attachment_id=attachment_id,
            scope=scope,
            source_kind=source_kind,
            parent_file_id=parent_file_id,
            file_name=file_name,
            mime_type=resolved_mime_type,
            file_bytes=file_bytes,
            preview_json=preview_json,
            storage_key=storage_key,
        )

    async def _create_stored_file_record(
        self,
        *,
        user_id: str,
        app_id: str | None,
        workspace_id: str | None,
        thread_id: str | None,
        attachment_id: str | None,
        scope: StoredFileScope,
        source_kind: StoredFileSourceKind,
        parent_file_id: str | None,
        file_name: str,
        mime_type: str | None,
        file_bytes: bytes,
        preview_json: dict[str, object] | None,
        storage_key: str,
    ) -> StoredFile:
        resolved_mime_type = mime_type or mimetypes.guess_type(file_name)[0]
        byte_size = len(file_bytes)
        extension = _extension_for_name(file_name)
        kind = _kind_for_file(file_name=file_name, mime_type=resolved_mime_type)
        preview = self._build_preview(
            kind=kind,
            mime_type=resolved_mime_type,
            file_bytes=file_bytes,
            preview_json=preview_json,
        )
        record = StoredFile(
            id=f"file_{uuid4().hex}",
            user_id=user_id,
            app_id=app_id,
            workspace_id=workspace_id,
            thread_id=thread_id,
            attachment_id=attachment_id,
            scope=scope,
            source_kind=source_kind,
            parent_file_id=parent_file_id,
            storage_provider=DEFAULT_STORAGE_PROVIDER,
            storage_key=storage_key,
            name=file_name,
            kind=kind,
            extension=extension,
            mime_type=resolved_mime_type,
            byte_size=byte_size,
            status="available",
            preview_json=preview.model_dump(),
        )
        self.db.add(record)
        await self.db.commit()
        await self.db.refresh(record)
        log_event(
            logger,
            logging.INFO,
            "stored_file.uploaded",
            summary=summarize_pairs_for_log(
                (
                    ("scope", scope),
                    ("kind", kind),
                    ("bytes", byte_size),
                    ("thread", thread_id or "none"),
                )
            ),
        )
        return record

    async def _delete_file_record(
        self,
        record: StoredFile,
        *,
        commit: bool = True,
    ) -> None:
        try:
            await self.bucket_service.delete_object(key=record.storage_key)
        except Exception:
            log_event(
                logger,
                logging.WARNING,
                "stored_file.remote_delete_failed",
                summary=summarize_pairs_for_log((("file", record.id),)),
            )
        record.status = "deleted"
        if record.attachment_id:
            attachment = await self.db.get(
                WorkspaceWorkspaceChatAttachment,
                record.attachment_id,
            )
            if attachment is not None:
                await self.db.delete(attachment)
        if commit:
            await self.db.commit()

    async def _get_workspace(
        self,
        *,
        user_id: str,
        workspace_id: str,
        app_id: str,
    ) -> Workspace:
        workspace = await self.db.get(Workspace, workspace_id)
        if workspace is None or workspace.user_id != user_id or workspace.app_id != app_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workspace not found.",
            )
        return workspace

    async def _get_chat(self, *, thread_id: str, user_id: str) -> WorkspaceChat:
        chat = await self.db.get(WorkspaceChat, thread_id)
        if chat is None or chat.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Thread not found.",
            )
        return chat

    def _build_preview(
        self,
        *,
        kind: StoredFileKind,
        mime_type: str | None,
        file_bytes: bytes,
        preview_json: dict[str, object] | None = None,
    ) -> StoredFilePreview:
        if preview_json is not None:
            validated_preview = self._preview_from_json(preview_json)
            preview_kind = validated_preview.kind
            if preview_kind == "empty":
                return validated_preview
            if kind == "pdf" and preview_kind == "pdf":
                return validated_preview
            if kind in {"csv", "json"} and preview_kind == "dataset":
                return validated_preview
            if kind == "image" and preview_kind == "image":
                return validated_preview
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="preview_json did not match the uploaded file kind.",
            )
        del mime_type
        if kind == "pdf":
            return EmptyStoredFilePreview()
        if kind == "image":
            from PIL import Image

            with Image.open(BytesIO(file_bytes)) as image:
                width, height = image.size
            return ImageStoredFilePreview(width=width, height=height)
        if kind in {"csv", "json"}:
            rows = _load_dataset_rows(kind=kind, file_bytes=file_bytes)
            columns = list(rows[0].keys()) if rows else []
            numeric_columns = [
                column
                for column in columns
                if all(_is_number(row.get(column)) for row in rows[:16] if column in row)
            ]
            return DatasetStoredFilePreview(
                row_count=len(rows),
                columns=columns,
                numeric_columns=numeric_columns,
            )
        return EmptyStoredFilePreview()

    def _preview_from_json(self, preview_json: dict) -> StoredFilePreview:
        preview_kind = preview_json.get("kind")
        if preview_kind == "pdf":
            return PdfStoredFilePreview.model_validate(preview_json)
        if preview_kind == "dataset":
            return DatasetStoredFilePreview.model_validate(preview_json)
        if preview_kind == "image":
            return ImageStoredFilePreview.model_validate(preview_json)
        return EmptyStoredFilePreview.model_validate(preview_json or {})

    def _validate_workspace_upload(
        self,
        *,
        workspace: Workspace,
        file_name: str,
        mime_type: str | None,
        file_bytes: bytes,
        scope: StoredFileScope,
    ) -> None:
        self._validate_workspace_upload_constraints(
            workspace=workspace,
            file_name=file_name,
            mime_type=mime_type,
            byte_size=len(file_bytes),
            scope=scope,
        )

    def _validate_workspace_upload_constraints(
        self,
        *,
        workspace: Workspace,
        file_name: str,
        mime_type: str | None,
        byte_size: int,
        scope: StoredFileScope,
    ) -> None:
        self._validate_max_bytes(scope=scope, byte_size=byte_size)
        if workspace.app_id != "plodai" or scope != "chat_attachment":
            return

        kind = _kind_for_file(file_name=file_name, mime_type=mime_type)
        if kind != "image":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="PlodAI chat attachments must be image files.",
            )
        if byte_size > self.settings.plodai_chat_attachment_max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="PlodAI chat attachments must be 10 MB or smaller.",
            )

    def _validate_max_bytes(
        self,
        *,
        scope: StoredFileScope,
        byte_size: int,
    ) -> None:
        max_bytes = (
            self.settings.document_thread_max_bytes
            if scope == "document_thread_file"
            else self.settings.chat_attachment_max_model_bytes
        )
        if byte_size > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=(
                    "The selected file is too large for this upload path."
                    if scope == "chat_attachment"
                    else "The selected document exceeds the document upload size limit."
                ),
            )

    async def build_attachment_display_payload(
        self,
        *,
        stored_file: StoredFile,
        attachment_id: str,
        scope: StoredFileScope,
        thread_id: str | None,
        public_base_url: str | None = None,
    ) -> Attachment:
        canonical_attachment = build_canonical_attachment(
            stored_file=stored_file,
            attachment_id=attachment_id,
            scope=scope,
            thread_id=thread_id,
        )
        preview_url = (
            self.build_public_preview_url(
                stored_file,
                public_base_url=public_base_url,
            )
            if stored_file.kind == "image"
            else None
        )
        return build_display_attachment(
            canonical_attachment=canonical_attachment,
            file_bytes=None,
            preview_url=preview_url,
        )

    def _build_preview_token(self, record: StoredFile) -> str:
        expires_at = (
            datetime.now(UTC)
            + timedelta(seconds=self.settings.storage_bucket_download_url_ttl_seconds)
        )
        expires_ts = int(expires_at.timestamp())
        payload = f"{record.id}:{record.user_id}:{expires_ts}"
        signature = hmac.new(
            self._preview_secret(),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        encoded = urlsafe_b64encode(f"{expires_ts}:{signature}".encode("utf-8"))
        return encoded.decode("utf-8").rstrip("=")

    def _assert_preview_token(self, record: StoredFile, token: str) -> None:
        padded_token = token + "=" * (-len(token) % 4)
        try:
            decoded = urlsafe_b64decode(padded_token.encode("utf-8")).decode("utf-8")
            expires_raw, signature = decoded.split(":", 1)
            expires_ts = int(expires_raw)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stored file preview not found.",
            ) from exc

        if expires_ts <= int(datetime.now(UTC).timestamp()):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stored file preview has expired.",
            )

        payload = f"{record.id}:{record.user_id}:{expires_ts}"
        expected_signature = hmac.new(
            self._preview_secret(),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected_signature):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stored file preview not found.",
            )

    def _preview_secret(self) -> bytes:
        secret = (
            self.settings.CLERK_SECRET_KEY
            or self.settings.CLERK_JWT_KEY
            or self.settings.OPENAI_API_KEY
            or "ai-portfolio-preview-secret"
        )
        return secret.encode("utf-8")


def _extension_for_name(file_name: str) -> str:
    suffix = PurePosixPath(file_name).suffix
    return suffix[1:].lower() if suffix.startswith(".") else ""


def _kind_for_file(
    *,
    file_name: str,
    mime_type: str | None,
) -> StoredFileKind:
    extension = _extension_for_name(file_name)
    if extension == "csv" or mime_type == "text/csv":
        return "csv"
    if extension == "json" or mime_type == "application/json":
        return "json"
    if extension == "pdf" or mime_type == "application/pdf":
        return "pdf"
    if extension in {"png", "jpg", "jpeg", "webp"}:
        return "image"
    if mime_type and mime_type.startswith("image/"):
        return "image"
    return "other"


def _load_dataset_rows(
    *,
    kind: Literal["csv", "json"],
    file_bytes: bytes,
) -> list[dict[str, object]]:
    if kind == "csv":
        text = file_bytes.decode("utf-8", errors="replace")
        reader = csv.DictReader(StringIO(text))
        return [
            {str(key): _coerce_dataset_value(value) for key, value in row.items() if key}
            for row in reader
        ]
    payload = json.loads(file_bytes.decode("utf-8", errors="replace"))
    if isinstance(payload, list):
        return [
            {
                str(key): value
                for key, value in item.items()
                if isinstance(key, str)
            }
            for item in payload
            if isinstance(item, dict)
        ]
    return []


def _coerce_dataset_value(value: object) -> object:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        return ""
    try:
        if "." in stripped:
            return float(stripped)
        return int(stripped)
    except ValueError:
        return stripped


def _is_number(value: object) -> bool:
    return isinstance(value, int | float)
