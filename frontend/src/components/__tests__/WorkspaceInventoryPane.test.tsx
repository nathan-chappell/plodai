// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceInventoryPane } from "../WorkspaceInventoryPane";
import type { WorkspaceFilesystem } from "../../types/workspace";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const filesystem: WorkspaceFilesystem = {
  files_by_path: {
    "/report-agent/reports/data.csv": {
      id: "data-csv",
      kind: "file",
      name: "data.csv",
      path: "/report-agent/reports/data.csv",
      created_at: "2026-03-18T00:00:00.000Z",
      source: "uploaded",
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
    "/report-agent/notes/brief.txt": {
      id: "brief-txt",
      kind: "file",
      name: "brief.txt",
      path: "/report-agent/notes/brief.txt",
      created_at: "2026-03-18T00:00:00.000Z",
      source: "uploaded",
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
  },
};

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
    const onChangeDirectory = vi.fn();
    const onRemoveEntry = vi.fn();

    await act(async () => {
      root.render(
        <WorkspaceInventoryPane
          activePrefix="/report-agent/reports/"
          cwdPath="/report-agent/reports/"
          filesystem={filesystem}
          breadcrumbs={[
            { id: "workspace-root", name: "/", prefix: "/", path: "/" },
            { id: "prefix:/report-agent/", name: "report-agent", prefix: "/report-agent/", path: "/report-agent/" },
            { id: "prefix:/report-agent/reports/", name: "reports", prefix: "/report-agent/reports/", path: "/report-agent/reports/" },
          ]}
          entries={[filesystem.files_by_path["/report-agent/reports/data.csv"]]}
          accept=".csv"
          onSelectFiles={onSelectFiles}
          onChangeDirectory={onChangeDirectory}
          onRemoveEntry={onRemoveEntry}
          {...overrides}
        />,
      );
    });

    return {
      onSelectFiles,
      onChangeDirectory,
      onRemoveEntry,
    };
  }

  function findTreeButton(label: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button[role='treeitem']")).find((candidate) =>
      candidate.textContent?.includes(label),
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Unable to find tree item containing "${label}".`);
    }
    return button;
  }

  it("renders a synthetic tree anchored at the workspace root and previews nested files from the active prefix", async () => {
    await renderPane();

    expect(container.textContent).toContain("Path tree");
    expect(container.textContent).toContain("Anchored at /");
    expect(container.textContent).toContain("Active prefix: /report-agent/reports/");
    expect(container.textContent).toContain("data.csv");

    await act(async () => {
      findTreeButton("data.csv").click();
    });

    expect(container.textContent).toContain("Selection preview");
    expect(container.textContent).toContain("Table preview");
    expect(container.textContent).toContain("quarter");
    expect(container.textContent).toContain("revenue");
  });

  it("switches the active prefix when a synthetic branch is selected", async () => {
    const { onChangeDirectory } = await renderPane();

    await act(async () => {
      findTreeButton("notes").click();
    });

    expect(onChangeDirectory).toHaveBeenCalledWith("/report-agent/notes/");
    expect(container.textContent).toContain("/report-agent/notes/");
    expect(container.textContent).toContain("Prefix details");
  });
});
