import { publishPaymentRequiredToast } from "../app/toasts";
import type { AgricultureEntitySearchResponse } from "../types/chat-entities";
import type {
  ChatAttachmentDeleteResponse,
  ChatAttachmentUploadResponse,
  DeleteDocumentFileResponse,
  DocumentFileListResponse,
  DocumentImportHeader,
  SerializedChatAttachment,
} from "../types/stored-file";
import type { WorkspaceAppId } from "../types/workspace";

const API_BASE_URL = normalizeBase(import.meta.env.VITE_API_BASE_URL ?? "/api");
const CHATKIT_URL = import.meta.env.VITE_CHATKIT_URL ?? deriveChatKitUrl(API_BASE_URL);
const CHATKIT_DOMAIN_KEY = "domain_pk_69b2a0ec9ebc8196b1893307126bc3940346bce2224e586b";
let clerkTokenGetter: (() => Promise<string | null>) | null = null;
let chatKitMetadataGetter: (() => Record<string, unknown> | null) | null = null;
let chatKitNativeFeedbackHandler:
  | ((payload: ChatKitNativeFeedbackPayload) => Promise<void> | void)
  | null = null;
let chatKitAttachmentHandler:
  | ((payload: ChatKitAttachmentCreatePayload) => Promise<ChatKitAttachmentResult> | ChatKitAttachmentResult)
  | null = null;
let chatKitAttachmentDeleteHandler:
  | ((payload: ChatKitLocalAttachmentRecord) => Promise<void> | void)
  | null = null;

type PendingChatKitLocalFile = {
  file: File;
};

export type ChatKitNativeFeedbackKind = "positive" | "negative";

export type ChatKitNativeFeedbackPayload = {
  threadId: string;
  itemIds: string[];
  kind: ChatKitNativeFeedbackKind;
};

export type ChatKitAttachmentCreatePayload = {
  attachmentId: string;
  file: File;
};

export type ChatKitAttachmentResult = {
  attachment?: SerializedChatAttachment;
  fileIds?: string[];
  threadId?: string | null;
  stripBeforeForwarding?: boolean;
};

export type ChatKitLocalAttachmentRecord = {
  attachmentId: string;
  file: File | null;
  mimeType: string;
  name: string;
  previewUrl: string | null;
  fileIds: string[];
  stripBeforeForwarding: boolean;
};

const pendingChatKitFiles: PendingChatKitLocalFile[] = [];
const localChatKitAttachments = new Map<string, ChatKitLocalAttachmentRecord>();

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function setClerkTokenGetter(getter: (() => Promise<string | null>) | null): void {
  clerkTokenGetter = getter;
}

export function setChatKitMetadataGetter(getter: (() => Record<string, unknown> | null) | null): void {
  chatKitMetadataGetter = getter;
}

export function setChatKitNativeFeedbackHandler(
  handler: ((payload: ChatKitNativeFeedbackPayload) => Promise<void> | void) | null,
): void {
  chatKitNativeFeedbackHandler = handler;
}

export function setChatKitAttachmentHandler(
  handler:
    | ((payload: ChatKitAttachmentCreatePayload) => Promise<ChatKitAttachmentResult> | ChatKitAttachmentResult)
    | null,
  deleteHandler:
    | ((payload: ChatKitLocalAttachmentRecord) => Promise<void> | void)
    | null = null,
): void {
  chatKitAttachmentHandler = handler;
  chatKitAttachmentDeleteHandler = deleteHandler;
  if (!handler) {
    clearChatKitAttachmentState();
  }
}

export function registerChatKitLocalFiles(files: Iterable<File>): void {
  for (const file of files) {
    pendingChatKitFiles.push({ file });
  }
}

export function getChatKitConfig() {
  return {
    url: CHATKIT_URL,
    domainKey: CHATKIT_DOMAIN_KEY,
  };
}

export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  const token = (await clerkTokenGetter?.()) ?? null;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const nextInit = maybeAttachChatKitMetadata(input, init);
  const interceptedAttachmentRequest = await maybeHandleChatKitAttachmentRequest(
    input,
    nextInit,
  );
  if (interceptedAttachmentRequest) {
    return interceptedAttachmentRequest;
  }

  const interceptedNativeFeedback = await maybeHandleChatKitNativeFeedback(
    input,
    nextInit,
  );
  if (interceptedNativeFeedback) {
    return interceptedNativeFeedback;
  }

  const forwardedInit = maybeStripChatKitLocalAttachments(input, nextInit);
  const response = await fetch(input, {
    ...forwardedInit,
    headers,
  });
  if (response.status === 402) {
    void notifyPaymentRequired(response.clone());
  }
  return response;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await authenticatedFetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw await buildApiError(response);
  }

  return (await response.json()) as T;
}

export async function uploadStoredFile(params: {
  file: File;
  workspaceId: string;
  appId: WorkspaceAppId;
  scope: "chat_attachment" | "document_thread_file";
  attachmentId?: string;
  threadId?: string | null;
  createAttachment?: boolean;
}): Promise<ChatAttachmentUploadResponse> {
  const formData = new FormData();
  formData.set("workspace_id", params.workspaceId);
  formData.set("app_id", params.appId);
  formData.set("scope", params.scope);
  formData.set("create_attachment", String(params.createAttachment ?? true));
  if (params.attachmentId) {
    formData.set("attachment_id", params.attachmentId);
  }
  if (params.threadId) {
    formData.set("thread_id", params.threadId);
  }
  formData.set("file", params.file, params.file.name);
  const response = await authenticatedFetch(`${API_BASE_URL}/chatkit/attachments/upload`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return (await response.json()) as ChatAttachmentUploadResponse;
}

export async function deleteStoredChatAttachment(
  attachmentId: string,
): Promise<ChatAttachmentDeleteResponse> {
  return apiRequest<ChatAttachmentDeleteResponse>(`/chatkit/attachments/${attachmentId}`, {
    method: "DELETE",
  });
}

export async function searchAgricultureEntities(params: {
  appId: WorkspaceAppId;
  workspaceId: string;
  threadId: string;
  query: string;
}): Promise<AgricultureEntitySearchResponse> {
  return apiRequest<AgricultureEntitySearchResponse>("/agriculture/entities/search", {
    method: "POST",
    body: JSON.stringify({
      app_id: params.appId,
      workspace_id: params.workspaceId,
      thread_id: params.threadId,
      query: params.query,
    }),
  });
}

export async function importDocumentFileFromUrl(params: {
  workspaceId: string;
  threadId?: string | null;
  url: string;
  headers: DocumentImportHeader[];
}): Promise<ChatAttachmentUploadResponse> {
  return apiRequest<ChatAttachmentUploadResponse>("/document-threads/import-url", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: params.workspaceId,
      thread_id: params.threadId ?? null,
      url: params.url,
      headers: params.headers,
    }),
  });
}

export async function listDocumentFiles(threadId: string): Promise<DocumentFileListResponse> {
  return apiRequest<DocumentFileListResponse>(`/document-threads/${threadId}/files`);
}

export async function deleteDocumentFile(
  threadId: string,
  fileId: string,
): Promise<DeleteDocumentFileResponse> {
  return apiRequest<DeleteDocumentFileResponse>(
    `/document-threads/${threadId}/files/${fileId}`,
    {
      method: "DELETE",
    },
  );
}

export async function fetchStoredFileBlob(fileId: string): Promise<Blob> {
  const response = await authenticatedFetch(`${API_BASE_URL}/stored-files/${fileId}/content`);
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return response.blob();
}

async function buildApiError(response: Response): Promise<ApiError> {
  const fallbackMessage = `Request failed with ${response.status}`;
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { detail?: unknown; message?: unknown };
    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : typeof payload.message === "string"
          ? payload.message
          : fallbackMessage;
    return new ApiError(detail, response.status);
  }

  const text = (await response.text()).trim();
  return new ApiError(text || fallbackMessage, response.status);
}

function deriveChatKitUrl(apiBaseUrl: string): string {
  if (apiBaseUrl.endsWith("/api")) {
    return `${apiBaseUrl.slice(0, -4)}/chatkit`;
  }
  return `${apiBaseUrl}/chatkit`;
}

function normalizeBase(baseUrl: string): string {
  if (baseUrl === "/api") {
    return baseUrl;
  }
  return baseUrl.replace(/\/$/, "");
}

async function notifyPaymentRequired(response: Response): Promise<void> {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: unknown };
      publishPaymentRequiredToast(typeof payload.detail === "string" ? payload.detail : undefined);
      return;
    }
    publishPaymentRequiredToast();
  } catch {
    publishPaymentRequiredToast();
  }
}

function maybeAttachChatKitMetadata(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  if (!isChatKitRequest(input) || typeof init?.body !== "string") {
    return init;
  }

  const metadata = chatKitMetadataGetter?.();
  if (!metadata || !Object.keys(metadata).length) {
    return init;
  }

  try {
    const payload = JSON.parse(init.body) as { metadata?: Record<string, unknown> };
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return init;
    }

    return {
      ...init,
      body: JSON.stringify({
        ...payload,
        metadata: {
          ...(typeof payload.metadata === "object" && payload.metadata && !Array.isArray(payload.metadata)
            ? payload.metadata
            : {}),
          ...metadata,
        },
      }),
    };
  } catch {
    return init;
  }
}

async function maybeHandleChatKitAttachmentRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response | null> {
  if (!isChatKitRequest(input) || typeof init?.body !== "string") {
    return null;
  }

  const createPayload = parseChatKitAttachmentCreateRequest(init.body);
  if (createPayload) {
    if (!chatKitAttachmentHandler) {
      return buildJsonResponse(
        { detail: "Local attachments are not available for this surface." },
        400,
      );
    }

    const file = consumePendingChatKitFile(createPayload);
    if (!file) {
      return buildJsonResponse(
        { detail: "Unable to resolve the selected attachment locally." },
        400,
      );
    }

    const attachmentId = nextLocalAttachmentId();
    const attachmentResult = await chatKitAttachmentHandler({
      attachmentId,
      file,
    });
    const previewUrl = buildAttachmentPreviewUrl(file);
    const record: ChatKitLocalAttachmentRecord = {
      attachmentId,
      file: attachmentResult.stripBeforeForwarding === false ? null : file,
      mimeType: createPayload.mimeType,
      name: createPayload.name,
      previewUrl,
      fileIds: attachmentResult.fileIds ?? [],
      stripBeforeForwarding: attachmentResult.stripBeforeForwarding ?? true,
    };
    const defaultAttachmentPayload = serializeLocalAttachment(record);
    const attachmentPayload =
      previewUrl &&
      attachmentResult.attachment?.type === "image" &&
      typeof attachmentResult.attachment.preview_url !== "string"
        ? {
            ...attachmentResult.attachment,
            preview_url: previewUrl,
          }
        : attachmentResult.attachment ?? defaultAttachmentPayload;
    localChatKitAttachments.set(attachmentId, record);
    return buildJsonResponse(attachmentPayload);
  }

  const deletePayload = parseChatKitAttachmentDeleteRequest(init.body);
  if (!deletePayload) {
    return null;
  }

  const record = localChatKitAttachments.get(deletePayload.attachmentId);
  if (!record) {
    return buildJsonResponse({});
  }

  await chatKitAttachmentDeleteHandler?.(record);
  releaseLocalAttachment(record);
  return buildJsonResponse({});
}

async function maybeHandleChatKitNativeFeedback(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response | null> {
  if (!chatKitNativeFeedbackHandler || !isChatKitRequest(input) || typeof init?.body !== "string") {
    return null;
  }

  const payload = parseChatKitNativeFeedbackPayload(init.body);
  if (!payload) {
    return null;
  }

  await chatKitNativeFeedbackHandler(payload);
  return buildJsonResponse({});
}

function maybeStripChatKitLocalAttachments(
  input: RequestInfo | URL,
  init?: RequestInit,
): RequestInit | undefined {
  if (!isChatKitRequest(input) || typeof init?.body !== "string") {
    return init;
  }

  try {
    const payload = JSON.parse(init.body) as {
      type?: unknown;
      params?: {
        input?: {
          attachments?: unknown;
        };
      };
    };
    if (
      payload?.type !== "threads.create" &&
      payload?.type !== "threads.add_user_message"
    ) {
      return init;
    }

    const attachments = Array.isArray(payload.params?.input?.attachments)
      ? payload.params?.input?.attachments.filter((value): value is string => typeof value === "string")
      : [];
    if (!attachments.length) {
      return init;
    }

    const matchedRecords = attachments
      .map((attachmentId) => localChatKitAttachments.get(attachmentId))
      .filter((record): record is ChatKitLocalAttachmentRecord => Boolean(record));
    if (!matchedRecords.length) {
      return init;
    }

    const remainingAttachments = attachments.filter(
      (attachmentId) =>
        !localChatKitAttachments.get(attachmentId)?.stripBeforeForwarding,
    );
    for (const record of matchedRecords) {
      releaseLocalAttachment(record);
    }

    return {
      ...init,
      body: JSON.stringify({
        ...payload,
        params: {
          ...payload.params,
          input: {
            ...payload.params?.input,
            attachments: remainingAttachments,
          },
        },
      }),
    };
  } catch {
    return init;
  }
}

function parseChatKitAttachmentCreateRequest(
  body: string,
): { name: string; size: number; mimeType: string } | null {
  try {
    const payload = JSON.parse(body) as {
      type?: unknown;
      params?: {
        name?: unknown;
        size?: unknown;
        mime_type?: unknown;
      };
    };
    if (payload?.type !== "attachments.create") {
      return null;
    }
    const name = typeof payload.params?.name === "string" ? payload.params.name.trim() : "";
    const size = typeof payload.params?.size === "number" ? payload.params.size : -1;
    const mimeType =
      typeof payload.params?.mime_type === "string" ? payload.params.mime_type.trim() : "";
    if (!name || size < 0 || !mimeType) {
      return null;
    }
    return {
      name,
      size,
      mimeType,
    };
  } catch {
    return null;
  }
}

function parseChatKitAttachmentDeleteRequest(
  body: string,
): { attachmentId: string } | null {
  try {
    const payload = JSON.parse(body) as {
      type?: unknown;
      params?: {
        attachment_id?: unknown;
      };
    };
    if (payload?.type !== "attachments.delete") {
      return null;
    }
    const attachmentId =
      typeof payload.params?.attachment_id === "string"
        ? payload.params.attachment_id.trim()
        : "";
    return attachmentId ? { attachmentId } : null;
  } catch {
    return null;
  }
}

function parseChatKitNativeFeedbackPayload(body: string): ChatKitNativeFeedbackPayload | null {
  try {
    const payload = JSON.parse(body) as {
      type?: unknown;
      params?: {
        thread_id?: unknown;
        item_ids?: unknown;
        kind?: unknown;
      };
    };

    if (payload?.type !== "items.feedback") {
      return null;
    }

    const threadId =
      typeof payload.params?.thread_id === "string" ? payload.params.thread_id.trim() : "";
    const itemIds = Array.isArray(payload.params?.item_ids)
      ? payload.params.item_ids.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [];
    const kind = normalizeChatKitNativeFeedbackKind(payload.params?.kind);

    if (!threadId || !itemIds.length || !kind) {
      return null;
    }

    return {
      threadId,
      itemIds,
      kind,
    };
  } catch {
    return null;
  }
}

function normalizeChatKitNativeFeedbackKind(value: unknown): ChatKitNativeFeedbackKind | null {
  return value === "positive" || value === "negative" ? value : null;
}

function isChatKitRequest(input: RequestInfo | URL): boolean {
  const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return normalizeRequestPath(requestUrl) === normalizeRequestPath(CHATKIT_URL);
}

function normalizeRequestPath(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname.replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}

function matchesPendingFile(
  file: File,
  payload: { name: string; size: number; mimeType: string },
): boolean {
  if (file.name !== payload.name || file.size !== payload.size) {
    return false;
  }
  if (!payload.mimeType) {
    return true;
  }
  return !file.type || file.type === payload.mimeType;
}

function consumePendingChatKitFile(
  payload: { name: string; size: number; mimeType: string },
): File | null {
  const matchingIndex = pendingChatKitFiles.findIndex(({ file }) => matchesPendingFile(file, payload));
  if (matchingIndex < 0) {
    return null;
  }
  const [record] = pendingChatKitFiles.splice(matchingIndex, 1);
  return record?.file ?? null;
}

function nextLocalAttachmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `local_atc_${crypto.randomUUID()}`;
  }
  return `local_atc_${Math.random().toString(36).slice(2, 12)}`;
}

function buildAttachmentPreviewUrl(file: File): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }
  return file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
}

function serializeLocalAttachment(record: ChatKitLocalAttachmentRecord): Record<string, unknown> {
  if (record.previewUrl) {
    return {
      type: "image",
      id: record.attachmentId,
      name: record.name,
      mime_type: record.mimeType,
      preview_url: record.previewUrl,
    };
  }
  return {
    type: "file",
    id: record.attachmentId,
    name: record.name,
    mime_type: record.mimeType,
  };
}

function releaseLocalAttachment(record: ChatKitLocalAttachmentRecord): void {
  localChatKitAttachments.delete(record.attachmentId);
  if (record.previewUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(record.previewUrl);
  }
}

function clearChatKitAttachmentState(): void {
  pendingChatKitFiles.splice(0, pendingChatKitFiles.length);
  for (const record of localChatKitAttachments.values()) {
    if (record.previewUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(record.previewUrl);
    }
  }
  localChatKitAttachments.clear();
}

function buildJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
