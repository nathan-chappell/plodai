// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authenticatedFetch,
  getChatKitConfig,
  setChatKitMetadataGetter,
  setChatKitNativeFeedbackHandler,
} from "../../lib/api";

let latestHandlers: Record<string, (...args: any[]) => void> | null = null;
let latestChatKitOptions: Record<string, unknown> | null = null;
let latestChatKitApi: Record<string, unknown> | null = null;
let latestHostElement: HTMLElement | null = null;
let latestScrollTarget: HTMLElement | null = null;
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

vi.mock("@openai/chatkit-react", async () => {
  const ReactModule = await import("react");

  function splitOptions(options: Record<string, unknown>) {
    const handlers: Record<string, unknown> = {};
    const chatKitOptions: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
      if (/^on[A-Z]/.test(key) && key !== "onClientTool") {
        handlers[key] = value;
      } else {
        chatKitOptions[key] = value;
      }
    }
    return { handlers, chatKitOptions };
  }

  return {
    useChatKit(options: Record<string, unknown>) {
      const ref = ReactModule.useRef<HTMLElement | null>(null);
      const { handlers, chatKitOptions } = ReactModule.useMemo(() => splitOptions(options), [options]);
      const control = ReactModule.useMemo(
        () => ({
          setInstance(instance: HTMLElement | null) {
            ref.current = instance;
          },
          options: chatKitOptions,
          handlers,
        }),
        [chatKitOptions, handlers],
      );
      return ReactModule.useMemo(() => {
        const api = {
          control,
          ref,
          fetchUpdates: vi.fn(async () => {}),
          focusComposer: vi.fn(async () => {}),
          hideHistory: vi.fn(async () => {}),
          sendCustomAction: vi.fn(async () => {}),
          sendUserMessage: vi.fn(async () => {}),
          setComposerValue: vi.fn(async () => {}),
          setThreadId: vi.fn(async () => {}),
          showHistory: vi.fn(async () => {}),
        };
        latestChatKitApi = api;
        return api;
      }, [control]);
    },
    ChatKit: ReactModule.forwardRef(function MockChatKit(
      { control }: { control: { setInstance: (instance: HTMLElement | null) => void; handlers: Record<string, any>; options: Record<string, unknown> } },
      forwardedRef: React.ForwardedRef<HTMLElement>,
    ) {
      const localRef = ReactModule.useRef<HTMLElement | null>(null);

      ReactModule.useLayoutEffect(() => {
        latestHandlers = control.handlers;
        latestChatKitOptions = control.options;
        const host = localRef.current;
        latestHostElement = host;
        if (!host) {
          return;
        }
        const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
        let scrollTarget = shadowRoot.querySelector("[data-testid='mock-chatkit-scroll-target']") as HTMLElement | null;
        if (!scrollTarget) {
          scrollTarget = document.createElement("div");
          scrollTarget.dataset.testid = "mock-chatkit-scroll-target";
          scrollTarget.style.overflowY = "auto";
          shadowRoot.appendChild(scrollTarget);
        }
        latestScrollTarget = scrollTarget;

        return () => {
          latestHandlers = null;
          latestChatKitOptions = null;
          latestChatKitApi = null;
          latestHostElement = null;
          latestScrollTarget = null;
        };
      }, [control]);

      return ReactModule.createElement("openai-chatkit", {
        ref: (node: HTMLElement | null) => {
          localRef.current = node;
          control.setInstance(node);
          if (typeof forwardedRef === "function") {
            forwardedRef(node);
          } else if (forwardedRef) {
            forwardedRef.current = node;
          }
        },
      });
    }),
  };
});

vi.mock("../../lib/dev-logging", () => ({
  devLogger: {
    chatKitGate: vi.fn(),
    clientToolError: vi.fn(),
    clientToolStart: vi.fn(),
    clientToolSuccess: vi.fn(),
    responseEnd: vi.fn(),
    responseStart: vi.fn(),
    workspaceEvent: vi.fn(),
  },
}));

import { ChatKitHarness, ChatKitPane, buildChatKitRequestMetadata } from "../ChatKitPane";
import type { AgentBundle, AgentClientTool } from "../../agents/types";
import {
  plodaiAgentDefinition,
  analysisAgentDefinition,
  documentAgentDefinition,
} from "../../agents/definitions";
import type { LocalAttachment } from "../../types/report";
import type { WorkspaceState } from "../../types/workspace";

function setScrollMetrics(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop?: number },
): void {
  let scrollTop = metrics.scrollTop ?? 0;
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
}

const agentBundle: AgentBundle = {
  root_agent_id: "plodai-agent",
  agents: [
    {
      agent_id: "plodai-agent",
      agent_name: "PlodAI",
      instructions: "Inspect files.",
      client_tools: [],
      delegation_targets: [],
    },
  ],
};

const files: LocalAttachment[] = [
  {
    id: "file_image",
    name: "orchard.jpeg",
    kind: "image",
    extension: "jpeg",
    mime_type: "image/jpeg",
    width: 1200,
    height: 800,
    bytes_base64: "Zm9v",
  },
];

const workspaceState: WorkspaceState = {
  version: "v4",
  workspace_id: "workspace-plodai",
  workspace_name: "PlodAI workspace",
  app_id: "plodai",
  items: [
    {
      origin: "upload",
      id: "file_image",
      workspace_id: "workspace-plodai",
      name: "orchard.jpeg",
      kind: "image",
      extension: "jpeg",
      content_key: "sha256:file_image",
      local_status: "available",
      preview: {
        width: 1200,
        height: 800,
      },
      created_at: "2026-03-21T12:00:00.000Z",
      updated_at: "2026-03-21T12:00:00.000Z",
    },
  ],
};

describe("ChatKitPane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    latestHandlers = null;
    latestChatKitOptions = null;
    latestChatKitApi = null;
    latestHostElement = null;
    latestScrollTarget = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    setChatKitMetadataGetter(null);
    setChatKitNativeFeedbackHandler(null);
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderHarness(
    overrides: Partial<React.ComponentProps<typeof ChatKitHarness>> = {},
  ) {
    await act(async () => {
      root.render(
        <ChatKitHarness
          agentBundle={agentBundle}
          files={files}
          workspaceState={workspaceState}
          investigationBrief=""
          clientTools={[]}
          onEffects={() => {}}
          {...overrides}
        />,
      );
    });
  }

  async function renderPane(
    investigationBrief: string,
    overrides: Partial<React.ComponentProps<typeof ChatKitPane>> = {},
  ) {
    await act(async () => {
      root.render(
        <ChatKitPane
          agentBundle={agentBundle}
          enabled
          files={files}
          workspaceState={workspaceState}
          investigationBrief={investigationBrief}
          clientTools={[]}
          onEffects={() => {}}
          {...overrides}
        />,
      );
    });
  }

  it("scrolls on response end only while auto-scroll is enabled", async () => {
    await renderHarness();
    expect(latestHandlers).not.toBeNull();
    expect(latestScrollTarget).not.toBeNull();

    setScrollMetrics(latestScrollTarget!, {
      clientHeight: 200,
      scrollHeight: 900,
      scrollTop: 600,
    });

    await act(async () => {
      latestHandlers?.onReady?.();
    });
    expect(latestScrollTarget!.scrollTop).toBe(900);

    latestScrollTarget!.scrollTop = 120;
    latestScrollTarget!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      latestHandlers?.onResponseEnd?.();
    });
    expect(latestScrollTarget!.scrollTop).toBe(120);
  });

  it("includes workspace metadata with the new app_id shape", async () => {
    await renderHarness();

    expect(
      buildChatKitRequestMetadata({
        agentBundle,
        workspaceState,
        investigationBrief: "Inspect the orchard photos carefully.",
        threadOrigin: "interactive",
      }),
    ).toMatchObject({
      investigation_brief: "Inspect the orchard photos carefully.",
      agent_bundle: agentBundle,
      workspace_state: workspaceState,
      origin: "interactive",
    });
  });

  it("does not auto-send a message just from mounting the pane", async () => {
    await renderPane("", {
      greeting: plodaiAgentDefinition.chatkitLead,
      composerPlaceholder: plodaiAgentDefinition.chatkitPlaceholder,
    });

    expect(latestChatKitApi?.sendUserMessage).not.toHaveBeenCalled();
  });

  it("prefills the composer from a queued draft without sending anything", async () => {
    const onComposerDraftApplied = vi.fn();

    await renderHarness({
      composerDraft: {
        id: "draft_1",
        prompt: "Inspect the loaded orchard photos and summarize the visible evidence.",
        model: "balanced",
      },
      onComposerDraftApplied,
    });

    expect(latestChatKitApi?.setComposerValue).toHaveBeenCalledWith({
      text: "Inspect the loaded orchard photos and summarize the visible evidence.",
      selectedModelId: "balanced",
    });
    expect(latestChatKitApi?.focusComposer).toHaveBeenCalled();
    expect(latestChatKitApi?.sendUserMessage).not.toHaveBeenCalled();
    expect(onComposerDraftApplied).toHaveBeenCalledWith("draft_1");
  });

  it("accepts compact lead text for the visible app surfaces", async () => {
    for (const agent of [plodaiAgentDefinition, documentAgentDefinition, analysisAgentDefinition]) {
      await renderPane("", {
        greeting: agent.chatkitLead,
        composerPlaceholder: agent.chatkitPlaceholder,
      });

      const startScreen = latestChatKitOptions?.startScreen as { greeting?: string } | undefined;
      const composer = latestChatKitOptions?.composer as { placeholder?: string } | undefined;

      expect(startScreen?.greeting).toBe(agent.chatkitLead);
      expect(composer?.placeholder).toBe(agent.chatkitPlaceholder);
    }
  });

  it("configures plodai composer attachments as image-only with a 10 MB cap", async () => {
    await renderPane("", {
      attachmentConfig: plodaiAgentDefinition.attachmentConfig,
    });

    const composer = latestChatKitOptions?.composer as
      | {
          attachments?: {
            enabled?: boolean;
            accept?: Record<string, string[]>;
            maxSize?: number;
          };
        }
      | undefined;

    expect(composer?.attachments).toEqual({
      enabled: true,
      accept: {
        "image/*": [".png", ".jpg", ".jpeg", ".webp"],
      },
      maxCount: 10,
      maxSize: 10 * 1024 * 1024,
    });
  });

  it("passes plodai entity handlers through to ChatKit", async () => {
    const onTagSearch = vi.fn(async () => []);
    const onClick = vi.fn();
    const onRequestPreview = vi.fn(async () => ({ preview: null }));

    await renderPane("", {
      entitiesConfig: {
        enabled: true,
        showComposerMenu: true,
        onTagSearch,
        onClick,
        onRequestPreview,
      },
    });

    expect(latestChatKitOptions?.entities).toMatchObject({
      showComposerMenu: true,
      onTagSearch,
      onClick,
      onRequestPreview,
    });
  });

  it("runs a quick action without scheduling follow-up turns", async () => {
    await renderPane("", {
      quickActions: [{ label: "Inspect now", prompt: "Inspect the loaded files." }],
      showChatKitHeader: false,
    });

    const sendUserMessage = latestChatKitApi?.sendUserMessage as ReturnType<typeof vi.fn> | undefined;
    const quickActionButton = container.querySelector(
      "[data-testid='chatkit-quick-action-inspect-now']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      quickActionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(sendUserMessage).toHaveBeenCalledWith({
      text: "Inspect the loaded files.",
      model: "lightweight",
      newThread: true,
    });
  });

  it("routes intercepted native feedback into the seeded feedback flow", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await renderPane("", {
      showChatKitHeader: false,
    });

    await act(async () => {
      await authenticatedFetch(getChatKitConfig().url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "items.feedback",
          params: {
            thread_id: "thread_feedback",
            item_ids: ["msg_123"],
            kind: "positive",
          },
        }),
      });
    });

    const sendUserMessage = latestChatKitApi?.sendUserMessage as ReturnType<typeof vi.fn> | undefined;
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledOnce();
    expect(sendUserMessage).toHaveBeenCalledWith({
      text: expect.stringContaining('sentiment: "thumbs up"'),
      newThread: false,
    });
  });

  it("clears the local tool completion status after a short delay", async () => {
    const toolHandler = vi.fn(async () => ({ ok: true }));
    const clientTools: AgentClientTool[] = [
      {
        type: "function",
        name: "append_report_slide",
        description: "Append a report slide.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        strict: true,
        handler: toolHandler,
      },
    ];

    await renderHarness({ clientTools });

    await act(async () => {
      await (latestChatKitOptions as { onClientTool?: (event: { name: string; params: Record<string, unknown> }) => Promise<void> } | null)?.onClientTool?.({
        name: "append_report_slide",
        params: {},
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(toolHandler).toHaveBeenCalled();
    expect(container.textContent).not.toContain("guided tour");
  });
});
