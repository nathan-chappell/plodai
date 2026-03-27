import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
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
      placeholder?: string;
    };
    const header = options.header as { enabled?: boolean };
    const startScreen = options.startScreen as {
      greeting?: string;
      prompts?: Array<{ label: string; prompt: string }>;
    };

    expect(markup).toContain("Mock ChatKit");
    expect(markup).not.toContain("Farm chat");
    expect(markup).not.toContain("Summarize images");
    expect(markup).not.toContain("Review orders");
    expect(header.enabled).toBe(true);
    expect(composer.attachments?.enabled).toBe(true);
    expect(composer.placeholder).toBe(
      "Zatraži od PlodAI-ja da pregleda slike, objasni zapis farme ili spremi promjene.",
    );
    expect(startScreen.greeting).toContain("Pregledaj slike farme");
    expect(startScreen.prompts?.[0]?.label).toBe("Procijeni slike polja");
  });

  it("switches the greeting, starter prompts, and placeholder when English is selected", () => {
    renderToStaticMarkup(<ChatKitPane farmId="farm_123" preferredOutputLanguage="en" />);

    const options = useChatKitMock.mock.calls[0]?.[0] as {
      composer?: {
        placeholder?: string;
      };
      startScreen?: {
        greeting?: string;
        prompts?: Array<{ label: string; prompt: string }>;
      };
    };

    expect(options.startScreen?.greeting).toBe(
      "Review farm images, inspect the saved record, and decide the next step.",
    );
    expect(options.startScreen?.prompts?.[0]?.label).toBe("Assess field images");
    expect(options.composer?.placeholder).toBe(
      "Ask PlodAI to inspect images, explain the farm record, or save updates.",
    );
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

  it("keeps the initial thread stable for same-farm rerenders", async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
    const rootElement = dom.window.document.getElementById("root");
    const globalsToOverride = {
      window: dom.window,
      document: dom.window.document,
      customElements: dom.window.customElements,
      HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
      Node: dom.window.Node,
    } as const;
    const previousDescriptors = Object.fromEntries(
      Object.keys(globalsToOverride).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );

    for (const [key, value] of Object.entries(globalsToOverride)) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }

    if (!rootElement) {
      throw new Error("Expected an interactive ChatKit test root.");
    }

    const root = createRoot(rootElement);

    try {
      await act(async () => {
        root.render(<ChatKitPane activeChatId={null} farmId="farm_123" />);
      });

      await act(async () => {
        root.render(<ChatKitPane activeChatId="chat_123" farmId="farm_123" />);
      });
    } finally {
      await act(async () => {
        root.unmount();
      });
      for (const [key, descriptor] of Object.entries(previousDescriptors)) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          delete (globalThis as Record<string, unknown>)[key];
        }
      }
      dom.window.close();
    }

    const firstOptions = useChatKitMock.mock.calls[0]?.[0] as {
      initialThread?: string | null;
    };
    const secondOptions = useChatKitMock.mock.calls[1]?.[0] as {
      initialThread?: string | null;
    };
    const setThreadId = useChatKitMock.mock.results[0]?.value.setThreadId as ReturnType<typeof vi.fn>;

    expect(firstOptions.initialThread).toBeNull();
    expect(secondOptions.initialThread).toBeNull();
    expect(setThreadId).toHaveBeenCalledWith("chat_123");
  });
});
