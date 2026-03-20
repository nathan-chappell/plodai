// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShellWorkspaceArtifact } from "../types";
import type { LocalWorkspaceFile } from "../../types/report";
import type { WorkspaceReportV1 } from "../../types/workspace-contract";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const mockUseCapabilityFileWorkspace = vi.fn();

vi.mock("../fileWorkspace", () => ({
  useCapabilityFileWorkspace: (...args: unknown[]) =>
    mockUseCapabilityFileWorkspace(...args),
}));

vi.mock("../runtime-registry", () => ({
  bindClientToolsForBundle: () => [],
  buildCapabilityBundleForRoot: () => ({
    root_capability_id: "workspace-agent",
    capabilities: [
      {
        capability_id: "workspace-agent",
        agent_name: "Workspace Agent",
        instructions: "Route work.",
        client_tools: [],
        handoff_targets: [],
      },
    ],
  }),
  listCapabilityBundleToolNames: () => ["list_reports"],
}));

vi.mock("../workspace-agent/demo", () => ({
  buildWorkspaceAgentDemoScenario: () =>
    Promise.resolve({
      id: "workspace-demo",
      title: "Workspace demo",
      summary: "Run the shared workspace demo.",
      initialPrompt: "Run the workspace demo.",
      workspaceSeed: [],
      expectedOutcomes: [
        "Routes work through the shared workspace",
        "Keeps the newest output visible",
      ],
      notes: ["Uses one shared chat surface."],
    }),
}));

vi.mock("../../app/context", () => ({
  useAppState: () => ({
    user: { id: "user-1", role: "admin" },
  }),
}));

vi.mock("../../components/AuthPanel", () => ({
  AuthPanel: () => <div data-testid="mock-auth-panel">account</div>,
}));

vi.mock("../../components/ChatKitPane", () => ({
  ChatKitPane: () => <div data-testid="mock-chatkit-pane">chat</div>,
}));

import { WorkspaceAgentPage } from "../workspaceAgent";

const csvFile: LocalWorkspaceFile = {
  id: "sales-demo",
  name: "sales_demo.csv",
  kind: "csv",
  extension: "csv",
  mime_type: "text/csv",
  byte_size: 182,
  row_count: 2,
  columns: ["region", "revenue"],
  numeric_columns: ["revenue"],
  sample_rows: [{ region: "West", revenue: 42 }],
  preview_rows: [
    { region: "West", revenue: 42 },
    { region: "East", revenue: 36 },
  ],
  rows: [
    { region: "West", revenue: 42 },
    { region: "East", revenue: 36 },
  ],
};

const currentReport: WorkspaceReportV1 = {
  version: "v1",
  report_id: "report-1",
  title: "Weekly summary",
  created_at: "2026-03-20T10:00:00.000Z",
  updated_at: "2026-03-20T10:05:00.000Z",
  slides: [
    {
      id: "slide-1",
      created_at: "2026-03-20T10:05:00.000Z",
      title: "Revenue summary",
      layout: "1x1",
      panels: [
        {
          id: "panel-1",
          type: "narrative",
          title: "Summary",
          markdown: "West region revenue leads the pack.",
        },
      ],
    },
  ],
};

const artifacts: ShellWorkspaceArtifact[] = [
  {
    entryId: "artifact-sales",
    createdAt: "2026-03-20T10:06:00.000Z",
    bucket: "uploaded",
    source: "uploaded",
    producerKey: "uploaded",
    producerLabel: "Uploaded",
    file: csvFile,
  },
];

function createWorkspaceResult() {
  return {
    entries: [],
    files: [csvFile],
    setFiles: vi.fn(),
    appendFiles: vi.fn(),
    artifacts,
    smartSplitBundles: [],
    setStatus: vi.fn(),
    investigationBrief: "",
    setReportEffects: vi.fn(),
    handleFiles: vi.fn(async () => {}),
    handleRemoveEntry: vi.fn(),
    workspaceContext: {
      workspace_id: "workspace-default",
      referenced_item_ids: [],
    },
    workspaceHydrated: true,
    getState: vi.fn(() => ({
      workspaceId: "workspace-default",
      files: [csvFile],
      entries: [],
      filesystem: {
        version: "v1",
        artifacts_by_id: {},
        app_state: null,
        report_index: null,
        reports_by_id: {},
        tool_catalog: null,
        workspace_index: null,
        pdf_smart_splits: null,
        agents_markdown: null,
      },
      workspaceContext: {
        workspace_id: "workspace-default",
        referenced_item_ids: [],
      },
    })),
    updateFilesystem: vi.fn(),
    syncToolCatalog: vi.fn(),
    appendReportEffects: vi.fn(),
    currentReport,
    workspaceStateMetadata: {
      version: "v1" as const,
      context: {
        workspace_id: "workspace-default",
        referenced_item_ids: [],
      },
      files: [],
      reports: [],
      current_report_id: currentReport.report_id,
      current_goal: null,
    },
    workspaces: [
      {
        id: "workspace-default",
        name: "Default workspace",
        kind: "default" as const,
        created_at: "2026-03-20T00:00:00.000Z",
      },
    ],
    selectedWorkspaceId: "workspace-default",
    selectedWorkspaceName: "Default workspace",
    selectedWorkspaceKind: "default" as const,
    selectWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    clearWorkspace: vi.fn(),
  };
}

describe("WorkspaceAgentPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockUseCapabilityFileWorkspace.mockReturnValue(createWorkspaceResult());
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.clearAllMocks();
  });

  it("renders the shared workspace rail with demo notes, report drawer, and latest preview", async () => {
    await act(async () => {
      root.render(<WorkspaceAgentPage />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Workspace");
    expect(container.textContent).toContain("Demo notes");
    expect(container.textContent).toContain("Preview: sales_demo.csv");
    expect(container.textContent).toContain("Weekly summary");
    expect(container.querySelector("[data-testid='mock-chatkit-pane']")).not.toBeNull();
  });
});
