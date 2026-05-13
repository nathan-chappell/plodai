import { publishPaymentRequiredToast } from "../app/toasts";
import type { PreferredOutputLanguage } from "./chat-language";
import type { PlodaiEntitySearchResponse } from "../types/chat-entities";
import type {
  AdminFreeCreditDecisionRequest,
  AdminPaymentAttemptDecisionRequest,
  FreeCreditRequestCreate,
  FreeCreditRequestListResponse,
  FreeCreditRequestSummary,
  PaymentAttemptListResponse,
  PaymentAttemptStatus,
  PaymentAttemptSummary,
  PaymentIntegrationResponse,
  PayPalPaymentAttemptCreateRequest,
  FreeCreditRequestStatus,
} from "../types/credits";
import type {
  AdvisoryCaseDeleteResponse,
  AdvisoryCaseDetail,
  AdvisoryImageDeleteResponse,
  AdvisoryImageUploadResponse,
  AdvisoryRecordPayload,
  AdvisoryRecordResponse,
  AdvisoryCaseSummary,
  AdvisorySemanticSearchResponse,
} from "../types/advisory";

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

export function getChatKitConfig(caseId: string) {
  return {
    url: `${API_BASE_URL}/advisory/cases/${encodeURIComponent(caseId)}/chatkit`,
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

export async function listCases(): Promise<AdvisoryCaseSummary[]> {
  return apiRequest<AdvisoryCaseSummary[]>("/advisory/cases");
}

export async function createCase(title: string): Promise<AdvisoryCaseDetail> {
  return apiRequest<AdvisoryCaseDetail>("/advisory/cases", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function getCase(caseId: string): Promise<AdvisoryCaseDetail> {
  return apiRequest<AdvisoryCaseDetail>(`/advisory/cases/${encodeURIComponent(caseId)}`);
}

export async function deleteCase(caseId: string): Promise<AdvisoryCaseDeleteResponse> {
  return apiRequest<AdvisoryCaseDeleteResponse>(`/advisory/cases/${encodeURIComponent(caseId)}`, {
    method: "DELETE",
  });
}

export async function updateCase(caseId: string, payload: { title?: string | null }): Promise<AdvisoryCaseDetail> {
  return apiRequest<AdvisoryCaseDetail>(`/advisory/cases/${encodeURIComponent(caseId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function getAdvisoryRecord(caseId: string): Promise<AdvisoryRecordResponse> {
  return apiRequest<AdvisoryRecordResponse>(`/advisory/cases/${encodeURIComponent(caseId)}/record`);
}

export async function saveAdvisoryRecord(caseId: string, record: AdvisoryRecordPayload): Promise<AdvisoryRecordResponse> {
  return apiRequest<AdvisoryRecordResponse>(`/advisory/cases/${encodeURIComponent(caseId)}/record`, {
    method: "PUT",
    body: JSON.stringify({ record }),
  });
}

export async function uploadAdvisoryImage(
  caseId: string,
  file: File,
): Promise<AdvisoryImageUploadResponse> {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const response = await authenticatedFetch(`${API_BASE_URL}/advisory/cases/${encodeURIComponent(caseId)}/images`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return (await response.json()) as AdvisoryImageUploadResponse;
}

export async function deleteCaseImage(
  caseId: string,
  imageId: string,
): Promise<AdvisoryImageDeleteResponse> {
  return apiRequest<AdvisoryImageDeleteResponse>(
    `/advisory/cases/${encodeURIComponent(caseId)}/images/${encodeURIComponent(imageId)}`,
    {
      method: "DELETE",
    },
  );
}

export async function searchPlodaiEntities(params: {
  caseId: string;
  query: string;
}): Promise<PlodaiEntitySearchResponse> {
  return apiRequest<PlodaiEntitySearchResponse>(
    `/advisory/cases/${encodeURIComponent(params.caseId)}/entities/search`,
    {
      method: "POST",
      body: JSON.stringify({
        query: params.query,
      }),
    },
  );
}

export async function searchAdvisoryMemory(params: {
  caseId: string;
  query: string;
  maxResults?: number;
}): Promise<AdvisorySemanticSearchResponse> {
  return apiRequest<AdvisorySemanticSearchResponse>(
    `/advisory/cases/${encodeURIComponent(params.caseId)}/semantic-search`,
    {
      method: "POST",
      body: JSON.stringify({
        query: params.query,
        max_results: params.maxResults ?? 8,
      }),
    },
  );
}

export async function getPaymentIntegrationStatus(): Promise<PaymentIntegrationResponse> {
  return apiRequest<PaymentIntegrationResponse>("/billing/payment-status");
}

export async function listPayPalPaymentAttempts(): Promise<PaymentAttemptListResponse> {
  return apiRequest<PaymentAttemptListResponse>("/billing/paypal/attempts");
}

export async function createPayPalPaymentAttempt(
  payload: PayPalPaymentAttemptCreateRequest,
): Promise<PaymentAttemptSummary> {
  return apiRequest<PaymentAttemptSummary>("/billing/paypal/attempts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadPayPalReceipt(attemptId: string, file: File): Promise<PaymentAttemptSummary> {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const response = await authenticatedFetch(
    `${API_BASE_URL}/billing/paypal/attempts/${encodeURIComponent(attemptId)}/receipt`,
    {
      method: "POST",
      body: formData,
    },
  );
  if (!response.ok) {
    throw await buildApiError(response);
  }
  return (await response.json()) as PaymentAttemptSummary;
}

export async function listFreeCreditRequests(): Promise<FreeCreditRequestListResponse> {
  return apiRequest<FreeCreditRequestListResponse>("/billing/free-credit-requests");
}

export async function createFreeCreditRequest(payload: FreeCreditRequestCreate): Promise<FreeCreditRequestSummary> {
  return apiRequest<FreeCreditRequestSummary>("/billing/free-credit-requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listAdminPaymentAttempts(status: PaymentAttemptStatus): Promise<PaymentAttemptListResponse> {
  return apiRequest<PaymentAttemptListResponse>(`/admin/payments?status=${encodeURIComponent(status)}`);
}

export async function decideAdminPaymentAttempt(
  payload: AdminPaymentAttemptDecisionRequest,
): Promise<PaymentAttemptSummary> {
  return apiRequest<PaymentAttemptSummary>("/admin/payments/decide", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listAdminFreeCreditRequests(
  status: FreeCreditRequestStatus,
): Promise<FreeCreditRequestListResponse> {
  return apiRequest<FreeCreditRequestListResponse>(`/admin/free-credit-requests?status=${encodeURIComponent(status)}`);
}

export async function decideAdminFreeCreditRequest(
  payload: AdminFreeCreditDecisionRequest,
): Promise<FreeCreditRequestSummary> {
  return apiRequest<FreeCreditRequestSummary>("/admin/free-credit-requests/decide", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
