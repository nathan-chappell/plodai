// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authenticatedFetch,
  getChatKitConfig,
  registerChatKitLocalFiles,
  setChatKitAttachmentHandler,
} from "../api";

describe("authenticatedFetch attachments", () => {
  afterEach(() => {
    setChatKitAttachmentHandler(null);
    vi.restoreAllMocks();
  });

  it("creates local attachments and strips synthetic ids before forwarding the message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const attachmentHandler = vi.fn(async () => ({
      fileIds: ["file_csv"],
    }));

    setChatKitAttachmentHandler(attachmentHandler);

    const file = new File(["region,revenue\nWest,10"], "sales.csv", {
      type: "text/csv",
    });
    registerChatKitLocalFiles([file]);

    const attachmentResponse = await authenticatedFetch(getChatKitConfig().url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "attachments.create",
        params: {
          name: file.name,
          size: file.size,
          mime_type: file.type,
        },
      }),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(attachmentHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
      }),
    );

    const attachmentPayload = (await attachmentResponse.json()) as {
      id: string;
      type: string;
      name: string;
      mime_type: string;
    };
    expect(attachmentPayload).toMatchObject({
      type: "file",
      name: "sales.csv",
      mime_type: "text/csv",
    });

    await authenticatedFetch(getChatKitConfig().url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "threads.create",
        params: {
          input: {
            text: "Inspect this dataset",
            attachments: [attachmentPayload.id, "server_attachment_123"],
          },
        },
      }),
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, forwardedInit] = fetchSpy.mock.calls[0] ?? [];
    expect(JSON.parse(String(forwardedInit?.body))).toMatchObject({
      type: "threads.create",
      params: {
        input: {
          text: "Inspect this dataset",
          attachments: ["server_attachment_123"],
        },
      },
    });
  });

  it("removes local resources when ChatKit deletes a pending synthetic attachment", async () => {
    const deleteHandler = vi.fn(async () => undefined);

    setChatKitAttachmentHandler(
      async () => ({
        fileIds: ["file_pdf"],
      }),
      deleteHandler,
    );

    const file = new File(["%PDF-1.4"], "report.pdf", {
      type: "application/pdf",
    });
    registerChatKitLocalFiles([file]);

    const createResponse = await authenticatedFetch(getChatKitConfig().url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "attachments.create",
        params: {
          name: file.name,
          size: file.size,
          mime_type: file.type,
        },
      }),
    });

    const attachmentPayload = (await createResponse.json()) as { id: string };

    const deleteResponse = await authenticatedFetch(getChatKitConfig().url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "attachments.delete",
        params: {
          attachment_id: attachmentPayload.id,
        },
      }),
    });

    expect(deleteHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: attachmentPayload.id,
        name: "report.pdf",
        fileIds: ["file_pdf"],
      }),
    );
    await expect(deleteResponse.json()).resolves.toEqual({});
  });

  it("keeps the backend image attachment payload as the source of truth", async () => {
    setChatKitAttachmentHandler(async ({ attachmentId }) => ({
      attachment: {
        type: "image",
        id: attachmentId,
        name: "orchard.png",
        mime_type: "image/png",
        preview_url: "/api/stored-files/file_image/preview?token=test-token",
      },
      fileIds: ["file_image"],
      stripBeforeForwarding: false,
    }));

    const file = new File(["image"], "orchard.png", {
      type: "image/png",
    });
    registerChatKitLocalFiles([file]);

    const attachmentResponse = await authenticatedFetch(getChatKitConfig().url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "attachments.create",
        params: {
          name: file.name,
          size: file.size,
          mime_type: file.type,
        },
      }),
    });

    await expect(attachmentResponse.json()).resolves.toEqual({
      type: "image",
      id: expect.any(String),
      name: "orchard.png",
      mime_type: "image/png",
      preview_url: "/api/stored-files/file_image/preview?token=test-token",
    });
  });
});
