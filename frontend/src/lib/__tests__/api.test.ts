import { describe, expect, it, vi } from "vitest";

import {
  authenticatedFetch,
  getChatKitConfig,
  setChatKitMetadataGetter,
} from "../api";

describe("farm api helpers", () => {
  it("builds farm-scoped ChatKit URLs", () => {
    expect(getChatKitConfig("farm_abc").url).toContain("/api/farms/farm_abc/chatkit");
  });

  it("attaches chat metadata to ChatKit requests", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    setChatKitMetadataGetter(() => ({
      origin: "ui_integration_test",
    }));

    await authenticatedFetch(getChatKitConfig("farm_abc").url, {
      method: "POST",
      body: JSON.stringify({
        type: "thread.new",
        metadata: {
          title: "Field check",
        },
      }),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      type: "thread.new",
      metadata: {
        title: "Field check",
        origin: "ui_integration_test",
      },
    });

    setChatKitMetadataGetter(null);
    vi.unstubAllGlobals();
  });
});
