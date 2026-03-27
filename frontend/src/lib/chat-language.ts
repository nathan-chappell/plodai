export type PreferredOutputLanguage = "hr" | "en";

export const DEFAULT_PREFERRED_OUTPUT_LANGUAGE: PreferredOutputLanguage = "hr";
export const PREFERRED_OUTPUT_LANGUAGE_STORAGE_KEY = "plodai.preferredOutputLanguage";
export const PREFERRED_OUTPUT_LANGUAGE_OPTIONS = [
  {
    value: "hr",
    label: "Hrvatski",
  },
  {
    value: "en",
    label: "English",
  },
] as const;

export function isPreferredOutputLanguage(value: string | null | undefined): value is PreferredOutputLanguage {
  return value === "hr" || value === "en";
}

export function resolvePreferredOutputLanguage(
  value: string | null | undefined,
): PreferredOutputLanguage {
  return isPreferredOutputLanguage(value) ? value : DEFAULT_PREFERRED_OUTPUT_LANGUAGE;
}

export function loadPreferredOutputLanguage(): PreferredOutputLanguage {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERRED_OUTPUT_LANGUAGE;
  }
  try {
    return resolvePreferredOutputLanguage(
      window.localStorage.getItem(PREFERRED_OUTPUT_LANGUAGE_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_PREFERRED_OUTPUT_LANGUAGE;
  }
}

export function persistPreferredOutputLanguage(
  language: PreferredOutputLanguage,
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(PREFERRED_OUTPUT_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore storage failures and keep the in-memory selection.
  }
}
