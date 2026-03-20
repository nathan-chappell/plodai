import { describe, expect, it } from "vitest";

import { buildWorkspaceBootstrapMetadata } from "../workspace-contract";
import { applyVfsMutations, executeToolRequest } from "../client-tool-runtime";
import {
  addWorkspaceFilesWithResult,
  createWorkspaceFilesystem,
  getWorkspaceContext,
} from "../workspace-fs";
import type { LocalDataset } from "../../types/report";
import type { WorkspaceFilesystem } from "../../types/workspace";

function buildDataset(id: string, name: string, row: Record<string, string>): LocalDataset {
  return {
    id,
    name,
    kind: "csv",
    extension: "csv",
    byte_size: 32,
    mime_type: "text/csv",
    row_count: 1,
    columns: Object.keys(row),
    numeric_columns: ["revenue"],
    sample_rows: [row],
    rows: [row],
    preview_rows: [row],
  };
}

function createSnapshot(): { filesystem: WorkspaceFilesystem } {
  const withRootFile = addWorkspaceFilesWithResult(
    createWorkspaceFilesystem(),
    "/report-agent",
    [buildDataset("sales-current", "sales.csv", { region: "West", revenue: "210" })],
    "demo",
  ).filesystem;
  const filesystem = addWorkspaceFilesWithResult(
    withRootFile,
    "/artifacts/data",
    [buildDataset("sales-derived", "derived_sales.csv", { region: "North", revenue: "90" })],
    "derived",
  ).filesystem;

  return { filesystem };
}

describe("client tool runtime", () => {
  it("lists only current-prefix csv files for csv inventory requests", async () => {
    const { filesystem } = createSnapshot();
    const snapshot = {
      version: "v1" as const,
      filesystem,
      path_prefix: "/report-agent/",
      workspace_context: getWorkspaceContext(filesystem, "/report-agent"),
      bootstrap: buildWorkspaceBootstrapMetadata(filesystem),
    };

    const result = await executeToolRequest({
      version: "v1",
      request_id: 1,
      tool_name: "list_csv_files",
      arguments: {},
      snapshot,
    });

    expect(result.payload.files).toEqual([
      expect.objectContaining({
        id: "sales-current",
        name: "sales.csv",
        path: "/report-agent/sales.csv",
        row_count: 1,
        columns: ["region", "revenue"],
        numeric_columns: ["revenue"],
      }),
    ]);
    expect(result.payload.files).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "sales-derived",
        }),
      ]),
    );
    expect(result.payload.path_prefix).toBe("/report-agent/");
  });

  it("keeps list_csv_files scoped to current-prefix CSV metadata", async () => {
    const { filesystem } = createSnapshot();
    const snapshot = {
      version: "v1" as const,
      filesystem,
      path_prefix: "/report-agent/",
      workspace_context: getWorkspaceContext(filesystem, "/report-agent"),
      bootstrap: buildWorkspaceBootstrapMetadata(filesystem),
    };

    const result = await executeToolRequest({
      version: "v1",
      request_id: 2,
      tool_name: "list_csv_files",
      arguments: {},
      snapshot,
    });

    expect(result.payload.csv_files).toEqual([
      expect.objectContaining({
        id: "sales-current",
        name: "sales.csv",
        path: "/report-agent/sales.csv",
        row_count: 1,
        columns: ["region", "revenue"],
      }),
    ]);
    expect(result.payload.files).toEqual([
      expect.objectContaining({
        id: "sales-current",
        name: "sales.csv",
        path: "/report-agent/sales.csv",
        row_count: 1,
        columns: ["region", "revenue"],
      }),
    ]);
  });

  it("can inspect another branch by explicit prefix without changing the active prefix", async () => {
    const { filesystem } = createSnapshot();
    const snapshot = {
      version: "v1" as const,
      filesystem,
      path_prefix: "/report-agent/",
      workspace_context: getWorkspaceContext(filesystem, "/report-agent"),
      bootstrap: buildWorkspaceBootstrapMetadata(filesystem),
    };

    const result = await executeToolRequest({
      version: "v1",
      request_id: 3,
      tool_name: "list_csv_files",
      arguments: { prefix: "/artifacts/data/" },
      snapshot,
    });

    expect(result.payload.path_prefix).toBe("/artifacts/data/");
    expect(result.payload.files).toEqual([
      expect.objectContaining({
        id: "sales-derived",
        path: "/artifacts/data/derived_sales.csv",
      }),
    ]);
  });

  it("creates a report and appends then removes a report slide", async () => {
    const { filesystem } = createSnapshot();
    const snapshot = {
      version: "v1" as const,
      filesystem,
      path_prefix: "/report-agent/",
      workspace_context: getWorkspaceContext(filesystem, "/report-agent"),
      bootstrap: buildWorkspaceBootstrapMetadata(filesystem),
    };

    const created = await executeToolRequest({
      version: "v1",
      request_id: 4,
      tool_name: "create_report",
      arguments: { title: "Quarterly summary" },
      snapshot,
    });
    const createdReport = created.payload.report as { report_id: string } | undefined;
    expect(createdReport?.report_id).toBe("quarterly-summary");

    const withReport = {
      ...snapshot,
      filesystem: applyVfsMutations(snapshot, created.mutations).filesystem,
    };
    const appended = await executeToolRequest({
      version: "v1",
      request_id: 5,
      tool_name: "append_report_slide",
      arguments: {
        report_id: "quarterly-summary",
        slide: {
          title: "Key finding",
          layout: "1x1",
          panels: [
            {
              type: "narrative",
              title: "Key finding",
              markdown: "Revenue accelerated in the west.",
            },
          ],
        },
      },
      snapshot: withReport,
    });

    const appendedReport = appended.payload.report as { slides: Array<{ id: string; title: string }> } | undefined;
    expect(appendedReport?.slides).toHaveLength(1);
    expect(appendedReport?.slides[0]?.title).toBe("Key finding");

    const withItem = {
      ...snapshot,
      filesystem: applyVfsMutations(withReport, appended.mutations).filesystem,
    };
    const removed = await executeToolRequest({
      version: "v1",
      request_id: 6,
      tool_name: "remove_report_slide",
      arguments: {
        report_id: "quarterly-summary",
        slide_id: appendedReport?.slides[0]?.id ?? "",
      },
      snapshot: withItem,
    });

    const removedReport = removed.payload.report as { slides: unknown[] } | undefined;
    expect(removed.payload.removed).toBe(true);
    expect(removedReport?.slides ?? []).toHaveLength(0);
  });
});
