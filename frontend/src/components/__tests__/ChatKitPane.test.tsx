// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      { control }: { control: { setInstance: (instance: HTMLElement | null) => void; handlers: Record<string, any> } },
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
    demoState: vi.fn(),
    responseEnd: vi.fn(),
    responseStart: vi.fn(),
    workspaceEvent: vi.fn(),
  },
}));

import { ChatKitHarness, ChatKitPane, buildChatKitRequestMetadata } from "../ChatKitPane";
import type { CapabilityBundle, CapabilityClientTool } from "../../capabilities/types";
import type { ExecutionMode } from "../../types/analysis";
import type { LocalWorkspaceFile } from "../../types/report";

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

const capabilityBundle: CapabilityBundle = {
  root_capability_id: "report-agent",
  capabilities: [
    {
      capability_id: "report-agent",
      agent_name: "Report Agent",
      instructions: "Inspect files.",
      client_tools: [],
      handoff_targets: [],
    },
  ],
};

const files: LocalWorkspaceFile[] = [
  {
    id: "file_csv",
    name: "sales.csv",
    kind: "csv",
    extension: "csv",
    row_count: 1,
    columns: ["region"],
    numeric_columns: [],
    sample_rows: [{ region: "West" }],
    preview_rows: [{ region: "West" }],
    rows: [{ region: "West" }],
  },
];

const workspaceContext = {
  path_prefix: "/report-agent/",
  referenced_item_ids: ["file_csv"],
} as const;

const workspaceState = {
  version: "v1" as const,
  context: workspaceContext,
  files: [
    {
      id: "file_csv",
      name: "sales.csv",
      path: "/report-agent/sales.csv",
      kind: "csv" as const,
      extension: "csv",
      row_count: 1,
      columns: ["region"],
      numeric_columns: [],
      sample_rows: [{ region: "West" }],
    },
  ],
  reports: [],
  current_report_id: "report-1",
  current_goal: null,
};

describe("ChatKitHarness auto-scroll", () => {
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function renderHarness(
    clientTools: CapabilityClientTool[] = [],
    executionMode: ExecutionMode = "interactive",
  ) {
    await act(async () => {
      root.render(
        <ChatKitHarness
          capabilityBundle={capabilityBundle}
          files={files}
          workspaceState={workspaceState}
          executionMode={executionMode}
          onExecutionModeChange={() => {}}
          investigationBrief=""
          clientTools={clientTools}
          onEffects={() => {}}
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
          capabilityBundle={capabilityBundle}
          enabled
          files={files}
          workspaceState={workspaceState}
          executionMode="interactive"
          onExecutionModeChange={() => {}}
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

    latestScrollTarget!.scrollTop = 860;
    latestScrollTarget!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      latestHandlers?.onResponseEnd?.();
    });
    expect(latestScrollTarget!.scrollTop).toBe(900);
  });

  it("forces scroll and re-enables auto-scroll on thread changes", async () => {
    await renderHarness();
    expect(latestHandlers).not.toBeNull();
    expect(latestScrollTarget).not.toBeNull();

    setScrollMetrics(latestScrollTarget!, {
      clientHeight: 220,
      scrollHeight: 1000,
      scrollTop: 150,
    });
    latestScrollTarget!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      latestHandlers?.onThreadChange?.({ threadId: "thread_123" });
    });
    expect(latestScrollTarget!.scrollTop).toBe(1000);

    latestScrollTarget!.scrollTop = 140;
    latestScrollTarget!.dispatchEvent(new Event("scroll"));

    await act(async () => {
      latestHandlers?.onThreadLoadEnd?.({ threadId: "thread_123" });
    });
    expect(latestScrollTarget!.scrollTop).toBe(1000);
  });

  it("disables built-in feedback actions and includes execution mode in metadata", async () => {
    await renderHarness([], "batch");

    expect(latestChatKitOptions?.threadItemActions).toEqual({ feedback: false });
    expect(
      buildChatKitRequestMetadata({
        capabilityBundle,
        workspaceState,
        threadOrigin: "interactive",
        executionMode: "batch",
      }),
    ).toMatchObject({
      capability_bundle: capabilityBundle,
      workspace_state: workspaceState,
      execution_mode: "batch",
      origin: "interactive",
    });
  });

  it("does not echo the current goal into ChatKit chrome", async () => {
    const goal = "Protect the margin story and focus on the west region.";

    await renderPane(goal);

    expect(container.textContent).not.toContain(goal);
    expect(container.textContent).not.toContain("Current goal:");

    const composer = latestChatKitOptions?.composer as { placeholder?: string } | undefined;
    expect(composer?.placeholder).toBe("Ask the agent to inspect, transform, or investigate your local files");

    const startScreen = latestChatKitOptions?.startScreen as
      | { prompts?: Array<{ prompt: string }> }
      | undefined;
    const prompts = startScreen?.prompts?.map((prompt) => prompt.prompt) ?? [];
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.some((prompt) => prompt.includes(goal))).toBe(false);
    expect(prompts.some((prompt) => prompt.includes("Focus on this goal"))).toBe(false);
  });

  it("can hide inline run mode controls and use an icon-sized feedback affordance", async () => {
    await renderPane("", {
      showExecutionModeControls: false,
      feedbackButtonVariant: "icon",
      showChatKitHeader: false,
    });

    await act(async () => {
      latestHandlers?.onThreadChange?.({ threadId: "thread_feedback" });
    });

    expect(container.textContent).not.toContain("Run mode");
    expect(container.querySelector("[data-testid='chatkit-provide-feedback']")).not.toBeNull();
    expect((latestChatKitOptions?.header as { enabled?: boolean } | undefined)?.enabled).toBe(false);
  });

  it("keeps the run mode toggle beside feedback and disables both while a run is active", async () => {
    await renderPane("", {
      feedbackButtonVariant: "icon",
      showChatKitHeader: false,
    });

    await act(async () => {
      latestHandlers?.onReady?.();
      latestHandlers?.onThreadChange?.({ threadId: "thread_feedback" });
    });

    const controls = container.querySelector("[data-testid='chatkit-execution-mode-controls']");
    const feedbackButton = container.querySelector("[data-testid='chatkit-provide-feedback']") as HTMLButtonElement | null;
    const interactiveModeButton = container.querySelector(
      "[data-testid='chatkit-execution-mode-interactive']",
    ) as HTMLButtonElement | null;

    expect(controls).not.toBeNull();
    expect(feedbackButton?.getAttribute("aria-label")).toBe("Open feedback flow");
    expect(feedbackButton?.title).toBe("Open feedback flow");
    expect(interactiveModeButton?.disabled).toBe(false);

    await act(async () => {
      latestHandlers?.onResponseStart?.();
    });

    expect(feedbackButton?.disabled).toBe(true);
    expect(interactiveModeButton?.disabled).toBe(true);
  });

  it("asks for confirmation before starting the icon feedback flow", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    await renderPane("", {
      feedbackButtonVariant: "icon",
      showChatKitHeader: false,
    });

    await act(async () => {
      latestHandlers?.onReady?.();
      latestHandlers?.onThreadChange?.({ threadId: "thread_feedback" });
    });

    const feedbackButton = container.querySelector("[data-testid='chatkit-provide-feedback']") as HTMLButtonElement | null;
    expect(feedbackButton).not.toBeNull();
    expect(container.textContent).toContain("Chat ready.");

    await act(async () => {
      feedbackButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      "Open the feedback flow for the latest assistant response in this thread?",
    );
    expect(container.textContent).toContain("Chat ready.");

    confirmSpy.mockReturnValue(true);

    await act(async () => {
      feedbackButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Starting feedback flow.");
  });

  it("does not send custom metadata actions from client tools while ChatKit is responding", async () => {
    const toolHandler = vi.fn(async () => ({
      workspace_context: {
        path_prefix: "/report-agent/reports/",
        referenced_item_ids: ["file_csv"],
      },
    }));

    await renderHarness([
      {
        type: "function",
        name: "list_reports",
        description: "List reports.",
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        handler: toolHandler,
      },
    ]);

    await act(async () => {
      latestHandlers?.onReady?.();
      latestHandlers?.onThreadChange?.({ threadId: "thread_tool" });
      latestHandlers?.onResponseStart?.();
    });

    const onClientTool = latestChatKitOptions?.onClientTool as
      | ((input: { name: string; params: Record<string, unknown> }) => Promise<unknown>)
      | undefined;
    const sendCustomAction = latestChatKitApi?.sendCustomAction as ReturnType<typeof vi.fn> | undefined;

    let result: unknown;
    await act(async () => {
      result = await onClientTool?.({
        name: "list_reports",
        params: {},
      });
    });

    expect(toolHandler).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      workspace_context: {
        path_prefix: "/report-agent/reports/",
        referenced_item_ids: ["file_csv"],
      },
    });
    expect(sendCustomAction).not.toHaveBeenCalled();
  });
});
