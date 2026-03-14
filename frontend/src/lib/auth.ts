export const SIGN_IN_PATH = "/sign-in";
export const DEFAULT_AUTHENTICATED_PATH = "/capabilities/report-foundry";
export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
export const AUTH_MODE = import.meta.env.VITE_AUTH_MODE ?? (CLERK_PUBLISHABLE_KEY ? "clerk" : "local");

export function isClerkAuthMode(): boolean {
  return AUTH_MODE === "clerk";
}

export function isClerkEnabled(): boolean {
  return isClerkAuthMode() && Boolean(CLERK_PUBLISHABLE_KEY);
}
