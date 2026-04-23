import { publishPaymentRequiredToast } from "../app/toasts";
import type { PreferredOutputLanguage } from "./chat-language";
import type { PlodaiEntitySearchResponse } from "../types/chat-entities";
import type {
  FarmDeleteResponse,
  FarmDetail,
  FarmImageDeleteResponse,
  FarmImageUploadResponse,
  FarmRecordPayload,
  FarmRecordResponse,
  FarmSummary,
  PublicFarmOrderResponse,
} from "../types/farm";

const API_BASE_URL = normalizeBase(import.meta.env.VITE_API_BASE_URL ?? "/api");
const CHATKIT_DOMAIN_KEY = "domain_pk_69ea3fd1be08819098782d5a22ca589201053bea45511d76";

let clerkTokenGetter: (() => Promise<string | null>) | null = null;
let chatKitMetadataGetter: (() => Record<string, unknown> | null) | null = null;
let chatKitOutputLanguageGetter: (() => PreferredOutputLanguage | null) | null = null;

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

export function setChatKitOutputLanguageGetter(
  getter: (() => PreferredOutputLanguage | null) | null,
): void {
  chatKitOutputLanguageGetter = getter;
}

export function getChatKitConfig(farmId: string) {
  return {
    url: `${API_BASE_URL}/farms/${encodeURIComponent(farmId)}/chatkit`,
    domainKey: CHATKIT_DOMAIN_KEY,
  };
}

export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  const token = (await clerkTokenGetter?.()) ?? null;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const preparedRequest = prepareChatKitRequest(input, {
    ...init,
    headers,
  });
  const response = await fetch(preparedRequest.input, preparedRequest.init);

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

export async function listFarms(): Promise<FarmSummary[]> {
  return apiRequest<FarmSummary[]>("/farms");
}

export async function createFarm(name: string): Promise<FarmDetail> {
  return apiRequest<FarmDetail>("/farms", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function getFarm(farmId: string): Promise<FarmDetail> {
  return apiRequest<FarmDetail>(`/farms/${encodeURIComponent(farmId)}`);
}

export async function deleteFarm(farmId: string): Promise<FarmDeleteResponse> {
  return apiRequest<FarmDeleteResponse>(`/farms/${encodeURIComponent(farmId)}`, {
    method: "DELETE",
  });
}

export async function updateFarm(farmId: string, payload: { name?: string | null }): Promise<FarmDetail> {
  return apiRequest<FarmDetail>(`/farms/${encodeURIComponent(farmId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function getFarmRecord(farmId: string): Promise<FarmRecordResponse> {
  return apiRequest<FarmRecordResponse>(`/farms/${encodeURIComponent(farmId)}/record`);
}

export async function saveFarmRecord(farmId: string, record: FarmRecordPayload): Promise<FarmRecordResponse> {
  return apiRequest<FarmRecordResponse>(`/farms/${encodeURIComponent(farmId)}/record`, {
    method: "PUT",
    body: JSON.stringify({ record }),
  });
}

export async function uploadFarmImage(
  farmId: string,
  file: File,
): Promise<FarmImageUploadResponse> {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const response = await authenticatedFetch(`${API_BASE_URL}/farms/${encodeURIComponent(farmId)}/images`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return (await response.json()) as FarmImageUploadResponse;
}

export async function deleteFarmImage(
  farmId: string,
  imageId: string,
): Promise<FarmImageDeleteResponse> {
  return apiRequest<FarmImageDeleteResponse>(
    `/farms/${encodeURIComponent(farmId)}/images/${encodeURIComponent(imageId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function searchPlodaiEntities(params: {
  farmId: string;
  query: string;
}): Promise<PlodaiEntitySearchResponse> {
  return apiRequest<PlodaiEntitySearchResponse>(
    `/farms/${encodeURIComponent(params.farmId)}/entities/search`,
    {
      method: "POST",
      body: JSON.stringify({
        query: params.query,
      }),
    },
  );
}

export async function fetchPublicFarmOrder(
  farmId: string,
  orderId: string,
): Promise<PublicFarmOrderResponse> {
  return publicApiRequest<PublicFarmOrderResponse>(
    `/public/farms/${encodeURIComponent(farmId)}/orders/${encodeURIComponent(orderId)}`,
  );
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

function prepareChatKitRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
} {
  const nextInit = maybeAttachChatKitMetadata(input, init);
  const preferredOutputLanguage = chatKitOutputLanguageGetter?.() ?? null;
  return {
    input: withChatKitOutputLanguage(input, preferredOutputLanguage),
    init: nextInit,
  };
}

function withChatKitOutputLanguage(
  input: RequestInfo | URL,
  preferredOutputLanguage: PreferredOutputLanguage | null,
): RequestInfo | URL {
  if (!isChatKitRequest(input) || !preferredOutputLanguage) {
    return input;
  }

  const url = toRequestUrl(input);
  url.searchParams.set("preferred_output_language", preferredOutputLanguage);

  if (input instanceof Request) {
    return new Request(url.toString(), input);
  }
  return url.toString();
}

function toRequestUrl(input: RequestInfo | URL): URL {
  const requestUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    return new URL(requestUrl);
  } catch {
    const baseUrl =
      typeof window !== "undefined" && typeof window.location?.origin === "string"
        ? window.location.origin
        : "http://localhost";
    return new URL(requestUrl, baseUrl);
  }
}

function isChatKitRequest(input: RequestInfo | URL): boolean {
  const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return requestUrl.includes("/chatkit");
}
