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

vi.mock("../registry", () => ({
  bindClientToolsForBundle: () => [],
  buildCapabilityBundleForRoot: (rootCapabilityId: string) => ({
    root_capability_id: rootCapabilityId,
    capabilities: [
      {
        capability_id: rootCapabilityId,
        agent_name: rootCapabilityId,
        instructions: "Inspect the workspace.",
        client_tools: [],
        handoff_targets: [],
      },
    ],
  }),
  listCapabilityBundleToolNames: () => [],
}));

vi.mock("../shared/useDemoScenario", () => ({
  useDemoScenario: () => ({
    scenario: null,
    loading: false,
    error: null,
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
  ChatKitPane: () => <div data-testid="mock-chatkit-pane">chatkit</div>,
}));

vi.mock("../../components/CapabilityDemoPane", () => ({
  CapabilityDemoPane: () => <div data-testid="mock-demo-pane">demo</div>,
  hasDemoScenarioNotes: () => false,
}));

vi.mock("../../components/DatasetChart", () => ({
  DatasetChart: ({ spec }: { spec: { title: string } }) => (
    <div data-testid="mock-dataset-chart">{spec.title}</div>
  ),
}));

import { ReportFoundryPage } from "../reportFoundry";
import { CsvAgentPage } from "../csvAgent";
import { ChartAgentPage } from "../chartAgent";
import { PdfAgentPage } from "../pdfAgent";

const workspaces = [
  {
    id: "default",
    name: "Default workspace",
    kind: "default" as const,
    created_at: "2026-03-20T00:00:00.000Z",
  },
];

const baseWorkspaceStateMetadata = {
  version: "v1" as const,
  context: {
    path_prefix: "/",
    referenced_item_ids: [],
  },
  files: [],
  reports: [],
  current_report_id: null,
  current_goal: null,
};

const reportFile: LocalWorkspaceFile = {
  id: "sales-csv",
  name: "sales.csv",
  kind: "csv",
  extension: "csv",
  mime_type: "text/csv",
  byte_size: 64,
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
  report_id: "board-report",
  title: "Board revenue report",
  created_at: "2026-03-20T10:00:00.000Z",
  updated_at: "2026-03-20T10:00:00.000Z",
  slides: [],
};

function createBaseWorkspaceResult() {
  return {
    activePrefix: "/",
    cwdPath: "/",
    entries: [],
    files: [] as LocalWorkspaceFile[],
    setFiles: vi.fn(),
    appendFiles: vi.fn(),
    artifacts: [] as ShellWorkspaceArtifact[],
    setStatus: vi.fn(),
    investigationBrief: "",
    activeWorkspaceTab: "agent",
    setActiveWorkspaceTab: vi.fn(),
    executionMode: "interactive" as const,
    setExecutionMode: vi.fn(),
    reportEffects: [],
    setReportEffects: vi.fn(),
    handleFiles: vi.fn(async () => {}),
    handleRemoveEntry: vi.fn(),
    createDirectory: vi.fn((path: string) => path),
    changeDirectory: vi.fn((path: string) => path),
    setActivePrefix: vi.fn(),
    workspaceContext: {
      path_prefix: "/",
      referenced_item_ids: [],
    },
    workspaceHydrated: true,
    getState: vi.fn(() => ({
      activePrefix: "/",
      cwdPath: "/",
      files: [],
      entries: [],
      filesystem: { files_by_path: {} },
      workspaceContext: {
        path_prefix: "/",
        referenced_item_ids: [],
      },
    })),
    updateFilesystem: vi.fn(),
    syncToolCatalog: vi.fn(),
    appendReportEffects: vi.fn(),
    currentReport: null as WorkspaceReportV1 | null,
    workspaceStateMetadata: baseWorkspaceStateMetadata,
    workspaces,
    selectedWorkspaceId: "default",
    selectedWorkspaceName: "Default workspace",
    selectedWorkspaceKind: "default" as const,
    selectWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    clearWorkspace: vi.fn(),
  };
}

describe("capability page quick views", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps Report Agent focused on the current report and removes the inline workspace artifacts panel", async () => {
    mockUseCapabilityFileWorkspace.mockReturnValue({
      ...createBaseWorkspaceResult(),
      activeWorkspaceTab: "report",
      files: [reportFile],
      currentReport,
    });

    await act(async () => {
      root.render(<ReportFoundryPage />);
    });

    expect(container.textContent).toContain("Current report");
    expect(container.textContent).toContain("Board revenue report");
    expect(container.textContent).not.toContain("Workspace artifacts");
  });

  it("keeps the report demo tab focused on demo notes and the current report without a workspace artifacts helper", async () => {
    mockUseCapabilityFileWorkspace.mockReturnValue({
      ...createBaseWorkspaceResult(),
      activeWorkspaceTab: "demo",
      files: [reportFile],
      currentReport,
    });

    await act(async () => {
      root.render(<ReportFoundryPage />);
    });

    expect(container.textContent).toContain("Current report");
    expect(container.textContent).toContain("demo");
    expect(container.textContent).not.toContain("Workspace artifacts");
  });

  it("shows the CSV quick view and keeps the helper column visible even when it is empty", async () => {
    const csvArtifact: ShellWorkspaceArtifact = {
      entryId: "derived-csv-entry",
      path: "/artifacts/data/revenue_slice.csv",
      createdAt: "2026-03-20T11:00:00.000Z",
      source: "derived",
      producerKey: "artifacts",
      producerLabel: "Artifacts",
      file: {
        id: "derived-csv",
        name: "revenue_slice.csv",
        kind: "csv",
        extension: "csv",
        mime_type: "text/csv",
        byte_size: 96,
        row_count: 2,
        columns: ["segment", "revenue"],
        numeric_columns: ["revenue"],
        sample_rows: [{ segment: "A", revenue: 120 }],
        preview_rows: [
          { segment: "A", revenue: 120 },
          { segment: "B", revenue: 80 },
        ],
        rows: [
          { segment: "A", revenue: 120 },
          { segment: "B", revenue: 80 },
        ],
      },
    };

    mockUseCapabilityFileWorkspace.mockReturnValue({
      ...createBaseWorkspaceResult(),
      artifacts: [csvArtifact],
      activeWorkspaceTab: "agent",
    });

    await act(async () => {
      root.render(<CsvAgentPage />);
    });

    expect(container.querySelector("[data-testid='csv-agent-quick-view']")).not.toBeNull();
    expect(container.textContent).toContain("CSV results");
    expect(container.textContent).toContain("Table preview");
    expect(container.textContent).toContain("segment");
    expect(container.textContent).toContain("revenue");

    mockUseCapabilityFileWorkspace.mockReturnValue({
      ...createBaseWorkspaceResult(),
      artifacts: [],
      activeWorkspaceTab: "agent",
    });

    await act(async () => {
      root.render(<CsvAgentPage />);
    });

    expect(container.querySelector("[data-testid='csv-agent-quick-view']")).not.toBeNull();
    expect(container.textContent).toContain(
      "Materialized CSV and JSON results will appear here as the agent creates them.",
    );
  });

  it("reads saved chart artifacts from the workspace and shows the image-first preview", async () => {
    const chartArtifact: ShellWorkspaceArtifact = {
      entryId: "chart-entry",
      path: "/artifacts/charts/revenue-plan.json",
      createdAt: "2026-03-20T12:00:00.000Z",
      source: "derived",
      producerKey: "artifacts",
      producerLabel: "Artifacts",
      file: {
        id: "chart-file",
        name: "revenue-plan.json",
        kind: "other",
        extension: "json",
        mime_type: "application/json",
        byte_size: 512,
        text_content: JSON.stringify(
          {
            version: "v1",
            chart_plan_id: "plan-1",
            file_id: "source-csv",
            title: "Revenue by segment",
            chart: { type: "bar" },
            image_data_url: "data:image/png;base64,chart-preview",
          },
          null,
          2,
        ),
      },
    };

    mockUseCapabilityFileWorkspace.mockReturnValue({
      ...createBaseWorkspaceResult(),
      artifacts: [chartArtifact],
      activeWorkspaceTab: "agent",
    });

    await act(async () => {
      root.render(<ChartAgentPage />);
    });

    expect(container.querySelector("[data-testid='chart-agent-quick-view']")).not.toBeNull();
    expect(container.textContent).toContain("Saved charts");
    expect(container.textContent).toContain("Plan plan-1");
    expect(container.textContent).toContain("Source source-csv");
    const chartImage = container.querySelector("img") as HTMLImageElement | null;
    expect(chartImage?.getAttribute("src")).toContain("data:image/png;base64,chart-preview");
  });

  it("shows smart split indexes and lets index links select matching PDFs", async () => {
    const indexArtifact: ShellWorkspaceArtifact = {
      entryId: "smart-split-index",
      path: "/artifacts/pdf/board_packet.md",
      createdAt: "2026-03-20T13:00:00.000Z",
      source: "derived",
      producerKey: "artifacts",
      producerLabel: "Artifacts",
      file: {
        id: "smart-split-index-file",
        name: "board_packet.md",
        kind: "other",
        extension: "md",
        mime_type: "text/markdown",
        byte_size: 200,
        text_content:
          "# Board packet\n\n- [Executive summary](exec-summary.pdf)\n",
      },
    };
    const splitPdfArtifact: ShellWorkspaceArtifact = {
      entryId: "split-pdf-entry",
      path: "/artifacts/pdf/exec-summary.pdf",
      createdAt: "2026-03-20T13:00:01.000Z",
      source: "derived",
      producerKey: "artifacts",
      producerLabel: "Artifacts",
      file: {
        id: "split-pdf-file",
        name: "exec-summary.pdf",
        kind: "pdf",
        extension: "pdf",
        mime_type: "application/pdf",
        byte_size: 240,
        page_count: 3,
        bytes_base64: "JVBERi0xLjQK",
      },
    };

    mockUseCapabilityFileWorkspace.mockReturnValue({
      ...createBaseWorkspaceResult(),
      artifacts: [indexArtifact, splitPdfArtifact],
      activeWorkspaceTab: "agent",
    });

    await act(async () => {
      root.render(<PdfAgentPage />);
    });

    expect(container.querySelector("[data-testid='pdf-agent-quick-view']")).not.toBeNull();
    expect(container.textContent).toContain("Smart split index");

    const linkButton = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Executive summary"),
    ) as HTMLButtonElement | undefined;
    expect(linkButton).toBeDefined();

    await act(async () => {
      linkButton?.click();
    });

    expect(container.textContent).toContain("exec-summary.pdf");
    expect(
      container.querySelector("[data-testid='capability-quick-view-pdf-iframe']"),
    ).not.toBeNull();
  });

});
