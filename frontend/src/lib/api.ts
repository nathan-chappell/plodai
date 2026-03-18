import { publishPaymentRequiredToast } from "../app/toasts";
import { recordFireTestChatKitResponse } from "./fire-test";

const API_BASE_URL = normalizeBase(import.meta.env.VITE_API_BASE_URL ?? "/api");
const CHATKIT_URL = import.meta.env.VITE_CHATKIT_URL ?? deriveChatKitUrl(API_BASE_URL);
const CHATKIT_DOMAIN_KEY = "domain_pk_69b2a0ec9ebc8196b1893307126bc3940346bce2224e586b";
let clerkTokenGetter: (() => Promise<string | null>) | null = null;
let chatKitMetadataGetter: (() => Record<string, unknown> | null) | null = null;

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

  const response = await fetch(input, {
    ...nextInit,
    headers,
  });
  if (isChatKitRequest(input)) {
    void captureChatKitResponse(response.clone(), input);
  }
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

function isChatKitRequest(input: RequestInfo | URL): boolean {
  const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return normalizeRequestPath(requestUrl) === normalizeRequestPath(CHATKIT_URL);
}

async function captureChatKitResponse(response: Response, input: RequestInfo | URL): Promise<void> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    recordFireTestChatKitResponse({
      url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: await response.text(),
    });
  } catch (error) {
    recordFireTestChatKitResponse({
      url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: error instanceof Error ? `[capture error] ${error.message}` : "[capture error]",
    });
  }
}

function normalizeRequestPath(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname.replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}
