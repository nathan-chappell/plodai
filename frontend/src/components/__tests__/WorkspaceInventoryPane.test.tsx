// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceInventoryPane } from "../WorkspaceInventoryPane";
import type { ShellWorkspaceArtifact } from "../../capabilities/types";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const artifacts: ShellWorkspaceArtifact[] = [
  {
    entryId: "data-csv-entry",
    path: "/report-agent/reports/data.csv",
    createdAt: "2026-03-19T12:00:00.000Z",
    source: "uploaded",
    producerKey: "uploaded",
    producerLabel: "Uploaded",
    file: {
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
    },
  },
  {
    entryId: "brief-txt-entry",
    path: "/artifacts/data/brief.txt",
    createdAt: "2026-03-18T00:00:00.000Z",
    source: "derived",
    producerKey: "artifacts",
    producerLabel: "Artifacts",
    file: {
      id: "brief-txt",
      name: "brief.txt",
      kind: "other",
      extension: "txt",
      mime_type: "text/plain",
      byte_size: 48,
      text_content: "A short workspace note.",
    },
  },
];

const workspaces = [
  {
    id: "default",
    name: "Default workspace",
    kind: "default" as const,
    created_at: "2026-03-19T00:00:00.000Z",
  },
  {
    id: "demo",
    name: "Demo workspace",
    kind: "demo" as const,
    created_at: "2026-03-19T00:00:00.000Z",
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  async function renderPane(overrides: Partial<React.ComponentProps<typeof WorkspaceInventoryPane>> = {}) {
    const onSelectFiles = vi.fn(async () => {});
    const onRemoveArtifact = vi.fn();
    const onSelectWorkspace = vi.fn();
    const onCreateWorkspace = vi.fn();
    const onClearWorkspace = vi.fn();

    await act(async () => {
      root.render(
        <WorkspaceInventoryPane
          artifacts={artifacts}
          workspaces={workspaces}
          activeWorkspaceId="default"
          activeWorkspaceName="Default workspace"
          activeWorkspaceKind="default"
          accept=".csv,.txt"
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

  it("renders a dense tree browser with a separate preview pane", async () => {
    await renderPane();

    expect(container.textContent).toContain("Workspace artifacts");
    expect(container.textContent).toContain("Default workspace");
    expect(container.textContent).toContain("Uploaded");
    expect(container.textContent).toContain("data.csv");
    expect(container.textContent).toContain("Table preview");
    expect(container.textContent).toContain("quarter");
    expect(container.textContent).toContain("revenue");

    expect(container.querySelector("[data-testid='workspace-tree-pane']")).not.toBeNull();
    expect(container.querySelector("[data-testid='workspace-preview-pane']")).not.toBeNull();
    expect(container.textContent).not.toContain("Active prefix");
    expect(container.textContent).not.toContain("Focus another prefix");
  });

  it("calls remove with the selected artifact entry id", async () => {
    const { onRemoveArtifact } = await renderPane();
    const removeButton = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Remove"),
    ) as HTMLButtonElement | undefined;

    expect(removeButton).toBeDefined();

    await act(async () => {
      removeButton?.click();
    });

    expect(onRemoveArtifact).toHaveBeenCalledWith("data-csv-entry");
  });

  it("passes uploaded files through the modal upload control", async () => {
    const { onSelectFiles } = await renderPane();
    const input = container.querySelector("input[type='file']") as HTMLInputElement | null;
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
  });
});
