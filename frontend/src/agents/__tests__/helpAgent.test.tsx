// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HelpAgentPage } from "../helpAgent";
import type { AgentShellState, AgentPreviewModel, ShellStateMetadata } from "../../types/shell";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const {
  helpAgentDefinition,
  latestChatPanePropsRef,
  mockClearSelectedAgentState,
  mockHandleSelectFiles,
  mockUpdateAgentState,
  previewModel,
  selectedAgentState,
  shellStateMetadata,
  scrollToSpy,
} = vi.hoisted(() => ({
  helpAgentDefinition: {
    id: "help-agent",
    path: "/workspace",
    navLabel: "Workspace",
    title: "Workspace",
    eyebrow: "Workspace",
    description: "App orientation and guided routing.",
    chatkitLead: "Explain the workspace and route to the right surface.",
    chatkitPlaceholder: "Ask what this app can do",
    tabs: [],
  },
  latestChatPanePropsRef: {
    current: null as Record<string, unknown> | null,
  },
  mockClearSelectedAgentState: vi.fn(),
  mockHandleSelectFiles: vi.fn(async () => {}),
  mockUpdateAgentState: vi.fn(),
  previewModel: {
    agent_id: "help-agent",
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
    active_agent_id: "help-agent",
    agents: [],
    resources: [],
  } satisfies ShellStateMetadata,
  scrollToSpy: vi.fn(),
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
    selectedAgentId: "help-agent",
    selectedAgentDefinition: helpAgentDefinition,
    selectedAgentState,
    selectedAgentResources: [],
    selectedAgentFiles: [],
    selectedAgentPreview: previewModel,
    sharedResources: [],
    shellStateMetadata,
    selectAgent: vi.fn(),
    getAgentState: vi.fn(() => selectedAgentState),
    updateAgentState: mockUpdateAgentState,
    replaceAgentResources: vi.fn(),
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

vi.mock("../runtime-registry", () => ({
  buildAgentBundleForRoot: () => ({
    root_agent_id: "help-agent",
    agents: [],
  }),
  bindClientToolsForAgentBundle: () => [],
}));

describe("HelpAgentPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    latestChatPanePropsRef.current = null;
    selectedAgentState.active_tab = null;
    mockUpdateAgentState.mockReset();
    mockClearSelectedAgentState.mockReset();
    mockHandleSelectFiles.mockReset();
    scrollToSpy.mockReset();
    window.innerWidth = 400;
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollToSpy,
    });
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

  it("renders overview, chat, and outputs mobile tabs and persists pane changes", async () => {
    await act(async () => {
      root.render(<HelpAgentPage />);
    });

    const browserTab = container.querySelector(
      "[data-testid='help-workspace-mobile-tab-browser']",
    ) as HTMLButtonElement | null;
    const outputsTab = container.querySelector(
      "[data-testid='help-workspace-mobile-tab-outputs']",
    ) as HTMLButtonElement | null;

    expect(container.querySelector("[data-testid='help-workspace-mobile-tabs']")).not.toBeNull();
    expect(browserTab?.getAttribute("aria-pressed")).toBe("true");
    expect(outputsTab?.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("Workspace browser");
    expect(container.textContent).toContain("Current workspace");
    expect(container.querySelector("[data-testid='help-workspace-tree']")).not.toBeNull();
    expect(container.querySelector("[data-testid='help-workspace-selector']")).toBeNull();

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
    expect(scrollToSpy).toHaveBeenCalled();
  });

  it("removes demo quick actions and demo starter prompts from the help surface", async () => {
    await act(async () => {
      root.render(<HelpAgentPage />);
    });

    expect(container.textContent).not.toContain("Show demos");
    expect(container.textContent).not.toContain("Start report demo");
    expect(container.textContent).not.toContain("Start document demo");
    expect(
      Array.isArray(latestChatPanePropsRef.current?.quickActions)
        ? latestChatPanePropsRef.current?.quickActions
        : [],
    ).toEqual([]);
  });
});
