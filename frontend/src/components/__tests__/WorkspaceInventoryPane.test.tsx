// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceInventoryPane } from "../WorkspaceInventoryPane";
import type {
  PdfSmartSplitBundleView,
  ShellWorkspaceArtifact,
} from "../../agents/types";
import type { LocalWorkspaceFile } from "../../types/report";
import type { WorkspaceReportV1 } from "../../types/workspace-contract";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const csvFile: LocalWorkspaceFile = {
  id: "data-csv",
  name: "data.csv",
  kind: "csv",
  extension: "csv",
  mime_type: "text/csv",
  byte_size: 128,
  row_count: 2,
  columns: ["quarter", "revenue"],
  numeric_columns: ["revenue"],
  sample_rows: [{ quarter: "Q1", revenue: 42 }],
  preview_rows: [
    { quarter: "Q1", revenue: 42 },
    { quarter: "Q2", revenue: 64 },
  ],
  rows: [
    { quarter: "Q1", revenue: 42 },
    { quarter: "Q2", revenue: 64 },
  ],
};

const chartArtifactFile: LocalWorkspaceFile = {
  id: "chart-json",
  name: "plan_fd6e1bebf2954c07a9f1c668501e65c9.json",
  kind: "other",
  extension: "json",
  mime_type: "application/json",
  byte_size: 512,
  text_content: JSON.stringify({
    version: "v1",
    chart_plan_id: "plan-fd6e1beb",
    file_id: "data-csv",
    title: "Revenue by region",
    chart: { type: "bar" },
    image_data_url: "data:image/png;base64,chart-preview",
  }),
};

const files: LocalWorkspaceFile[] = [csvFile, chartArtifactFile];

const artifacts: ShellWorkspaceArtifact[] = [
  {
    entryId: "data-csv-entry",
    createdAt: "2026-03-19T12:00:00.000Z",
    bucket: "uploaded",
    source: "uploaded",
    producerKey: "uploaded",
    producerLabel: "Uploaded",
    file: csvFile,
  },
  {
    entryId: "chart-json-entry",
    createdAt: "2026-03-18T00:00:00.000Z",
    bucket: "chart",
    source: "derived",
    producerKey: "chart-agent",
    producerLabel: "Chart Agent",
    file: chartArtifactFile,
  },
];

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

const workspaces = [
  {
    id: "default",
    name: "Default workspace",
    kind: "default" as const,
    created_at: "2026-03-19T00:00:00.000Z",
  },
  {
    id: "walnut-season",
    name: "Walnut season",
    kind: "user" as const,
    created_at: "2026-03-19T00:00:00.000Z",
  },
];

const smartSplitBundles: PdfSmartSplitBundleView[] = [
  {
    id: "bundle-1",
    createdAt: "2026-03-20T12:00:00.000Z",
    sourceFileId: "source-pdf",
    sourceFileName: "quarterly_packet_demo.pdf",
    entries: [
      {
        fileId: "data-csv",
        name: "data.csv",
        title: "Executive summary",
        startPage: 1,
        endPage: 2,
        pageCount: 2,
      },
    ],
  },
];

describe("WorkspaceInventoryPane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.innerWidth = 1280;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function renderPane(
    overrides: Partial<React.ComponentProps<typeof WorkspaceInventoryPane>> = {},
  ) {
    const onSelectFiles = vi.fn(async () => {});
    const onRemoveArtifact = vi.fn();
    const onSelectWorkspace = vi.fn();
    const onCreateWorkspace = vi.fn();
    const onClearWorkspace = vi.fn();

    await act(async () => {
      root.render(
        <WorkspaceInventoryPane
          artifacts={artifacts}
          files={files}
          currentReport={currentReport}
          workspaces={workspaces}
          activeWorkspaceId="default"
          activeWorkspaceName="Default workspace"
          activeWorkspaceKind="default"
          accept=".csv,.txt,.png,.jpg,.jpeg,.webp"
          chatPane={<div data-testid="mock-chat-pane">Mock chat</div>}
          onSelectFiles={onSelectFiles}
          onSelectWorkspace={onSelectWorkspace}
          onCreateWorkspace={onCreateWorkspace}
          onClearWorkspace={onClearWorkspace}
          clearActionLabel="Clear workspace"
          onRemoveArtifact={onRemoveArtifact}
          {...overrides}
        />,
      );
    });

    return {
      onSelectFiles,
      onRemoveArtifact,
      onSelectWorkspace,
      onCreateWorkspace,
      onClearWorkspace,
    };
  }

  it("merges recents and files while previewing report slides and artifacts", async () => {
    await renderPane({ smartSplitBundles });

    expect(container.textContent).toContain("Latest uploads and outputs");
    expect(container.textContent).toContain("Revenue summary");
    expect(container.textContent).toContain("Weekly summary");
    expect(container.textContent).toContain("Smart split bundles");
    expect(container.textContent).toContain("quarterly_packet_demo.pdf");
    expect(container.textContent).toContain("Workspace browser");
    expect(container.querySelector("[data-testid='workspace-recents-section']")).not.toBeNull();
    expect(container.querySelector("[data-testid='workspace-tree-pane']")).not.toBeNull();
    expect(container.querySelector("[data-testid='workspace-preview-pane']")).not.toBeNull();

    const reportRow = container.querySelector(
      "[data-item-key='report:report-1:slide:slide-1']",
    ) as HTMLButtonElement | null;
    expect(reportRow).not.toBeNull();

    await act(async () => {
      reportRow?.click();
    });

    expect(container.textContent).toContain("Report slide");
    expect(container.textContent).toContain("West region revenue leads the pack.");

    const artifactRow = container.querySelector(
      "[data-item-key='artifact:data-csv-entry']",
    ) as HTMLButtonElement | null;
    expect(artifactRow).not.toBeNull();

    await act(async () => {
      artifactRow?.click();
    });

    expect(container.textContent).toContain("Table preview");
    expect(container.textContent).toContain("quarter");
    expect(container.textContent).toContain("revenue");
  });

  it("supports workspace switching, uploads, photo capture, and removing the selected artifact", async () => {
    const { onSelectFiles, onRemoveArtifact, onSelectWorkspace } = await renderPane();

    const select = container.querySelector("[data-testid='workspace-select']") as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    await act(async () => {
      if (select) {
        select.value = "walnut-season";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(onSelectWorkspace).toHaveBeenCalledWith("walnut-season");

    const input = container.querySelector("input[type='file'][multiple]") as HTMLInputElement | null;
    const file = new File(["quarter,revenue\nQ1,42"], "uploaded.csv", { type: "text/csv" });
    const fileList = {
      0: file,
      length: 1,
      item: (index: number) => (index === 0 ? file : null),
    } as unknown as FileList;

    expect(input).not.toBeNull();

    Object.defineProperty(input, "files", {
      configurable: true,
      value: fileList,
    });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onSelectFiles).toHaveBeenCalledWith(fileList);

    expect(container.textContent).toContain("Take photo");
    const captureInput = Array.from(container.querySelectorAll("input[type='file']")).find(
      (candidate) => candidate.getAttribute("capture") === "environment",
    ) as HTMLInputElement | undefined;
    expect(captureInput?.getAttribute("accept")).toBe("image/*");

    const artifactRow = container.querySelector(
      "[data-item-key='artifact:data-csv-entry']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      artifactRow?.click();
    });

    const removeButton = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Remove"),
    ) as HTMLButtonElement | undefined;
    expect(removeButton).toBeDefined();

    await act(async () => {
      removeButton?.click();
    });

    expect(onRemoveArtifact).toHaveBeenCalledWith("data-csv-entry");
  });

  it("shows mobile files, preview, and chat panes with files as the default tab", async () => {
    window.innerWidth = 400;

    await renderPane();

    expect(container.querySelector("[data-testid='workspace-mobile-pane-tabs']")).not.toBeNull();
    expect(
      container
        .querySelector("[data-testid='workspace-mobile-tab-files']")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      container
        .querySelector("[data-testid='workspace-mobile-tab-preview']")
        ?.getAttribute("aria-pressed"),
    ).toBe("false");

    const reportRow = container.querySelector(
      "[data-item-key='report:report-1:slide:slide-1']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      reportRow?.click();
    });

    expect(
      container
        .querySelector("[data-testid='workspace-mobile-tab-preview']")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.textContent).toContain("Report slide");

    const chatTab = container.querySelector(
      "[data-testid='workspace-mobile-tab-chat']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      chatTab?.click();
    });

    expect(chatTab?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-testid='workspace-pane-chat']")).not.toBeNull();
    expect(container.querySelector("[data-testid='mock-chat-pane']")).not.toBeNull();
  });
});
