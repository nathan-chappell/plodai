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
import {
  chartAgentCapability,
  csvAgentCapability,
  pdfAgentCapability,
  reportAgentCapability,
  workspaceAgentCapability,
} from "../../capabilities/definitions";
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
  workspace_id: "workspace-default",
  referenced_item_ids: ["file_csv"],
} as const;

const workspaceState = {
  version: "v1" as const,
  context: workspaceContext,
  files: [
    {
      id: "file_csv",
      name: "sales.csv",
      bucket: "uploaded",
      producer_key: "uploaded",
      producer_label: "Uploaded",
      source: "uploaded" as const,
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

  async function renderHarness(clientTools: CapabilityClientTool[] = []) {
    await act(async () => {
      root.render(
        <ChatKitHarness
          capabilityBundle={capabilityBundle}
          files={files}
          workspaceState={workspaceState}
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

  it("disables built-in feedback actions and includes the investigation brief in metadata", async () => {
    await renderHarness([]);

    expect(latestChatKitOptions?.threadItemActions).toEqual({ feedback: false });
    expect(
      buildChatKitRequestMetadata({
        capabilityBundle,
        workspaceState,
        investigationBrief: "Render the chart before stopping.",
        threadOrigin: "interactive",
      }),
    ).toMatchObject({
      investigation_brief: "Render the chart before stopping.",
      capability_bundle: capabilityBundle,
      workspace_state: workspaceState,
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

  it("defaults to compact chrome and accepts capability-specific lead text", async () => {
    await renderPane("", {
      greeting: csvAgentCapability.chatkitLead,
      composerPlaceholder: csvAgentCapability.chatkitPlaceholder,
    });

    expect(container.textContent).not.toContain("Analyst workspace");
    expect(container.textContent).not.toContain("Investigate your files");
    expect(container.textContent).not.toContain("Default model capability");
    expect(container.textContent).not.toContain("files are ready");

    const startScreen = latestChatKitOptions?.startScreen as { greeting?: string } | undefined;
    const composer = latestChatKitOptions?.composer as { placeholder?: string } | undefined;

    expect(startScreen?.greeting).toBe(csvAgentCapability.chatkitLead);
    expect(composer?.placeholder).toBe(csvAgentCapability.chatkitPlaceholder);
  });

  it("can receive compact ChatKit copy for all core capability surfaces", async () => {
    const capabilities = [
      workspaceAgentCapability,
      reportAgentCapability,
      csvAgentCapability,
      chartAgentCapability,
      pdfAgentCapability,
    ];

    for (const capability of capabilities) {
      await renderPane("", {
        greeting: capability.chatkitLead,
        composerPlaceholder: capability.chatkitPlaceholder,
      });

      const startScreen = latestChatKitOptions?.startScreen as { greeting?: string } | undefined;
      const composer = latestChatKitOptions?.composer as { placeholder?: string } | undefined;

      expect(startScreen?.greeting).toBe(capability.chatkitLead);
      expect(composer?.placeholder).toBe(capability.chatkitPlaceholder);
    }
  });

  it("uses capability-level composer tools instead of raw client function names", async () => {
    const bundleWithSpecialists: CapabilityBundle = {
      root_capability_id: "workspace-agent",
      capabilities: [
        {
          capability_id: "workspace-agent",
          agent_name: "Workspace Agent",
          instructions: "Route work.",
          client_tools: [],
          handoff_targets: [],
        },
        {
          capability_id: "report-agent",
          agent_name: "Report Agent",
          instructions: "Build reports.",
          client_tools: [
            {
              type: "function",
              name: "append_report_slide",
              description: "Append a report slide.",
              parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          ],
          handoff_targets: [],
        },
        {
          capability_id: "csv-agent",
          agent_name: "CSV Agent",
          instructions: "Analyze CSVs.",
          client_tools: [
            {
              type: "function",
              name: "create_csv_file",
              description: "Create a CSV file.",
              parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
              display: {
                label: "Create CSV File",
              },
            },
          ],
          handoff_targets: [],
        },
        {
          capability_id: "chart-agent",
          agent_name: "Chart Agent",
          instructions: "Render charts.",
          client_tools: [
            {
              type: "function",
              name: "render_chart_from_file",
              description: "Render a chart.",
              parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          ],
          handoff_targets: [],
        },
        {
          capability_id: "pdf-agent",
          agent_name: "PDF Agent",
          instructions: "Inspect PDFs.",
          client_tools: [
            {
              type: "function",
              name: "inspect_pdf_file",
              description: "Inspect a PDF.",
              parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          ],
          handoff_targets: [],
        },
      ],
    };

    await renderPane("", {
      capabilityBundle: bundleWithSpecialists,
    });

    const composer = latestChatKitOptions?.composer as
      | {
          tools?: Array<{
            id: string;
            label: string;
            shortLabel?: string;
            placeholderOverride?: string;
            icon: string;
          }>;
        }
      | undefined;

    expect(composer?.tools).toEqual([
      {
        id: "report-agent",
        label: "Report",
        shortLabel: "Report",
        placeholderOverride: "Use the report specialist for narrative investigations and saved slides.",
        icon: "document",
      },
      {
        id: "csv-agent",
        label: "CSV",
        shortLabel: "CSV",
        placeholderOverride: "Use the CSV specialist for grouped queries and reusable data artifacts.",
        icon: "analytics",
      },
      {
        id: "chart-agent",
        label: "Charts",
        shortLabel: "Charts",
        placeholderOverride: "Use the chart specialist to turn saved data artifacts into polished charts.",
        icon: "chart",
      },
      {
        id: "pdf-agent",
        label: "PDF",
        shortLabel: "PDF",
        placeholderOverride: "Use the PDF specialist for inspection, extraction, and smart splits.",
        icon: "document",
      },
    ]);
  });

  it("renders quick actions and feedback together in the header row", async () => {
    await renderPane("", {
      quickActions: [{ label: "Run demo", prompt: "Run the scripted walkthrough." }],
      showChatKitHeader: false,
    });

    const controls = container.querySelector("[data-testid='chatkit-header-controls']");
    const buttonLabels = Array.from(controls?.querySelectorAll("button") ?? []).map((button) => button.textContent?.trim());

    expect(buttonLabels).toEqual(["Run demo", "Feedback"]);
    expect((latestChatKitOptions?.header as { enabled?: boolean } | undefined)?.enabled).toBe(false);
  });

  it("runs a quick action without scheduling a synthetic follow-up turn", async () => {
    await renderPane("", {
      quickActions: [
        {
          label: "Run demo",
          prompt: "Run the scripted walkthrough.",
        },
      ],
      showChatKitHeader: false,
    });

    const sendUserMessage = latestChatKitApi?.sendUserMessage as ReturnType<typeof vi.fn> | undefined;
    const runDemoButton = container.querySelector(
      "[data-testid='chatkit-quick-action-run-demo']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      runDemoButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(sendUserMessage).toHaveBeenNthCalledWith(1, {
      text: "Run the scripted walkthrough.",
      model: "lightweight",
      newThread: true,
    });

    await act(async () => {
      latestHandlers?.onThreadChange?.({ threadId: "thread_demo" });
      latestHandlers?.onResponseStart?.();
      latestHandlers?.onResponseEnd?.();
    });

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps the feedback control in the top row and disables it while a run is active", async () => {
    await renderPane("", {
      showChatKitHeader: false,
    });

    await act(async () => {
      latestHandlers?.onReady?.();
      latestHandlers?.onThreadChange?.({ threadId: "thread_feedback" });
    });

    const topRow = container.querySelector("[data-testid='chatkit-top-row']");
    const feedbackButton = container.querySelector("[data-testid='chatkit-provide-feedback']") as HTMLButtonElement | null;

    expect(topRow?.contains(feedbackButton)).toBe(true);
    expect(feedbackButton?.textContent).toBe("Feedback");
    expect(feedbackButton?.title).toBe("Open the feedback flow for the latest assistant response in this thread.");
    expect(feedbackButton?.disabled).toBe(false);

    await act(async () => {
      latestHandlers?.onResponseStart?.();
    });

    expect(feedbackButton?.disabled).toBe(true);
  });

  it("starts feedback flow directly from the labeled feedback button", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");

    await renderPane("", {
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

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Starting feedback flow.");
  });

  it("does not send custom metadata actions from client tools while ChatKit is responding", async () => {
    const toolHandler = vi.fn(async () => ({
      workspace_context: {
        workspace_id: "workspace-default",
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
        workspace_id: "workspace-default",
        referenced_item_ids: ["file_csv"],
      },
    });
    expect(sendCustomAction).not.toHaveBeenCalled();
  });
});
