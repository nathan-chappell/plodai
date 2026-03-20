import { describe, expect, it } from "vitest";

import {
  appendWorkspaceReportSlides,
  buildWorkspaceStateMetadata,
  createWorkspaceReport,
  ensureWorkspaceContractFilesystem,
  pruneWorkspacePdfSmartSplitBundles,
  readWorkspacePdfSmartSplitBundles,
  setWorkspaceCurrentReport,
  writeAgentsFile,
  writeWorkspacePdfSmartSplitBundles,
} from "../workspace-contract";
import {
  addWorkspaceArtifactsWithResult,
  createWorkspaceFilesystem,
  removeWorkspaceEntry,
} from "../workspace-fs";

describe("workspace contract metadata", () => {
  it("includes workspace AGENTS markdown in thread metadata without exposing it as a visible artifact", () => {
    let filesystem = ensureWorkspaceContractFilesystem(createWorkspaceFilesystem(), {
      capabilityId: "csv-agent",
      capabilityTitle: "CSV Agent",
      defaultGoal: "Inspect sales trends.",
      activeWorkspaceTab: "agent",
    });

    filesystem = writeAgentsFile(
      filesystem,
      "# AGENTS.md\n\n## Workspace conventions\n- Prefer compact artifact names.\n",
    );

    const metadata = buildWorkspaceStateMetadata(filesystem, "csv-agent");

    expect(metadata.agents_markdown).toContain("Prefer compact artifact names.");
    expect(metadata.files.find((file) => file.name === "AGENTS.md")).toBeUndefined();
  });

  it("persists the selected current report across contract hydration", () => {
    let filesystem = ensureWorkspaceContractFilesystem(createWorkspaceFilesystem(), {
      capabilityId: "report-agent",
      capabilityTitle: "Report Agent",
      defaultGoal: "Build the narrative report.",
      activeWorkspaceTab: "report",
    });

    const created = createWorkspaceReport(filesystem, {
      title: "Board sales review",
    });
    filesystem = setWorkspaceCurrentReport(created.filesystem, "report-1");

    const hydrated = ensureWorkspaceContractFilesystem(filesystem, {
      capabilityId: "report-agent",
      capabilityTitle: "Report Agent",
      defaultGoal: "Build the narrative report.",
      activeWorkspaceTab: "report",
    });

    expect(buildWorkspaceStateMetadata(hydrated, "report-agent").current_report_id).toBe("report-1");
  });

  it("keeps appended slides additive and marks the touched report current", () => {
    let filesystem = ensureWorkspaceContractFilesystem(createWorkspaceFilesystem(), {
      capabilityId: "report-agent",
      capabilityTitle: "Report Agent",
      defaultGoal: "Build the narrative report.",
      activeWorkspaceTab: "report",
    });

    const created = createWorkspaceReport(filesystem, {
      title: "Quarterly summary",
      reportId: "quarterly-summary",
    });
    filesystem = appendWorkspaceReportSlides(created.filesystem, "quarterly-summary", [
      {
        id: "slide-1",
        created_at: "2026-03-20T10:00:00.000Z",
        title: "Key finding",
        layout: "1x1",
        panels: [
          {
            id: "panel-1",
            type: "narrative",
            title: "Summary",
            markdown: "Revenue accelerated.",
          },
        ],
      },
      {
        id: "slide-2",
        created_at: "2026-03-20T10:05:00.000Z",
        title: "Follow-up",
        layout: "1x1",
        panels: [
          {
            id: "panel-2",
            type: "narrative",
            title: "Next step",
            markdown: "Inspect the west region in more detail.",
          },
        ],
      },
    ]);

    const metadata = buildWorkspaceStateMetadata(filesystem, "report-agent");
    const reportSummary = metadata.reports.find((report) => report.report_id === "quarterly-summary");

    expect(metadata.current_report_id).toBe("quarterly-summary");
    expect(reportSummary?.slide_count).toBe(2);
  });

  it("selects the newly created report as current", () => {
    const filesystem = ensureWorkspaceContractFilesystem(createWorkspaceFilesystem(), {
      capabilityId: "report-agent",
      capabilityTitle: "Report Agent",
      defaultGoal: "Build the narrative report.",
      activeWorkspaceTab: "report",
    });

    const created = createWorkspaceReport(filesystem, {
      title: "Board sales review",
      reportId: "board-sales-review",
    });

    expect(buildWorkspaceStateMetadata(created.filesystem, "report-agent").current_report_id).toBe(
      "board-sales-review",
    );
  });

  it("reads and prunes persisted PDF smart split bundles from structured workspace state", () => {
    let filesystem = addWorkspaceArtifactsWithResult(createWorkspaceFilesystem(), [
      {
        file: {
          id: "source-pdf",
          name: "quarterly_packet_demo.pdf",
          kind: "pdf",
          extension: "pdf",
          mime_type: "application/pdf",
          byte_size: 240,
          page_count: 4,
          bytes_base64: "JVBERi0xLjQK",
        },
        source: "uploaded",
        bucket: "uploaded",
        producer_key: "uploaded",
        producer_label: "Uploaded",
      },
      {
        file: {
          id: "split-pdf",
          name: "quarterly_packet_demo__pages_1-2.pdf",
          kind: "pdf",
          extension: "pdf",
          mime_type: "application/pdf",
          byte_size: 160,
          page_count: 2,
          bytes_base64: "JVBERi0xLjQK",
        },
        source: "derived",
        bucket: "pdf",
        producer_key: "pdf-agent",
        producer_label: "PDF Agent",
      },
    ]).filesystem;

    filesystem = writeWorkspacePdfSmartSplitBundles(filesystem, [
      {
        id: "bundle-1",
        createdAt: "2026-03-20T12:00:00.000Z",
        sourceFileId: "source-pdf",
        sourceFileName: "quarterly_packet_demo.pdf",
        entries: [
          {
            fileId: "split-pdf",
            name: "quarterly_packet_demo__pages_1-2.pdf",
            title: "Executive summary",
            startPage: 1,
            endPage: 2,
            pageCount: 2,
          },
        ],
      },
    ]);

    expect(readWorkspacePdfSmartSplitBundles(filesystem)).toEqual([
      expect.objectContaining({
        id: "bundle-1",
        sourceFileName: "quarterly_packet_demo.pdf",
        entries: [
          expect.objectContaining({
            fileId: "split-pdf",
            title: "Executive summary",
          }),
        ],
      }),
    ]);

    filesystem = pruneWorkspacePdfSmartSplitBundles(
      removeWorkspaceEntry(filesystem, "split-pdf"),
    );

    expect(readWorkspacePdfSmartSplitBundles(filesystem)).toEqual([]);
  });
});
