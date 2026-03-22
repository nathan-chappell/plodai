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
    tourState: vi.fn(),
    responseEnd: vi.fn(),
    responseStart: vi.fn(),
    workspaceEvent: vi.fn(),
  },
}));

import { ChatKitHarness, ChatKitPane, buildChatKitRequestMetadata } from "../ChatKitPane";
import type { AgentBundle, AgentClientTool } from "../../agents/types";
import {
  agricultureAgentDefinition,
  analysisAgentDefinition,
  documentAgentDefinition,
  defaultAgentDefinition,
  reportAgentDefinition,
} from "../../agents/definitions";
import type { LocalWorkspaceFile } from "../../types/report";
import type { ShellStateMetadata } from "../../types/shell";

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
  root_agent_id: "report-agent",
  agents: [
    {
      agent_id: "report-agent",
      agent_name: "Report",
      instructions: "Inspect files.",
      client_tools: [],
      delegation_targets: [],
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

const shellState: ShellStateMetadata = {
  version: "v1" as const,
  context_id: "workspace-default",
  context_name: "Workspace",
  active_agent_id: "report-agent",
  agents: [
    {
      agent_id: "report-agent",
      goal: null,
      resource_count: 1,
      current_report_id: "report-1",
    },
  ],
  resources: [
    {
      id: "file_csv",
      owner_agent_id: "report-agent",
      origin: "uploaded",
      kind: "dataset",
      title: "sales.csv",
      created_at: "2026-03-21T12:00:00.000Z",
      summary: "1 row · 1 column",
      payload_ref: "file_csv",
      extension: "csv",
      row_count: 1,
      columns: ["region"],
      numeric_columns: [],
      sample_rows: [{ region: "West" }],
    },
  ],
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
    setChatKitMetadataGetter(null);
    setChatKitNativeFeedbackHandler(null);
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function renderHarness(clientTools: AgentClientTool[] = []) {
    await act(async () => {
      root.render(
        <ChatKitHarness
          agentBundle={agentBundle}
          files={files}
          shellState={shellState}
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
          agentBundle={agentBundle}
          enabled
          files={files}
          shellState={shellState}
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

  it("enables built-in feedback actions and includes the investigation brief in metadata", async () => {
    await renderHarness([]);

    expect(latestChatKitOptions?.threadItemActions).toEqual({ feedback: true });
    expect(
      buildChatKitRequestMetadata({
        agentBundle,
        shellState,
        investigationBrief: "Render the chart before stopping.",
        threadOrigin: "interactive",
      }),
    ).toMatchObject({
      investigation_brief: "Render the chart before stopping.",
      agent_bundle: agentBundle,
      shell_state: shellState,
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

  it("defaults to compact chrome and accepts agent-specific lead text", async () => {
    await renderPane("", {
      greeting: analysisAgentDefinition.chatkitLead,
      composerPlaceholder: analysisAgentDefinition.chatkitPlaceholder,
    });

    expect(container.textContent).not.toContain("Analyst workspace");
    expect(container.textContent).not.toContain("Investigate your files");
    expect(container.textContent).not.toContain("Default model agent");
    expect(container.textContent).not.toContain("files are ready");

    const startScreen = latestChatKitOptions?.startScreen as { greeting?: string } | undefined;
    const composer = latestChatKitOptions?.composer as { placeholder?: string } | undefined;

    expect(startScreen?.greeting).toBe(analysisAgentDefinition.chatkitLead);
    expect(composer?.placeholder).toBe(analysisAgentDefinition.chatkitPlaceholder);
  });

  it("keeps the top row hidden until there is useful status or an action to show", async () => {
    await renderPane("");

    expect(container.querySelector("[data-testid='chatkit-top-row']")).toBeNull();

    await act(async () => {
      latestHandlers?.onResponseStart?.();
    });

    expect(container.querySelector("[data-testid='chatkit-top-row']")).not.toBeNull();
    expect(container.textContent).toContain("Agent run in progress.");
  });

  it("can receive compact ChatKit copy for all core agent surfaces", async () => {
    const agents = [
      defaultAgentDefinition,
      reportAgentDefinition,
      analysisAgentDefinition,
      documentAgentDefinition,
      agricultureAgentDefinition,
    ];

    for (const agent of agents) {
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

  it("hides agent composer tools when the shared workspace drives mode selection", async () => {
    const bundleWithSpecialists: AgentBundle = {
      root_agent_id: "default-agent",
      agents: [
        {
          agent_id: "default-agent",
          agent_name: "Default",
          instructions: "Route work.",
          client_tools: [],
          delegation_targets: [],
        },
        {
          agent_id: "report-agent",
          agent_name: "Report",
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
          delegation_targets: [],
        },
        {
          agent_id: "analysis-agent",
          agent_name: "Analysis",
          instructions: "Analyze data and coordinate charts.",
          client_tools: [
            {
              type: "function",
              name: "list_datasets",
              description: "List datasets.",
              parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
              display: {
                label: "List CSV Files",
              },
            },
          ],
          delegation_targets: [],
        },
        {
          agent_id: "chart-agent",
          agent_name: "Charts",
          instructions: "Render charts.",
          client_tools: [
            {
              type: "function",
              name: "render_chart_from_dataset",
              description: "Render a chart.",
              parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          ],
          delegation_targets: [],
        },
        {
          agent_id: "document-agent",
          agent_name: "Documents",
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
          delegation_targets: [],
        },
        {
          agent_id: "agriculture-agent",
          agent_name: "Agriculture",
          instructions: "Inspect plant photos.",
          client_tools: [
            {
              type: "function",
              name: "inspect_image_file",
              description: "Inspect an image.",
              parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          ],
          delegation_targets: [],
        },
      ],
    };

    await renderPane("", {
      agentBundle: bundleWithSpecialists,
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

    expect(composer?.tools).toEqual([]);
  });

  it("uses composer tool overrides to expose workspace agent switching and resets to default after the specialist run settles", async () => {
    const onSelectAgent = vi.fn();

    await renderPane("", {
      agentBundle: {
        root_agent_id: "default-agent",
        agents: [
          {
            agent_id: "default-agent",
            agent_name: "Default",
            instructions: "Route work.",
            client_tools: [],
            delegation_targets: [],
          },
        ],
      },
      defaultAgentId: "default-agent",
      composerToolIds: [
        "report-agent",
        "analysis-agent",
        "chart-agent",
        "document-agent",
        "agriculture-agent",
      ],
      onSelectAgent,
    });

    const composer = latestChatKitOptions?.composer as
      | {
          tools?: Array<{
            id: string;
            label: string;
            persistent?: boolean;
          }>;
        }
      | undefined;

    expect(composer?.tools?.map((tool) => ({
      id: tool.id,
      label: tool.label,
      persistent: tool.persistent,
    }))).toEqual([
      { id: "report-agent", label: "Report", persistent: false },
      { id: "analysis-agent", label: "Analysis", persistent: false },
      { id: "chart-agent", label: "Charts", persistent: false },
      { id: "document-agent", label: "Documents", persistent: false },
      { id: "agriculture-agent", label: "Agriculture", persistent: false },
    ]);

    await act(async () => {
      latestHandlers?.onToolChange?.({ toolId: "report-agent" });
    });

    expect(onSelectAgent).toHaveBeenCalledWith("report-agent");

    await renderPane("", {
      agentBundle: {
        root_agent_id: "report-agent",
        agents: [
          {
            agent_id: "report-agent",
            agent_name: "Report",
            instructions: "Build reports.",
            client_tools: [],
            delegation_targets: [],
          },
        ],
      },
      defaultAgentId: "default-agent",
      composerToolIds: [
        "report-agent",
        "analysis-agent",
        "chart-agent",
        "document-agent",
        "agriculture-agent",
      ],
      onSelectAgent,
    });

    await act(async () => {
      latestHandlers?.onToolChange?.({ toolId: null });
    });

    expect(onSelectAgent).toHaveBeenCalledTimes(1);

    await act(async () => {
      latestHandlers?.onResponseEnd?.();
    });

    expect(onSelectAgent).toHaveBeenLastCalledWith("default-agent");
  });

  it("renders quick actions in the header row when the custom feedback button is removed", async () => {
    await renderPane("", {
      quickActions: [{ label: "Run tour", prompt: "Run the scripted walkthrough." }],
      showChatKitHeader: false,
    });

    const controls = container.querySelector("[data-testid='chatkit-header-controls']");
    const buttonLabels = Array.from(controls?.querySelectorAll("button") ?? []).map((button) => button.textContent?.trim());

    expect(buttonLabels).toEqual(["Run tour"]);
    expect((latestChatKitOptions?.header as { enabled?: boolean } | undefined)?.enabled).toBe(false);
  });

  it("runs a quick action without scheduling a synthetic follow-up turn", async () => {
    await renderPane("", {
      quickActions: [
        {
          label: "Run tour",
          prompt: "Run the scripted walkthrough.",
        },
      ],
      showChatKitHeader: false,
    });

    const sendUserMessage = latestChatKitApi?.sendUserMessage as ReturnType<typeof vi.fn> | undefined;
    const runTourButton = container.querySelector(
      "[data-testid='chatkit-quick-action-run-tour']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      runTourButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(sendUserMessage).toHaveBeenNthCalledWith(1, {
      text: "Run the scripted walkthrough.",
      model: "lightweight",
      newThread: true,
    });

    await act(async () => {
      latestHandlers?.onThreadChange?.({ threadId: "thread_tour" });
      latestHandlers?.onResponseStart?.();
      latestHandlers?.onResponseEnd?.();
    });

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("renders the inline guided tour launcher and lets the user cancel it", async () => {
    const onDismissTourLauncher = vi.fn();

    await renderPane("", {
      files: [],
      tourLauncher: {
        type: "tour_requested",
        scenarioId: "report-tour",
        title: "Report tour",
        summary: "Create one chart-backed report slide.",
        workspaceName: "Report tour",
        targetAgentId: "report-agent",
        uploadConfig: {
          accept: {
            "text/csv": [".csv"],
            "application/pdf": [".pdf"],
          },
          max_count: 4,
          helper_text: "Upload one or more reporting inputs.",
        },
        defaultAssetCount: 2,
      },
      onDismissTourLauncher,
    });

    expect(container.textContent).toContain("Guided Tour");
    expect(container.textContent).toContain("Report tour");
    expect(container.textContent).toContain("Upload one or more reporting inputs.");
    expect(container.textContent).toContain("Built-in default: 2 files.");

    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Cancel",
    );

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onDismissTourLauncher).toHaveBeenCalledOnce();
  });

  it("opens the selected tour scenario from a ChatKit tour-picker widget action", async () => {
    const onSelectTourScenario = vi.fn(async () => undefined);

    await renderPane("", {
      onSelectTourScenario,
    });

    const onAction = (
      latestChatKitOptions?.widgets as
        | {
            onAction?: (
              action: { type: string; payload?: Record<string, unknown> },
              widgetItem: { id: string },
            ) => Promise<void>;
          }
        | undefined
    )?.onAction;

    await act(async () => {
      await onAction?.(
        {
          type: "submit_tour_picker",
          payload: {
            scenario_id: "report-tour",
          },
        },
        {
          id: "widget_tour_picker",
        },
      );
    });

    expect(onSelectTourScenario).toHaveBeenCalledWith("report-tour");
    expect(latestChatKitApi?.sendCustomAction).toHaveBeenCalledWith(
      {
        type: "submit_tour_picker",
        payload: {
          scenario_id: "report-tour",
        },
      },
      "widget_tour_picker",
    );
  });

  it("forwards tour-picker cancel actions without opening a launcher", async () => {
    const onSelectTourScenario = vi.fn(async () => undefined);

    await renderPane("", {
      onSelectTourScenario,
    });

    const onAction = (
      latestChatKitOptions?.widgets as
        | {
            onAction?: (
              action: { type: string; payload?: Record<string, unknown> },
              widgetItem: { id: string },
            ) => Promise<void>;
          }
        | undefined
    )?.onAction;

    await act(async () => {
      await onAction?.(
        {
          type: "cancel_tour_picker",
          payload: {},
        },
        {
          id: "widget_tour_picker",
        },
      );
    });

    expect(onSelectTourScenario).not.toHaveBeenCalled();
    expect(latestChatKitApi?.sendCustomAction).toHaveBeenCalledWith(
      {
        type: "cancel_tour_picker",
        payload: {},
      },
      "widget_tour_picker",
    );
  });

  it("opens the hidden file picker and submits uploaded guided-tour files", async () => {
    const onSubmitTourSelection = vi.fn(async () => undefined);
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, "click");

    await renderPane("", {
      files: [],
      tourLauncher: {
        type: "tour_requested",
        scenarioId: "report-tour",
        title: "Report tour",
        summary: "Create one chart-backed report slide.",
        workspaceName: "Report tour",
        targetAgentId: "report-agent",
        uploadConfig: {
          accept: {
            "text/csv": [".csv"],
            "application/pdf": [".pdf"],
          },
          max_count: 4,
          helper_text: "Upload one or more reporting inputs.",
        },
        defaultAssetCount: 2,
      },
      onSubmitTourSelection,
    });

    const uploadButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Upload your own file(s)",
    );
    const fileInput = container.querySelector(
      "[data-testid='chatkit-tour-file-input']",
    ) as HTMLInputElement | null;

    expect(fileInput?.getAttribute("accept")).toBe("text/csv,.csv,application/pdf,.pdf");
    expect(fileInput?.multiple).toBe(true);

    await act(async () => {
      uploadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(inputClickSpy).toHaveBeenCalled();

    const upload = new File(["region,revenue\nWest,120\n"], "sales.csv", {
      type: "text/csv",
    });
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [upload],
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSubmitTourSelection).toHaveBeenCalledWith({
      scenarioId: "report-tour",
      source: "upload",
      files: [upload],
    });
  });

  it("submits the built-in default guided-tour option", async () => {
    const onSubmitTourSelection = vi.fn(async () => undefined);

    await renderPane("", {
      files: [],
      tourLauncher: {
        type: "tour_requested",
        scenarioId: "document-tour",
        title: "Document tour",
        summary: "Inspect a PDF and produce a useful smart split.",
        workspaceName: "Document tour",
        targetAgentId: "document-agent",
        uploadConfig: {
          accept: {
            "application/pdf": [".pdf"],
          },
          max_count: 1,
          helper_text: "Upload a single PDF to inspect and split.",
        },
        defaultAssetCount: 1,
      },
      onSubmitTourSelection,
    });

    const defaultButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Use built-in default",
    );
    const fileInput = container.querySelector(
      "[data-testid='chatkit-tour-file-input']",
    ) as HTMLInputElement | null;

    expect(fileInput?.getAttribute("accept")).toBe("application/pdf,.pdf");
    expect(fileInput?.multiple).toBe(false);

    await act(async () => {
      defaultButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSubmitTourSelection).toHaveBeenCalledWith({
      scenarioId: "document-tour",
      source: "default",
    });
  });

  it("auto-dispatches a scheduled guided-tour prompt into a fresh thread", async () => {
    const onScheduledPromptDispatched = vi.fn();

    await act(async () => {
      root.render(
        <ChatKitHarness
          agentBundle={agentBundle}
          files={files}
          shellState={shellState}
          investigationBrief=""
          clientTools={[]}
          onEffects={() => {}}
          scheduledPrompt={{
            id: "tour:report-tour:1",
            prompt: "Start the report tour in the current workspace.",
            model: "balanced",
            agentId: "report-agent",
          }}
          onScheduledPromptDispatched={onScheduledPromptDispatched}
        />,
      );
    });

    const sendUserMessage = latestChatKitApi?.sendUserMessage as ReturnType<typeof vi.fn> | undefined;

    expect(sendUserMessage).toHaveBeenCalledWith({
      text: "Start the report tour in the current workspace.",
      model: "balanced",
      newThread: true,
    });
    expect(onScheduledPromptDispatched).toHaveBeenCalledWith("tour:report-tour:1");
  });

  it("does not render a custom feedback control in the top row", async () => {
    await renderPane("", {
      showChatKitHeader: false,
    });

    expect(container.querySelector("[data-testid='chatkit-provide-feedback']")).toBeNull();
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
