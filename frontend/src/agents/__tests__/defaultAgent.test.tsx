// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultAgentPage } from "../defaultAgent";
import type { AgentShellState, AgentPreviewModel, ShellStateMetadata } from "../../types/shell";
import type { LocalWorkspaceFile } from "../../types/report";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const {
  createContextMock,
  defaultAgentDefinition,
  latestChatPanePropsRef,
  mockClearSelectedAgentState,
  mockHandleSelectFiles,
  mockSelectContextAndAgent,
  mockUpdateAgentState,
  previewModel,
  reportAgentDefinition,
  selectedAgentState,
  selectedAgentDefinitionRef,
  selectedAgentIdRef,
  shellStateMetadata,
} = vi.hoisted(() => ({
  createContextMock: vi.fn(),
  defaultAgentDefinition: {
    id: "default-agent",
    path: "/workspace",
    navLabel: "Workspace",
    title: "Default",
    eyebrow: "Workspace",
    description: "App orientation and guided routing.",
    chatkitLead: "You are in the shared workspace. I can help you choose the right workflow or start a guided tour.",
    chatkitPlaceholder: "Ask what this app can do",
    tabs: [],
    attachmentConfig: {
      enabled: true,
    },
  },
  latestChatPanePropsRef: {
    current: null as Record<string, unknown> | null,
  },
  mockClearSelectedAgentState: vi.fn(),
  mockHandleSelectFiles: vi.fn(async () => {}),
  mockSelectContextAndAgent: vi.fn(),
  mockUpdateAgentState: vi.fn(),
  previewModel: {
    agent_id: "default-agent",
    title: "Workspace",
    items: [],
  } satisfies AgentPreviewModel,
  selectedAgentState: {
    version: "v1",
    goal: null,
    active_tab: null,
    current_report_id: null,
    resources: [],
  } satisfies AgentShellState,
  shellStateMetadata: {
    version: "v1",
    context_id: "workspace-default",
    context_name: "Workspace",
    active_agent_id: "default-agent",
    agents: [],
    resources: [],
  } satisfies ShellStateMetadata,
  reportAgentDefinition: {
    id: "report-agent",
    path: "/workspace/report",
    navLabel: "Report",
    title: "Report",
    eyebrow: "Mode",
    description: "Narrative report assembly.",
    chatkitLead: "Use Report when you want a concise write-up, saved slides, or a stakeholder-ready summary.",
    chatkitPlaceholder: "Ask for a stakeholder-ready report",
    tabs: [],
    attachmentConfig: {
      enabled: true,
    },
  },
  selectedAgentDefinitionRef: {
    current: null as Record<string, unknown> | null,
  },
  selectedAgentIdRef: {
    current: "default-agent",
  },
}));

vi.mock("../../app/context", () => ({
  useAppState: () => ({
    user: {
      id: "user_123",
      email: "nathan@example.com",
      full_name: "Nathan Chappell",
      role: "admin",
      is_active: true,
      current_credit_usd: 10,
      credit_floor_usd: 0,
    },
  }),
}));

vi.mock("../../app/workspace", () => ({
  useAgentShell: () => ({
    hydrated: true,
    contexts: [
      {
        id: "workspace-default",
        name: "Workspace",
        selected_agent_id: selectedAgentIdRef.current,
        states_by_agent_id: {
          "default-agent": selectedAgentState,
        },
        created_at: "2026-03-21T10:00:00.000Z",
        updated_at: "2026-03-21T10:00:00.000Z",
      },
    ],
    activeContextId: "workspace-default",
    activeContextName: "Workspace",
    selectedAgentId: selectedAgentIdRef.current,
    selectedAgentDefinition: selectedAgentDefinitionRef.current,
    selectedAgentState,
    selectedAgentResources: [],
    selectedAgentFiles: [],
    selectedAgentPreview: previewModel,
    sharedResources: [],
    shellStateMetadata,
    selectAgent: vi.fn(),
    selectContextAndAgent: mockSelectContextAndAgent,
    createContext: createContextMock,
    getAgentState: vi.fn(() => selectedAgentState),
    updateAgentState: mockUpdateAgentState,
    replaceAgentResources: vi.fn(),
    removeAgentResource: vi.fn(),
    clearSelectedAgentState: mockClearSelectedAgentState,
    handleSelectFiles: mockHandleSelectFiles,
    resolveResource: vi.fn(() => null),
    getPreviewResources: vi.fn(() => []),
  }),
}));

vi.mock("../../components/ChatKitPane", () => ({
  ChatKitPane: (props: Record<string, unknown>) => {
    latestChatPanePropsRef.current = props;
    const prompts = Array.isArray(props.prompts) ? props.prompts : [];
    const quickActions = Array.isArray(props.quickActions) ? props.quickActions : [];

    return (
      <div data-testid="mock-chat-pane">
        <div data-testid="mock-chat-prompts">
          {prompts.map((prompt) => (
            <span key={(prompt as { label: string }).label}>
              {(prompt as { label: string }).label}
            </span>
          ))}
        </div>
        <div data-testid="mock-chat-quick-actions">
          {quickActions.map((action) => (
            <span key={(action as { label: string }).label}>
              {(action as { label: string }).label}
            </span>
          ))}
        </div>
        <button
          data-testid="mock-chat-run-start"
          onClick={() => (props.onRunStart as (() => void) | undefined)?.()}
          type="button"
        >
          Run
        </button>
      </div>
    );
  },
}));

vi.mock("../../components/AgentPreviewPane", () => ({
  AgentPreviewPane: () => <div data-testid="mock-preview-pane">Preview</div>,
}));

vi.mock("../../components/AuthPanel", () => ({
  AuthPanel: () => <div data-testid="mock-auth-panel">Account panel</div>,
}));

vi.mock("../runtime-registry", () => ({
  buildAgentBundleForRoot: (agentId: string) => ({
    root_agent_id: agentId,
    agents: [],
  }),
  bindClientToolsForAgentBundle: () => [],
}));

describe("DefaultAgentPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    latestChatPanePropsRef.current = null;
    selectedAgentState.active_tab = null;
    selectedAgentIdRef.current = "default-agent";
    selectedAgentDefinitionRef.current = defaultAgentDefinition;
    mockUpdateAgentState.mockReset();
    mockClearSelectedAgentState.mockReset();
    mockHandleSelectFiles.mockReset();
    mockSelectContextAndAgent.mockReset();
    createContextMock.mockReset();
    createContextMock.mockReturnValue("workspace-tour");
    window.innerWidth = 400;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  it("renders mobile browser, chat, preview, and account tabs and persists pane changes", async () => {
    await act(async () => {
      root.render(<DefaultAgentPage />);
    });

    const browserTab = container.querySelector(
      "[data-testid='workspace-mobile-tab-browser']",
    ) as HTMLButtonElement | null;
    const outputsTab = container.querySelector(
      "[data-testid='workspace-mobile-tab-outputs']",
    ) as HTMLButtonElement | null;
    const accountTab = container.querySelector(
      "[data-testid='workspace-mobile-tab-account']",
    ) as HTMLButtonElement | null;

    expect(container.querySelector("[data-testid='workspace-mobile-tabs']")).not.toBeNull();
    expect(browserTab?.getAttribute("aria-pressed")).toBe("true");
    expect(outputsTab?.getAttribute("aria-pressed")).toBe("false");
    expect(accountTab?.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("Workspace");
    expect(container.textContent).toContain("Files");
    expect(container.textContent).toContain("Artifacts");
    expect(container.textContent).not.toContain("Current context");
    expect(container.textContent).toContain("Upload file");
    expect(container.querySelector("[data-testid='workspace-resource-tree']")).not.toBeNull();
    expect(container.querySelector("[data-testid='workspace-context-selector']")).not.toBeNull();
    expect(container.querySelector("[data-testid='workspace-file-input']")).not.toBeNull();
    expect(container.querySelector("[data-testid='workspace-inventory-tab-files']")).not.toBeNull();
    expect(container.querySelector("[data-testid='workspace-inventory-tab-artifacts']")).not.toBeNull();
    expect(
      container.querySelector("[data-testid='workspace-pane-browser']")?.hasAttribute("hidden"),
    ).toBe(false);
    expect(
      container.querySelector("[data-testid='workspace-pane-outputs']")?.hasAttribute("hidden"),
    ).toBe(true);
    expect(container.querySelector("[data-testid='mock-chat-pane']")).toBeNull();

    const mountUpdater = mockUpdateAgentState.mock.calls[0]?.[1] as
      | ((state: AgentShellState) => AgentShellState)
      | undefined;
    expect(mountUpdater?.(selectedAgentState).active_tab).toBe("browser");

    mockUpdateAgentState.mockClear();

    await act(async () => {
      outputsTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const clickUpdater = mockUpdateAgentState.mock.calls[0]?.[1] as
      | ((state: AgentShellState) => AgentShellState)
      | undefined;

    expect(clickUpdater?.(selectedAgentState).active_tab).toBe("outputs");

    selectedAgentState.active_tab = clickUpdater?.(selectedAgentState).active_tab ?? "outputs";

    await act(async () => {
      root.render(<DefaultAgentPage />);
    });

    expect(
      container.querySelector("[data-testid='workspace-pane-browser']")?.hasAttribute("hidden"),
    ).toBe(true);
    expect(
      container.querySelector("[data-testid='workspace-pane-outputs']")?.hasAttribute("hidden"),
    ).toBe(false);

    const artifactsTab = container.querySelector(
      "[data-testid='workspace-inventory-tab-artifacts']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      artifactsTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("No artifacts in this workspace yet.");
  });

  it("mounts the mobile chat pane only after the chat tab is opened and keeps it alive afterwards", async () => {
    await act(async () => {
      root.render(<DefaultAgentPage />);
    });

    const browserTab = container.querySelector(
      "[data-testid='workspace-mobile-tab-browser']",
    ) as HTMLButtonElement | null;
    const chatTab = container.querySelector(
      "[data-testid='workspace-mobile-tab-chat']",
    ) as HTMLButtonElement | null;

    expect(container.querySelector("[data-testid='mock-chat-pane']")).toBeNull();
    expect(latestChatPanePropsRef.current).toBeNull();

    await act(async () => {
      chatTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const chatUpdater = mockUpdateAgentState.mock.calls[1]?.[1] as
      | ((state: AgentShellState) => AgentShellState)
      | undefined;
    selectedAgentState.active_tab = chatUpdater?.(selectedAgentState).active_tab ?? "chat";

    await act(async () => {
      root.render(<DefaultAgentPage />);
    });

    expect(container.querySelector("[data-testid='mock-chat-pane']")).not.toBeNull();
    expect(latestChatPanePropsRef.current).not.toBeNull();
    expect(
      container.querySelector("[data-testid='workspace-pane-chat']")?.hasAttribute("hidden"),
    ).toBe(false);

    await act(async () => {
      browserTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const browserUpdater = mockUpdateAgentState.mock.calls[2]?.[1] as
      | ((state: AgentShellState) => AgentShellState)
      | undefined;
    selectedAgentState.active_tab = browserUpdater?.(selectedAgentState).active_tab ?? "browser";

    await act(async () => {
      root.render(<DefaultAgentPage />);
    });

    expect(
      container.querySelector("[data-testid='workspace-pane-chat']")?.hasAttribute("hidden"),
    ).toBe(true);
    expect(container.querySelector("[data-testid='mock-chat-pane']")).not.toBeNull();
  });

  it("routes workspace uploads through the browser instead of ChatKit attachments", async () => {
    const uploadedFile = {
      id: "file-sales.csv",
      name: "sales.csv",
      kind: "csv",
      extension: "csv",
      row_count: 1,
      columns: ["region"],
      numeric_columns: [],
      sample_rows: [{ region: "West" }],
      preview_rows: [{ region: "West" }],
      rows: [{ region: "West" }],
    } satisfies LocalWorkspaceFile;
    mockHandleSelectFiles.mockResolvedValueOnce([uploadedFile]);

    await act(async () => {
      root.render(<DefaultAgentPage />);
    });

    const fileInput = container.querySelector(
      "[data-testid='workspace-file-input']",
    ) as HTMLInputElement | null;
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

    expect(mockHandleSelectFiles).toHaveBeenCalledWith("default-agent", [upload]);
  });

  it("shows tour entry prompts without restoring quick-action clutter", async () => {
    window.innerWidth = 1280;

    await act(async () => {
      root.render(<DefaultAgentPage />);
    });

    expect(container.textContent).toContain("Start report tour");
    expect(container.textContent).toContain("Start document tour");
    expect(container.textContent).toContain("Help me choose a tour");
    expect(
      Array.isArray(latestChatPanePropsRef.current?.quickActions)
        ? latestChatPanePropsRef.current?.quickActions
        : [],
    ).toEqual([]);
  });

  it("switches starter prompts and greeting when a specialist tool is selected", async () => {
    window.innerWidth = 1280;
    selectedAgentIdRef.current = "report-agent";
    selectedAgentDefinitionRef.current = reportAgentDefinition;

    await act(async () => {
      root.render(<DefaultAgentPage />);
    });

    expect(container.textContent).toContain("Draft a summary");
    expect(container.textContent).toContain("Build a report update");
    expect(container.textContent).toContain("Review report outputs");
    expect(container.textContent).not.toContain("Start report tour");
    expect(latestChatPanePropsRef.current?.greeting).toBe(reportAgentDefinition.chatkitLead);
    expect(latestChatPanePropsRef.current?.investigationBrief).toBe("");
    expect(latestChatPanePropsRef.current?.composerToolIds).toEqual([
      "report-agent",
      "document-agent",
      "agriculture-agent",
    ]);
  });

  it("promotes a selected guided-tour scenario into the launcher", async () => {
    window.innerWidth = 1280;

    await act(async () => {
      root.render(<DefaultAgentPage />);
    });
    expect(latestChatPanePropsRef.current?.tourLauncher).toBeNull();

    await act(async () => {
      await (
        latestChatPanePropsRef.current?.onSelectTourScenario as
          | ((scenarioId: string) => Promise<void>)
          | undefined
      )?.("report-tour");
    });

    expect(latestChatPanePropsRef.current?.tourLauncher).toMatchObject({
      type: "tour_requested",
      scenarioId: "report-tour",
      title: "Report tour",
      targetAgentId: "report-agent",
      defaultAssetCount: 2,
    });
  });

  it("opens the inline tour launcher from client effects and prepares a fresh context on upload", async () => {
    window.innerWidth = 1280;

    await act(async () => {
      root.render(<DefaultAgentPage />);
    });

    await act(async () => {
      (latestChatPanePropsRef.current?.onEffects as
        | ((effects: Array<Record<string, unknown>>) => void)
        | undefined)?.([
        {
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
      ]);
    });

    expect(latestChatPanePropsRef.current?.tourLauncher).toEqual({
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
    });

    const upload = new File(["region,revenue\nWest,120\n"], "sales.csv", {
      type: "text/csv",
    });

    await act(async () => {
      await (
        latestChatPanePropsRef.current?.onSubmitTourSelection as
          | ((selection: {
              scenarioId: string;
              source: "default" | "upload";
              files?: File[];
            }) => Promise<void>)
          | undefined
      )?.({
        scenarioId: "report-tour",
        source: "upload",
        files: [upload],
      });
    });

    expect(createContextMock).toHaveBeenCalledWith({
      agentId: "report-agent",
      name: "Report tour",
    });
    expect(mockHandleSelectFiles).toHaveBeenCalledWith("report-agent", [upload], {
      contextId: "workspace-tour",
    });
    expect(mockSelectContextAndAgent).toHaveBeenCalledWith("workspace-tour", "report-agent");
    expect(latestChatPanePropsRef.current?.tourLauncher).toBeNull();
    expect(latestChatPanePropsRef.current?.scheduledPrompt).toMatchObject({
      prompt: expect.stringContaining("Start the report tour in the current workspace."),
      model: "lightweight",
      agentId: "report-agent",
    });
  });
});
