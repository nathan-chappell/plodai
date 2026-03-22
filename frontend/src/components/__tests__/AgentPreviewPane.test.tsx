// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/report-pdf", () => ({
  downloadReportPdf: vi.fn(),
}));

import { AgentPreviewPane } from "../AgentPreviewPane";
import { buildAgentPreviewModel, buildReportResource } from "../../lib/shell-resources";
import { downloadReportPdf } from "../../lib/report-pdf";
import type { WorkspaceReportV1 } from "../../types/workspace-contract";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const downloadReportPdfMock = vi.mocked(downloadReportPdf);

function buildReport(slideCount = 1): WorkspaceReportV1 {
  return {
    version: "v1",
    report_id: "report-1",
    title: "Board report",
    created_at: "2026-03-20T09:00:00.000Z",
    updated_at: "2026-03-20T10:05:00.000Z",
    slides: Array.from({ length: slideCount }, (_, index) => ({
      id: `slide-${index + 1}`,
      created_at: `2026-03-20T10:0${index}:00.000Z`,
      title: `Slide ${index + 1}`,
      layout: "1x1",
      panels: [
        {
          id: `panel-${index + 1}`,
          type: "narrative",
          title: "Summary",
          markdown: "West region revenue leads the pack.",
        },
      ],
    })),
  };
}

describe("AgentPreviewPane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    downloadReportPdfMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  it("exports report resources as direct PDF downloads", async () => {
    const resource = buildReportResource("report-agent", buildReport());
    downloadReportPdfMock.mockResolvedValue({
      blob: new Blob(["pdf"], { type: "application/pdf" }),
      filename: "board_report.pdf",
    });

    await act(async () => {
      root.render(
        <AgentPreviewPane
          previewModel={buildAgentPreviewModel({
            agentId: "report-agent",
            title: "Report",
            resources: [resource],
          })}
          resources={[resource]}
        />,
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Export PDF"),
    ) as HTMLButtonElement | undefined;

    expect(button).toBeDefined();
    expect(container.textContent).not.toContain("Download");
    expect(container.textContent).not.toContain("Open");
    expect(container.querySelector("[data-testid='agent-preview-selector-rail']")).toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(downloadReportPdfMock).toHaveBeenCalledWith({
      files: [],
      onProgress: expect.any(Function),
      report: resource.payload.report,
    });
  });

  it("disables PDF export when a report has no slides", async () => {
    const resource = buildReportResource("report-agent", buildReport(0));

    await act(async () => {
      root.render(
        <AgentPreviewPane
          previewModel={buildAgentPreviewModel({
            agentId: "report-agent",
            title: "Report",
            resources: [resource],
          })}
          resources={[resource]}
        />,
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Export PDF"),
    ) as HTMLButtonElement | undefined;

    expect(button?.disabled).toBe(true);
  });

  it("shows one report slide at a time and navigates forward", async () => {
    const resource = buildReportResource("report-agent", buildReport(2));

    await act(async () => {
      root.render(
        <AgentPreviewPane
          previewModel={buildAgentPreviewModel({
            agentId: "report-agent",
            title: "Report",
            resources: [resource],
          })}
          resources={[resource]}
        />,
      );
    });

    expect(container.textContent).toContain("Slide 1 of 2");
    expect(container.textContent).toContain("Slide 1");
    expect(container.textContent).not.toContain("Slide 2 of 2");

    const nextButton = container.querySelector(
      "[data-testid='report-slide-next']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      nextButton?.click();
    });

    expect(container.textContent).toContain("Slide 2 of 2");
    expect(container.textContent).toContain("Slide 2");
  });
});
