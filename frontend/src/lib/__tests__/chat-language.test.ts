import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadPreferredOutputLanguage,
  persistPreferredOutputLanguage,
  PREFERRED_OUTPUT_LANGUAGE_STORAGE_KEY,
} from "../chat-language";

describe("chat language helpers", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to Croatian when nothing is stored", () => {
    expect(loadPreferredOutputLanguage()).toBe("hr");
  });

  it("persists and reloads the selected output language", () => {
    persistPreferredOutputLanguage("en");

    expect(window.localStorage.getItem(PREFERRED_OUTPUT_LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(loadPreferredOutputLanguage()).toBe("en");
  });

  it("falls back to Croatian when storage contains an unsupported value", () => {
    window.localStorage.setItem(PREFERRED_OUTPUT_LANGUAGE_STORAGE_KEY, "de");

    expect(loadPreferredOutputLanguage()).toBe("hr");
  });
});
