import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishToastMock, useChatKitMock } = vi.hoisted(() => ({
  publishToastMock: vi.fn(),
  useChatKitMock: vi.fn(),
}));

vi.mock("@openai/chatkit-react", () => ({
  ChatKit: () => <div data-testid="mock-chatkit">Mock ChatKit</div>,
  useChatKit: useChatKitMock,
}));

vi.mock("../../app/toasts", () => ({
  publishToast: publishToastMock,
}));

import { ChatKitPane, buildChatKitRequestMetadata } from "../ChatKitPane";

describe("ChatKitPane", () => {
  beforeEach(() => {
    useChatKitMock.mockReset();
    publishToastMock.mockReset();
    useChatKitMock.mockReturnValue({
      control: { id: "mock-control" },
      setComposerValue: vi.fn().mockResolvedValue(undefined),
      setThreadId: vi.fn(),
    });
  });

  it("builds farm-first request metadata with origin only", () => {
    expect(
      buildChatKitRequestMetadata({
        threadOrigin: "interactive",
      }),
    ).toEqual({
      origin: "interactive",
    });
  });

  it("renders the empty state without custom outer header chrome", () => {
    const markup = renderToStaticMarkup(<ChatKitPane farmId={null} />);

    expect(markup).toContain("Select or create a farm to start chatting with PlodAI.");
    expect(markup).not.toContain("Farm chat");
    expect(markup).not.toContain("Start a new farm chat.");
  });

  it("renders the embedded chat surface and keeps attachments enabled", () => {
    const markup = renderToStaticMarkup(<ChatKitPane farmId="farm_123" />);
    const options = useChatKitMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const composer = options.composer as {
      attachments?: { enabled?: boolean };
    };
    const header = options.header as { enabled?: boolean };

    expect(markup).toContain("Mock ChatKit");
    expect(markup).not.toContain("Farm chat");
    expect(markup).not.toContain("Summarize images");
    expect(markup).not.toContain("Review orders");
    expect(header.enabled).toBe(true);
    expect(composer.attachments?.enabled).toBe(true);
  });

  it("clears stale draft attachments when ChatKit reports the attachment limit error", async () => {
    renderToStaticMarkup(<ChatKitPane farmId="farm_123" />);

    const options = useChatKitMock.mock.calls[0]?.[0] as {
      onError?: (event: { error: Error }) => void;
    };
    const setComposerValue = useChatKitMock.mock.results[0]?.value.setComposerValue as ReturnType<typeof vi.fn>;

    options.onError?.({
      error: new Error("Cannot attach any more files to this message."),
    });

    expect(setComposerValue).toHaveBeenCalledWith({
      attachments: [],
    });
    expect(publishToastMock).toHaveBeenCalledWith({
      title: "Draft attachments reset",
      message: "Removed the stale draft attachments. Try attaching those files again.",
      tone: "warning",
    });
  });

  it("forwards client effects to the caller", () => {
    const onClientEffect = vi.fn();
    renderToStaticMarkup(<ChatKitPane farmId="farm_123" onClientEffect={onClientEffect} />);

    const options = useChatKitMock.mock.calls[0]?.[0] as {
      onEffect?: (effect: { name: string; data?: Record<string, unknown> }) => void;
    };
    const effect = {
      name: "farm_record_updated",
      data: { farm_id: "farm_123" },
    };

    options.onEffect?.(effect);

    expect(onClientEffect).toHaveBeenCalledWith(effect);
  });
});
