import { describe, expect, it, vi } from "vitest";

vi.mock("../pdf", async () => {
  const actual = await vi.importActual<typeof import("../pdf")>("../pdf");
  return {
    ...actual,
    smartSplitPdfBytes: vi.fn(actual.smartSplitPdfBytes),
  };
});

import {
  buildWorkspaceBootstrapMetadata,
  readWorkspacePdfSmartSplitBundles,
} from "../workspace-contract";
import { applyVfsMutations, executeToolRequest } from "../client-tool-runtime";
import {
  addWorkspaceArtifactsWithResult,
  createWorkspaceFilesystem,
  getWorkspaceContext,
} from "../workspace-fs";
import type { LocalDataset, LocalPdfFile } from "../../types/report";
import type { WorkspaceFilesystem } from "../../types/workspace";
import { smartSplitPdfBytes } from "../pdf";

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

function createFilesystem(): WorkspaceFilesystem {
  return addWorkspaceArtifactsWithResult(createWorkspaceFilesystem(), [
    {
      file: buildDataset("sales-current", "sales.csv", { region: "West", revenue: "210" }),
      source: "demo",
      bucket: "uploaded",
      producer_key: "uploaded",
      producer_label: "Uploaded",
    },
    {
      file: buildDataset("sales-derived", "derived_sales.csv", { region: "North", revenue: "90" }),
      source: "derived",
      bucket: "data",
      producer_key: "csv-agent",
      producer_label: "CSV Agent",
    },
  ]).filesystem;
}

function createSnapshot(filesystem = createFilesystem()) {
  return {
    version: "v1" as const,
    workspace_id: "report-agent",
    producer_key: "report-agent",
    producer_label: "Report Agent",
    filesystem,
    workspace_context: getWorkspaceContext(filesystem, "report-agent"),
    bootstrap: buildWorkspaceBootstrapMetadata(filesystem),
  };
}

describe("client tool runtime", () => {
  it("lists CSV files from the shared workspace with artifact metadata", async () => {
    const snapshot = createSnapshot();

    const result = await executeToolRequest({
      version: "v1",
      request_id: 1,
      tool_name: "list_csv_files",
      arguments: {},
      snapshot,
    });

    expect(result.payload.workspace_id).toBe("report-agent");
    expect(result.payload.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "sales-current",
          name: "sales.csv",
          bucket: "uploaded",
          source: "demo",
        }),
        expect.objectContaining({
          id: "sales-derived",
          name: "derived_sales.csv",
          bucket: "data",
          source: "derived",
        }),
      ]),
    );
  });

  it("creates a CSV artifact with a filename-only contract", async () => {
    const snapshot = createSnapshot();

    const result = await executeToolRequest({
      version: "v1",
      request_id: 2,
      tool_name: "create_csv_file",
      arguments: {
        filename: "revenue_summary",
        query_plan: {
          dataset_id: "sales-current",
        },
      },
      snapshot,
    });

    expect(result.payload.created_file).toEqual(
      expect.objectContaining({
        name: "revenue_summary.csv",
        bucket: "data",
        producer_key: "report-agent",
        producer_label: "Report Agent",
        source: "derived",
      }),
    );
  });

  it("queues chart renders with filename-only artifact metadata", async () => {
    const snapshot = createSnapshot();

    const result = await executeToolRequest({
      version: "v1",
      request_id: 3,
      tool_name: "render_chart_from_file",
      arguments: {
        file_id: "sales-derived",
        chart_plan_id: "plan-1",
        chart_plan: {
          type: "bar",
          title: "Revenue by region",
          label_key: "region",
          series: [{ label: "Revenue", data_key: "revenue" }],
        },
        x_key: "region",
        y_key: "revenue",
      },
      snapshot,
    });

    expect(result.mutations).toEqual([
      expect.objectContaining({
        type: "render_chart_artifact",
        artifact_filename: "plan-1.json",
        producer_key: "report-agent",
        producer_label: "Report Agent",
      }),
    ]);
  });

  it("creates a report and appends then removes a report slide", async () => {
    const snapshot = createSnapshot();

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

  it("persists smart split bundles alongside derived PDF artifacts", async () => {
    vi.mocked(smartSplitPdfBytes).mockResolvedValueOnce({
      plan: [
        {
          title: "Executive summary",
          startPage: 1,
          endPage: 2,
        },
      ],
      indexMarkdown:
        "# Quarterly packet\n\n- [Executive summary](quarterly_packet_demo__pages_1-2.pdf)\n",
      extractedFiles: [
        {
          title: "Executive summary",
          filename: "quarterly_packet_demo__pages_1-2.pdf",
          mimeType: "application/pdf",
          pageRange: {
            startPage: 1,
            endPage: 2,
            pageCount: 2,
          },
          fileDataBase64: "AA==",
        },
      ],
      archiveName: "quarterly_packet_demo__smart_split.zip",
      archiveBase64: "AA==",
    });

    const filesystem = addWorkspaceArtifactsWithResult(createWorkspaceFilesystem(), [
      {
        file: {
          id: "source-pdf",
          name: "quarterly_packet_demo.pdf",
          kind: "pdf",
          extension: "pdf",
          mime_type: "application/pdf",
          byte_size: 240,
          page_count: 4,
          bytes_base64: "AA==",
        } satisfies LocalPdfFile,
        source: "demo",
        bucket: "uploaded",
        producer_key: "uploaded",
        producer_label: "Uploaded",
      },
    ]).filesystem;
    const snapshot = createSnapshot(filesystem);

    const result = await executeToolRequest({
      version: "v1",
      request_id: 7,
      tool_name: "smart_split_pdf",
      arguments: {
        file_id: "source-pdf",
        goal: "Split this packet into reusable sections.",
      },
      snapshot,
    });

    expect(result.payload.created_files).toHaveLength(3);

    const nextSnapshot = applyVfsMutations(snapshot, result.mutations);
    expect(readWorkspacePdfSmartSplitBundles(nextSnapshot.filesystem)).toEqual([
      expect.objectContaining({
        sourceFileId: "source-pdf",
        sourceFileName: "quarterly_packet_demo.pdf",
        archiveFileName: "quarterly_packet_demo__smart_split.zip",
        entries: [
          expect.objectContaining({
            title: "Executive summary",
            startPage: 1,
            endPage: 2,
            pageCount: 2,
          }),
        ],
      }),
    ]);
  });
});
