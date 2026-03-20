import { describe, expect, it } from "vitest";

import {
  appendWorkspaceReportSlides,
  buildWorkspaceStateMetadata,
  createWorkspaceReport,
  ensureWorkspaceContractFilesystem,
  setWorkspaceCurrentReport,
  writeAgentsFile,
} from "../workspace-contract";
import { createWorkspaceFilesystem } from "../workspace-fs";

describe("workspace contract metadata", () => {
  it("includes workspace AGENTS markdown in thread metadata without exposing it as a visible file", () => {
    let filesystem = ensureWorkspaceContractFilesystem(createWorkspaceFilesystem(), {
      capabilityId: "csv-agent",
      capabilityTitle: "CSV Agent",
      defaultGoal: "Inspect sales trends.",
      activeWorkspaceTab: "agent",
      executionMode: "interactive",
    });

    filesystem = writeAgentsFile(
      filesystem,
      "# AGENTS.md\n\n## Workspace conventions\n- Prefer compact artifact names.\n",
    );

    const metadata = buildWorkspaceStateMetadata(filesystem, "/csv-agent/");

    expect(metadata.agents_markdown).toContain("Prefer compact artifact names.");
    expect(metadata.files.find((file) => file.path === "/AGENTS.md")).toBeUndefined();
  });

  it("persists the selected current report across contract hydration", () => {
    let filesystem = ensureWorkspaceContractFilesystem(createWorkspaceFilesystem(), {
      capabilityId: "report-agent",
      capabilityTitle: "Report Agent",
      defaultGoal: "Build the narrative report.",
      activeWorkspaceTab: "report",
      executionMode: "interactive",
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
      executionMode: "interactive",
    });

    expect(buildWorkspaceStateMetadata(hydrated, "/report-agent/").current_report_id).toBe("report-1");
  });

  it("keeps appended slides additive and marks the touched report current", () => {
    let filesystem = ensureWorkspaceContractFilesystem(createWorkspaceFilesystem(), {
      capabilityId: "report-agent",
      capabilityTitle: "Report Agent",
      defaultGoal: "Build the narrative report.",
      activeWorkspaceTab: "report",
      executionMode: "interactive",
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

    const metadata = buildWorkspaceStateMetadata(filesystem, "/report-agent/");
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
      executionMode: "interactive",
    });

    const created = createWorkspaceReport(filesystem, {
      title: "Board sales review",
      reportId: "board-sales-review",
    });

    expect(buildWorkspaceStateMetadata(created.filesystem, "/report-agent/").current_report_id).toBe(
      "board-sales-review",
    );
  });
});
