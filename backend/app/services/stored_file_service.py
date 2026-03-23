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
from email.message import Message
from io import BytesIO, StringIO
from pathlib import PurePosixPath
from typing import Literal
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from chatkit.types import FileAttachment, ImageAttachment
from fastapi import HTTPException, status
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.chatkit.memory_store import DatabaseMemoryStore
from backend.app.core.config import Settings, get_settings
from backend.app.core.logging import get_logger, log_event, summarize_pairs_for_log
from backend.app.models.chatkit import WorkspaceChat, WorkspaceWorkspaceChatAttachment
from backend.app.models.stored_file import StoredOpenAIFile
from backend.app.models.workspace import Workspace
from backend.app.schemas.stored_file import (
    ChatAttachmentDeleteResponse,
    ChatAttachmentUploadResponse,
    DatasetStoredFilePreview,
    DeleteDocumentFileResponse,
    DocumentFileListResponse,
    DocumentFileSummary,
    DocumentImportHeader,
    EmptyStoredFilePreview,
    ImageStoredFilePreview,
    PdfStoredFilePreview,
    SerializedChatAttachment,
    SerializedFileChatAttachment,
    SerializedImageChatAttachment,
    StoredFileKind,
    StoredFilePreview,
    StoredFileScope,
    StoredFileSourceKind,
    StoredFileSummary,
)

logger = get_logger("services.stored_file")


@dataclass(kw_only=True)
class StoredUploadResult:
    stored_file: StoredOpenAIFile
    thread_id: str | None = None


class StoredFileService:
    def __init__(
        self,
        db: AsyncSession,
        *,
        openai_client: AsyncOpenAI | None = None,
        settings: Settings | None = None,
    ):
        self.db = db
        self.settings = settings or get_settings()
        self.openai_client = openai_client or AsyncOpenAI(
            api_key=self.settings.OPENAI_API_KEY or None,
            max_retries=self.settings.openai_max_retries,
        )

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

        stored_file = await self._upload_file_bytes(
            user_id=user_id,
            app_id=workspace.app_id,
            workspace_id=workspace.id,
            thread_id=ensured_thread_id,
            attachment_id=attachment_id if create_attachment else None,
            scope=scope,
            source_kind="upload",
            parent_file_id=None,
            file_name=file_name,
            mime_type=mime_type,
            file_bytes=file_bytes,
        )
        serialized_attachment: SerializedChatAttachment | None = None
        if create_attachment:
            attachment = self._build_chat_attachment(
                stored_file=stored_file,
                attachment_id=attachment_id,
                scope=scope,
                thread_id=ensured_thread_id,
                public_base_url=public_base_url,
            )
            await DatabaseMemoryStore(self.db).save_attachment(
                attachment,
                context=None,
            )
            serialized_attachment = self._serialize_chat_attachment(
                stored_file=stored_file,
                attachment_id=attachment_id,
                public_base_url=public_base_url,
            )

        return ChatAttachmentUploadResponse(
            attachment=serialized_attachment,
            stored_file=self.serialize_stored_file(stored_file),
            thread_id=ensured_thread_id,
        )

    async def import_document_url(
        self,
        *,
        user_id: str,
        workspace_id: str,
        thread_id: str | None,
        url: str,
        headers: list[DocumentImportHeader],
    ) -> ChatAttachmentUploadResponse:
        workspace = await self._get_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            app_id="documents",
        )
        ensured_thread_id = await self.ensure_document_thread_id(
            user_id=user_id,
            workspace=workspace,
            thread_id=thread_id,
        )
        file_name, mime_type, file_bytes = await self._download_document_url(
            url=url,
            headers=headers,
        )
        stored_file = await self._upload_file_bytes(
            user_id=user_id,
            app_id=workspace.app_id,
            workspace_id=workspace.id,
            thread_id=ensured_thread_id,
            attachment_id=None,
            scope="document_thread_file",
            source_kind="url_import",
            parent_file_id=None,
            file_name=file_name,
            mime_type=mime_type,
            file_bytes=file_bytes,
        )
        return ChatAttachmentUploadResponse(
            attachment=None,
            stored_file=self.serialize_document_file(stored_file),
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
            select(StoredOpenAIFile)
            .where(
                StoredOpenAIFile.user_id == user_id,
                StoredOpenAIFile.thread_id == thread_id,
                StoredOpenAIFile.scope == "document_thread_file",
                StoredOpenAIFile.status != "deleted",
            )
            .order_by(StoredOpenAIFile.created_at.desc())
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
            select(StoredOpenAIFile).where(
                StoredOpenAIFile.user_id == user_id,
                StoredOpenAIFile.attachment_id == attachment_id,
            )
        )
        record = result.scalar_one_or_none()
        attachment = await self.db.get(WorkspaceWorkspaceChatAttachment, attachment_id)
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
    ) -> StoredOpenAIFile:
        record = await self.db.get(StoredOpenAIFile, file_id)
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
    ) -> StoredOpenAIFile:
        record = await self.get_stored_file(user_id=user_id, file_id=file_id)
        if record.scope != "document_thread_file" or record.thread_id != thread_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document file not found.",
            )
        return record

    async def load_file_bytes(self, record: StoredOpenAIFile) -> bytes:
        binary_response = await self.openai_client.files.content(record.openai_file_id)
        return await binary_response.aread()

    async def load_dataset_rows(self, record: StoredOpenAIFile) -> list[dict[str, object]]:
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
        parent_record: StoredOpenAIFile,
        file_name: str,
        file_bytes: bytes,
        mime_type: str | None = None,
        source_kind: StoredFileSourceKind = "derived",
    ) -> StoredOpenAIFile:
        return await self._upload_file_bytes(
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

    def serialize_stored_file(self, record: StoredOpenAIFile) -> StoredFileSummary:
        return StoredFileSummary(
            id=record.id,
            openai_file_id=record.openai_file_id,
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
            expires_at=record.expires_at.isoformat() if record.expires_at else None,
            created_at=record.created_at.isoformat(),
            updated_at=record.updated_at.isoformat(),
        )

    def serialize_document_file(self, record: StoredOpenAIFile) -> DocumentFileSummary:
        summary = self.serialize_stored_file(record)
        return DocumentFileSummary.model_validate(summary.model_dump())

    def build_public_preview_url(
        self,
        record: StoredOpenAIFile,
        *,
        public_base_url: str | None = None,
    ) -> str:
        token = self._build_preview_token(record)
        base_url = (public_base_url or "http://localhost").rstrip("/")
        return f"{base_url}/api/stored-files/{record.id}/preview?token={token}"

    async def get_preview_file(
        self,
        *,
        file_id: str,
        token: str,
    ) -> StoredOpenAIFile:
        record = await self.db.get(StoredOpenAIFile, file_id)
        if record is None or record.status == "deleted" or record.kind != "image":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stored file preview not found.",
            )
        self._assert_preview_token(record, token)
        expires_at = record.expires_at
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at and expires_at <= datetime.now(UTC):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stored file preview has expired.",
            )
        return record

    async def _upload_file_bytes(
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
    ) -> StoredOpenAIFile:
        resolved_mime_type = mime_type or mimetypes.guess_type(file_name)[0]
        extension = _extension_for_name(file_name)
        kind = _kind_for_file(file_name=file_name, mime_type=resolved_mime_type)
        byte_size = len(file_bytes)
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
        preview = self._build_preview(
            kind=kind,
            mime_type=resolved_mime_type,
            file_bytes=file_bytes,
        )
        uploaded_file = await self.openai_client.files.create(
            file=(
                file_name,
                file_bytes,
                resolved_mime_type or "application/octet-stream",
            ),
            purpose="user_data",
            expires_after={
                "anchor": "created_at",
                "seconds": self.settings.stored_file_default_expiry_seconds,
            },
        )
        expires_at = datetime.now(UTC) + timedelta(
            seconds=self.settings.stored_file_default_expiry_seconds
        )
        record = StoredOpenAIFile(
            id=f"file_{uuid4().hex}",
            user_id=user_id,
            app_id=app_id,
            workspace_id=workspace_id,
            thread_id=thread_id,
            attachment_id=attachment_id,
            scope=scope,
            source_kind=source_kind,
            parent_file_id=parent_file_id,
            openai_file_id=uploaded_file.id,
            name=file_name,
            kind=kind,
            extension=extension,
            mime_type=resolved_mime_type,
            byte_size=byte_size,
            status="available",
            preview_json=preview.model_dump(),
            expires_at=expires_at,
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

    async def _download_document_url(
        self,
        *,
        url: str,
        headers: list[DocumentImportHeader],
    ) -> tuple[str, str | None, bytes]:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only http and https URLs are supported.",
            )

        request_headers = {
            header.name.strip(): header.value
            for header in headers
            if header.name.strip()
        }
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(30.0, connect=10.0),
        ) as client:
            response = await client.get(url, headers=request_headers)
        if response.status_code >= 400:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to download the provided document URL.",
            )
        file_bytes = response.content
        if len(file_bytes) > self.settings.document_thread_max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="The downloaded document exceeds the document upload size limit.",
            )
        content_type = response.headers.get("content-type")
        file_name = _filename_from_response(url, response.headers)
        kind = _kind_for_file(file_name=file_name, mime_type=content_type)
        if kind != "pdf":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Document URL imports currently require a PDF.",
            )
        return (file_name, content_type, file_bytes)

    async def _delete_file_record(
        self,
        record: StoredOpenAIFile,
        *,
        commit: bool = True,
    ) -> None:
        try:
            await self.openai_client.files.delete(record.openai_file_id)
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
    ) -> StoredFilePreview:
        del mime_type
        if kind == "pdf":
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(file_bytes))
            return PdfStoredFilePreview(page_count=len(reader.pages))
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
        if workspace.app_id != "agriculture" or scope != "chat_attachment":
            return

        kind = _kind_for_file(file_name=file_name, mime_type=mime_type)
        if kind != "image":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Agriculture chat attachments must be image files.",
            )
        if len(file_bytes) > self.settings.agriculture_chat_attachment_max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Agriculture chat attachments must be 10 MB or smaller.",
            )

    def _build_chat_attachment(
        self,
        *,
        stored_file: StoredOpenAIFile,
        attachment_id: str,
        scope: StoredFileScope,
        thread_id: str | None,
        public_base_url: str | None,
    ) -> FileAttachment | ImageAttachment:
        metadata = {
            "stored_file_id": stored_file.id,
            "openai_file_id": stored_file.openai_file_id,
            "attach_mode": (
                "document_tool_only" if scope == "document_thread_file" else "model_input"
            ),
            "input_kind": "image" if stored_file.kind == "image" else "file",
            "byte_size": stored_file.byte_size,
            "scope": scope,
        }
        common_kwargs = {
            "id": attachment_id,
            "name": stored_file.name,
            "mime_type": stored_file.mime_type or "application/octet-stream",
            "upload_descriptor": None,
            "thread_id": thread_id,
            "metadata": metadata,
        }
        if stored_file.kind == "image":
            return ImageAttachment(
                **common_kwargs,
                preview_url=self.build_public_preview_url(
                    stored_file,
                    public_base_url=public_base_url,
                ),
            )
        return FileAttachment(**common_kwargs)

    def _serialize_chat_attachment(
        self,
        *,
        stored_file: StoredOpenAIFile,
        attachment_id: str,
        public_base_url: str | None,
    ) -> SerializedChatAttachment:
        base_fields = {
            "id": attachment_id,
            "name": stored_file.name,
            "mime_type": stored_file.mime_type or "application/octet-stream",
        }
        if stored_file.kind == "image":
            return SerializedImageChatAttachment(
                **base_fields,
                preview_url=self.build_public_preview_url(
                    stored_file,
                    public_base_url=public_base_url,
                ),
            )
        return SerializedFileChatAttachment(**base_fields)

    def _build_preview_token(self, record: StoredOpenAIFile) -> str:
        expires_at = record.expires_at or (
            datetime.now(UTC)
            + timedelta(seconds=self.settings.stored_file_default_expiry_seconds)
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

    def _assert_preview_token(self, record: StoredOpenAIFile, token: str) -> None:
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


def _filename_from_response(url: str, headers: httpx.Headers) -> str:
    disposition = headers.get("content-disposition")
    if disposition:
        message = Message()
        message["content-disposition"] = disposition
        filename = message.get_param("filename", header="content-disposition")
        if isinstance(filename, str) and filename.strip():
            return PurePosixPath(filename.strip()).name
    parsed = urlparse(url)
    candidate = PurePosixPath(parsed.path).name
    if candidate:
        return candidate
    return f"document_{uuid4().hex}.pdf"


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
