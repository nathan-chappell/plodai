type StorageKey =
  | "ai-portfolio-sidebar-collapsed"
  | "ai-portfolio-theme"
  | "ai-portfolio-theme-mode";

function isStorageLike(value: unknown): value is Storage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "getItem" in value &&
      typeof value.getItem === "function" &&
      "setItem" in value &&
      typeof value.setItem === "function",
  );
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storage = window.localStorage;
  return isStorageLike(storage) ? storage : null;
}

export function readStoredString(key: StorageKey): string | null {
  return getStorage()?.getItem(key) ?? null;
}

export function writeStoredString(key: StorageKey, value: string): void {
  getStorage()?.setItem(key, value);
}

export function readStoredBoolean(key: StorageKey): boolean | null {
  const value = readStoredString(key);
  if (value === null) {
    return null;
  }
  return value === "true";
}

export function writeStoredBoolean(key: StorageKey, value: boolean): void {
  writeStoredString(key, String(value));
}
