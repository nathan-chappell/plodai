import { isClerkEnabled } from "./auth";
import { getClerkToken } from "./clerk";

const API_BASE_URL = normalizeBase(import.meta.env.VITE_API_BASE_URL ?? "/api");
const CHATKIT_URL = import.meta.env.VITE_CHATKIT_URL ?? deriveChatKitUrl(API_BASE_URL);
const CHATKIT_DOMAIN_KEY = "domain_pk_69b2a0ec9ebc8196b1893307126bc3940346bce2224e586b"
const TOKEN_KEY = "ai-portfolio-token";

export function getStoredToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string | null): void {
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
    return;
  }

  window.localStorage.removeItem(TOKEN_KEY);
}

export function getChatKitConfig() {
  return {
    url: CHATKIT_URL,
    domainKey: CHATKIT_DOMAIN_KEY,
  };
}

export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  const token = isClerkEnabled() ? await getClerkToken() : getStoredToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(input, {
    ...init,
    headers,
  });
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
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
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
