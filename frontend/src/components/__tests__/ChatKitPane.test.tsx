import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useChatKitMock } = vi.hoisted(() => ({
  useChatKitMock: vi.fn(),
}));

vi.mock("@openai/chatkit-react", () => ({
  ChatKit: () => <div data-testid="mock-chatkit">Mock ChatKit</div>,
  useChatKit: useChatKitMock,
}));

import { ChatKitPane, buildChatKitRequestMetadata } from "../ChatKitPane";

describe("ChatKitPane", () => {
  beforeEach(() => {
    useChatKitMock.mockReset();
    useChatKitMock.mockReturnValue({
      control: { id: "mock-control" },
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
});
