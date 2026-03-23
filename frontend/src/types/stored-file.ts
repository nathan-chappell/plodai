import type { WorkspaceAppId } from "./workspace";

export type StoredFileKind = "csv" | "json" | "pdf" | "image" | "other";
export type StoredFileScope = "chat_attachment" | "document_thread_file";
export type StoredFileSourceKind = "upload" | "url_import" | "derived";
export type StoredFileStatus = "available" | "deleted" | "expired";
export type DocumentLocatorKind = "text" | "form_field";
export type DocumentLocatorReliability = "high" | "medium" | "low";
export type DocumentEditStrategy =
  | "direct_replace"
  | "overlay_replace"
  | "form_fill"
  | "appendix_append"
  | "smart_split";

export type EmptyStoredFilePreview = {
  kind: "empty";
};

export type DatasetStoredFilePreview = {
  kind: "dataset";
  row_count: number;
  columns: string[];
  numeric_columns: string[];
};

export type PdfStoredFilePreview = {
  kind: "pdf";
  page_count: number;
};

export type ImageStoredFilePreview = {
  kind: "image";
  width: number;
  height: number;
};

export type StoredFilePreview =
  | EmptyStoredFilePreview
  | DatasetStoredFilePreview
  | PdfStoredFilePreview
  | ImageStoredFilePreview;

export type StoredFileSummary = {
  id: string;
  openai_file_id: string;
  scope: StoredFileScope;
  source_kind: StoredFileSourceKind;
  app_id?: WorkspaceAppId | null;
  workspace_id?: string | null;
  thread_id?: string | null;
  attachment_id?: string | null;
  parent_file_id?: string | null;
  name: string;
  kind: StoredFileKind;
  extension: string;
  mime_type?: string | null;
  byte_size?: number | null;
  status: StoredFileStatus;
  preview: StoredFilePreview;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentFileSummary = StoredFileSummary & {
  scope: "document_thread_file";
  thread_id: string;
};

export type SerializedFileChatAttachment = {
  type: "file";
  id: string;
  name: string;
  mime_type: string;
};

export type SerializedImageChatAttachment = {
  type: "image";
  id: string;
  name: string;
  mime_type: string;
  preview_url: string;
};

export type SerializedChatAttachment =
  | SerializedFileChatAttachment
  | SerializedImageChatAttachment;

export type ChatAttachmentUploadResponse = {
  attachment?: SerializedChatAttachment | null;
  stored_file: StoredFileSummary;
  thread_id?: string | null;
};

export type ChatAttachmentDeleteResponse = {
  attachment_id: string;
  deleted: boolean;
};

export type DocumentImportHeader = {
  name: string;
  value: string;
};

export type DocumentFileListResponse = {
  thread_id: string;
  files: DocumentFileSummary[];
};

export type DeleteDocumentFileResponse = {
  thread_id: string;
  file_id: string;
  deleted: boolean;
};

export type DocumentLocatorBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type DocumentLocator = {
  id: string;
  kind: DocumentLocatorKind;
  label: string;
  page_number: number;
  reliability: DocumentLocatorReliability;
  bbox: DocumentLocatorBox;
  text_preview?: string | null;
};

export type DocumentPageSummary = {
  page_number: number;
  summary: string;
};

export type DocumentInspectionResult = {
  file: DocumentFileSummary;
  page_count: number;
  locators: DocumentLocator[];
  page_summaries: DocumentPageSummary[];
};

export type DocumentFieldValue = {
  locator_id: string;
  value: string;
};

export type DocumentEditResult = {
  file: DocumentFileSummary;
  parent_file_id: string;
  strategy_used: DocumentEditStrategy;
  message: string;
  warning?: string | null;
  unresolved_locator_ids: string[];
};

export type DocumentSplitEntry = {
  file: DocumentFileSummary;
  title: string;
  start_page: number;
  end_page: number;
  page_count: number;
};

export type DocumentSmartSplitResult = {
  source_file: DocumentFileSummary;
  archive_file: DocumentFileSummary;
  index_file: DocumentFileSummary;
  entries: DocumentSplitEntry[];
  markdown: string;
};
