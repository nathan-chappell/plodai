import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authenticatedFetch,
  getChatKitConfig,
  setChatKitMetadataGetter,
  setChatKitOutputLanguageGetter,
} from "../api";

describe("advisory api helpers", () => {
  afterEach(() => {
    setChatKitMetadataGetter(null);
    setChatKitOutputLanguageGetter(null);
    vi.unstubAllGlobals();
  });

  it("builds advisory-case ChatKit URLs", () => {
    expect(getChatKitConfig("case_abc").url).toContain("/api/advisory/cases/case_abc/chatkit");
  });

  it("attaches chat metadata and output language to ChatKit requests", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    setChatKitMetadataGetter(() => ({
      origin: "ui_integration_test",
    }));
    setChatKitOutputLanguageGetter(() => "en");

    await authenticatedFetch(getChatKitConfig("case_abc").url, {
      method: "POST",
      body: JSON.stringify({
        type: "thread.new",
        metadata: {
          title: "Field check",
        },
      }),
    });

    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestUrl = new URL(String(input), "http://localhost");

    expect(requestUrl.searchParams.get("preferred_output_language")).toBe("en");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "thread.new",
      metadata: {
        title: "Field check",
        origin: "ui_integration_test",
      },
    });
  });
});
