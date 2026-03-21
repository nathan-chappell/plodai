// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/toasts", () => ({
  publishPaymentRequiredToast: vi.fn(),
}));

import {
  authenticatedFetch,
  getChatKitConfig,
  setChatKitMetadataGetter,
  setChatKitNativeFeedbackHandler,
} from "../api";

describe("authenticatedFetch", () => {
  afterEach(() => {
    setChatKitMetadataGetter(null);
    setChatKitNativeFeedbackHandler(null);
    vi.restoreAllMocks();
  });

  it("intercepts native ChatKit feedback requests and returns a synthetic success response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const handler = vi.fn(async () => {});
    setChatKitNativeFeedbackHandler(handler);

    const response = await authenticatedFetch(getChatKitConfig().url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "items.feedback",
        params: {
          thread_id: "thread_123",
          item_ids: ["msg_123"],
          kind: "negative",
        },
      }),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({
      threadId: "thread_123",
      itemIds: ["msg_123"],
      kind: "negative",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
  });

  it("still attaches ChatKit metadata for normal ChatKit requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    setChatKitMetadataGetter(() => ({
      origin: "interactive",
      shell_state: "workspace",
    }));

    await authenticatedFetch(getChatKitConfig().url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "threads.create",
        params: {
          input: {
            text: "Hello",
          },
        },
      }),
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = fetchSpy.mock.calls[0] ?? [];
    expect(requestUrl).toBe(getChatKitConfig().url);
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      type: "threads.create",
      metadata: {
        origin: "interactive",
        shell_state: "workspace",
      },
    });
  });
});
