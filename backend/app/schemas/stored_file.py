from __future__ import annotations

from typing import Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StoredFileSchemaBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


StoredFileKind: TypeAlias = Literal["csv", "json", "pdf", "image", "other"]
StoredFileScope: TypeAlias = Literal["chat_attachment", "document_thread_file"]
StoredFileSourceKind: TypeAlias = Literal["upload", "url_import", "derived"]
StoredFileStatus: TypeAlias = Literal["available", "deleted", "expired"]
AttachmentInputKind: TypeAlias = Literal["file", "image"]
DocumentLocatorKind: TypeAlias = Literal["text", "form_field", "visual"]
DocumentLocatorReliability: TypeAlias = Literal["high", "medium", "low"]
DocumentEditStrategy: TypeAlias = Literal[
    "direct_replace",
    "overlay_replace",
    "form_fill",
    "visual_replace",
    "visual_append",
    "appendix_append",
    "smart_split",
]


class EmptyStoredFilePreview(StoredFileSchemaBase):
    kind: Literal["empty"] = "empty"


class DatasetStoredFilePreview(StoredFileSchemaBase):
    kind: Literal["dataset"] = "dataset"
    row_count: int = Field(ge=0)
    columns: list[str]
    numeric_columns: list[str] = Field(default_factory=list)


class PdfStoredFilePreview(StoredFileSchemaBase):
    kind: Literal["pdf"] = "pdf"
    page_count: int = Field(ge=0)


class ImageStoredFilePreview(StoredFileSchemaBase):
    kind: Literal["image"] = "image"
    width: int = Field(ge=0)
    height: int = Field(ge=0)


StoredFilePreview: TypeAlias = (
    EmptyStoredFilePreview
    | DatasetStoredFilePreview
    | PdfStoredFilePreview
    | ImageStoredFilePreview
)


class StoredFileSummary(StoredFileSchemaBase):
    id: str
    openai_file_id: str
    scope: StoredFileScope
    source_kind: StoredFileSourceKind
    app_id: str | None = None
    workspace_id: str | None = None
    thread_id: str | None = None
    attachment_id: str | None = None
    parent_file_id: str | None = None
    name: str
    kind: StoredFileKind
    extension: str
    mime_type: str | None = None
    byte_size: int | None = Field(default=None, ge=0)
    status: StoredFileStatus
    preview: StoredFilePreview
    expires_at: str | None = None
    created_at: str
    updated_at: str


class DocumentFileSummary(StoredFileSummary):
    scope: Literal["document_thread_file"] = "document_thread_file"
    thread_id: str


class StoredFileContentResponse(StoredFileSchemaBase):
    file: StoredFileSummary


class SerializedFileChatAttachment(StoredFileSchemaBase):
    type: Literal["file"] = "file"
    id: str
    name: str
    mime_type: str


class SerializedImageChatAttachment(StoredFileSchemaBase):
    type: Literal["image"] = "image"
    id: str
    name: str
    mime_type: str
    preview_url: str


SerializedChatAttachment: TypeAlias = (
    SerializedFileChatAttachment | SerializedImageChatAttachment
)


class ChatAttachmentUploadResponse(StoredFileSchemaBase):
    attachment: SerializedChatAttachment | None = None
    stored_file: StoredFileSummary
    thread_id: str | None = None


class ChatAttachmentDeleteResponse(StoredFileSchemaBase):
    attachment_id: str
    deleted: bool


class DocumentImportHeader(StoredFileSchemaBase):
    name: str
    value: str

    @model_validator(mode="after")
    def _validate_name(self) -> "DocumentImportHeader":
        if not self.name.strip():
            raise ValueError("header name must be non-empty")
        return self


class DocumentUrlImportRequest(StoredFileSchemaBase):
    workspace_id: str
    thread_id: str | None = None
    url: str
    headers: list[DocumentImportHeader] = Field(default_factory=list)


class DocumentFileListResponse(StoredFileSchemaBase):
    thread_id: str
    files: list[DocumentFileSummary]


class DeleteDocumentFileResponse(StoredFileSchemaBase):
    thread_id: str
    file_id: str
    deleted: bool


class DocumentLocatorBox(StoredFileSchemaBase):
    x0: float
    y0: float
    x1: float
    y1: float


class DocumentLocator(StoredFileSchemaBase):
    id: str
    kind: DocumentLocatorKind
    label: str
    page_number: int = Field(ge=1)
    reliability: DocumentLocatorReliability
    bbox: DocumentLocatorBox
    text_preview: str | None = None


class DocumentPageSummary(StoredFileSchemaBase):
    page_number: int = Field(ge=1)
    summary: str


class DocumentInspectionResult(StoredFileSchemaBase):
    file: DocumentFileSummary
    page_count: int = Field(ge=0)
    locators: list[DocumentLocator]
    page_summaries: list[DocumentPageSummary]


class DocumentFieldValue(StoredFileSchemaBase):
    locator_id: str
    value: str


class DocumentEditResult(StoredFileSchemaBase):
    file: DocumentFileSummary
    parent_file_id: str
    strategy_used: DocumentEditStrategy
    message: str
    warning: str | None = None
    unresolved_locator_ids: list[str] = Field(default_factory=list)


class DocumentSplitEntry(StoredFileSchemaBase):
    file: DocumentFileSummary
    title: str
    start_page: int = Field(ge=1)
    end_page: int = Field(ge=1)
    page_count: int = Field(ge=1)


class DocumentSmartSplitResult(StoredFileSchemaBase):
    source_file: DocumentFileSummary
    archive_file: DocumentFileSummary
    index_file: DocumentFileSummary
    entries: list[DocumentSplitEntry]
    markdown: str
