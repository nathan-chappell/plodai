import { publishPaymentRequiredToast } from "../app/toasts";
import type { PlodaiEntitySearchResponse } from "../types/chat-entities";
import type {
  ChatAttachmentDeleteResponse,
  ChatAttachmentUploadResponse,
  DeleteDocumentFileResponse,
  DocumentFileListResponse,
  StoredFilePreview,
  StoredFileSourceKind,
} from "../types/stored-file";
import type { PublicFarmOrderResponse, WorkspaceAppId } from "../types/workspace";

const API_BASE_URL = normalizeBase(import.meta.env.VITE_API_BASE_URL ?? "/api");
const CHATKIT_URL = import.meta.env.VITE_CHATKIT_URL ?? deriveChatKitUrl(API_BASE_URL);
const CHATKIT_DOMAIN_KEY = "domain_pk_69b2a0ec9ebc8196b1893307126bc3940346bce2224e586b";
let clerkTokenGetter: (() => Promise<string | null>) | null = null;
let chatKitMetadataGetter: (() => Record<string, unknown> | null) | null = null;
let chatKitNativeFeedbackHandler:
  | ((payload: ChatKitNativeFeedbackPayload) => Promise<void> | void)
  | null = null;

export type ChatKitNativeFeedbackKind = "positive" | "negative";

export type ChatKitNativeFeedbackPayload = {
  threadId: string;
  itemIds: string[];
  kind: ChatKitNativeFeedbackKind;
};

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
  const interceptedNativeFeedback = await maybeHandleChatKitNativeFeedback(
    input,
    nextInit,
  );
  if (interceptedNativeFeedback) {
    return interceptedNativeFeedback;
  }

  const response = await fetch(input, {
    ...nextInit,
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

export async function publicApiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
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
  sourceKind?: StoredFileSourceKind;
  parentFileId?: string | null;
  previewJson?: StoredFilePreview | null;
}): Promise<ChatAttachmentUploadResponse> {
  const formData = new FormData();
  formData.set("workspace_id", params.workspaceId);
  formData.set("app_id", params.appId);
  formData.set("scope", params.scope);
  formData.set("create_attachment", String(params.createAttachment ?? true));
  if (params.sourceKind) {
    formData.set("source_kind", params.sourceKind);
  }
  if (params.parentFileId) {
    formData.set("parent_file_id", params.parentFileId);
  }
  if (params.previewJson) {
    formData.set("preview_json", JSON.stringify(params.previewJson));
  }
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

export async function searchPlodaiEntities(params: {
  appId: WorkspaceAppId;
  workspaceId: string;
  threadId: string;
  query: string;
}): Promise<PlodaiEntitySearchResponse> {
  return apiRequest<PlodaiEntitySearchResponse>("/plodai/entities/search", {
    method: "POST",
    body: JSON.stringify({
      app_id: params.appId,
      workspace_id: params.workspaceId,
      thread_id: params.threadId,
      query: params.query,
    }),
  });
}

export async function fetchPublicFarmOrder(
  workspaceId: string,
  orderId: string,
): Promise<PublicFarmOrderResponse> {
  return publicApiRequest<PublicFarmOrderResponse>(
    `/public/farm-orders/${encodeURIComponent(workspaceId)}/${encodeURIComponent(orderId)}`,
  );
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

function buildJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
