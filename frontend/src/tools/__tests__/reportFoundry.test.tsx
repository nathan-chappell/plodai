// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalWorkspaceFile } from "../../types/report";
import type { WorkspaceReportV1 } from "../../types/workspace-contract";

vi.mock("../../components/DatasetChart", () => ({
  DatasetChart: ({
    rows,
    spec,
  }: {
    rows: unknown[];
    spec: { title: string };
  }) => (
    <div
      data-row-count={String(rows.length)}
      data-testid="mock-dataset-chart"
      data-title={spec.title}
    >
      mock chart
    </div>
  ),
}));

import { CurrentReportPanel } from "../reportFoundry";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const salesFile: LocalWorkspaceFile = {
  id: "sales-csv",
  name: "sales.csv",
  kind: "csv",
  extension: "csv",
  mime_type: "text/csv",
  byte_size: 64,
  row_count: 2,
  columns: ["region", "total_revenue"],
  numeric_columns: ["total_revenue"],
  sample_rows: [
    { region: "West", total_revenue: 42 },
    { region: "East", total_revenue: 36 },
  ],
  preview_rows: [
    { region: "West", total_revenue: 42 },
    { region: "East", total_revenue: 36 },
  ],
  rows: [
    { region: "West", total_revenue: 42 },
    { region: "East", total_revenue: 36 },
  ],
};

describe("CurrentReportPanel", () => {
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
  });

  it("keeps the current report title in view and shows a saved chart image", async () => {
    const report: WorkspaceReportV1 = {
      version: "v1",
      report_id: "board-report",
      title: "Board revenue report",
      created_at: "2026-03-19T10:00:00.000Z",
      updated_at: "2026-03-19T10:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          created_at: "2026-03-19T10:00:00.000Z",
          title: "Regional performance",
          layout: "1x1",
          panels: [
            {
              id: "chart-panel-1",
              type: "chart",
              title: "Revenue by region",
              file_id: "sales-csv",
              chart_plan_id: "plan-1",
              chart: {
                type: "bar",
                title: "Revenue by region",
                label_key: "region",
                series: [{ label: "Revenue", data_key: "total_revenue" }],
              },
              image_data_url: "data:image/png;base64,chart-preview",
            },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        <CurrentReportPanel
          currentReport={report}
          files={[salesFile]}
          emptyMessage="No report slides yet."
          dataTestIdBase="report-agent-demo-current-report"
        />,
      );
    });

    expect(container.textContent).toContain("Current report");
    expect(container.textContent).toContain("Report");
    expect(container.textContent).toContain("Updated");
    expect(container.textContent).toContain("Slides");
    expect(container.textContent).toContain("In view");
    expect(container.textContent).toContain("Board revenue report");
    expect(container.textContent).toContain("Source file: sales.csv.");
    expect(container.textContent).toContain("Open source");
    const chartImage = container.querySelector(
      "[data-testid='report-agent-demo-current-report-slide-0-panel-0-chart-image']",
    );
    expect(chartImage).not.toBeNull();
    expect(chartImage?.getAttribute("src")).toContain("data:image/png;base64,chart-preview");
  });

  it("falls back to a row-backed chart when the slide panel has no saved image", async () => {
    const report: WorkspaceReportV1 = {
      version: "v1",
      report_id: "board-report",
      title: "Board revenue report",
      created_at: "2026-03-19T10:00:00.000Z",
      updated_at: "2026-03-19T10:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          created_at: "2026-03-19T10:00:00.000Z",
          title: "Regional performance",
          layout: "1x1",
          panels: [
            {
              id: "chart-panel-1",
              type: "chart",
              title: "Revenue by region",
              file_id: "sales-csv",
              chart_plan_id: "plan-1",
              chart: {
                type: "bar",
                title: "Revenue by region",
                label_key: "region",
                series: [{ label: "Revenue", data_key: "total_revenue" }],
              },
              image_data_url: null,
            },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        <CurrentReportPanel
          currentReport={report}
          files={[salesFile]}
          emptyMessage="No report slides yet."
          dataTestIdBase="report-agent-current-report"
        />,
      );
    });

    const chart = container.querySelector("[data-testid='mock-dataset-chart']");
    expect(chart).not.toBeNull();
    expect(chart?.getAttribute("data-row-count")).toBe("2");
    expect(chart?.getAttribute("data-title")).toBe("Revenue by region");
  });

  it("pages through slides and shows compact narrative content", async () => {
    const report: WorkspaceReportV1 = {
      version: "v1",
      report_id: "board-report",
      title: "Board revenue report",
      created_at: "2026-03-19T10:00:00.000Z",
      updated_at: "2026-03-19T10:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          created_at: "2026-03-19T10:00:00.000Z",
          title: "Regional performance",
          layout: "1x1",
          panels: [
            {
              id: "chart-panel-1",
              type: "chart",
              title: "Revenue by region",
              file_id: "sales-csv",
              chart_plan_id: "plan-1",
              chart: {
                type: "bar",
                title: "Revenue by region",
                label_key: "region",
                series: [{ label: "Revenue", data_key: "total_revenue" }],
              },
              image_data_url: "data:image/png;base64,chart-preview",
            },
          ],
        },
        {
          id: "slide-2",
          created_at: "2026-03-19T10:05:00.000Z",
          title: "Narrative summary",
          layout: "1x1",
          panels: [
            {
              id: "narrative-panel-1",
              type: "narrative",
              title: "Key finding",
              markdown: "West outperformed East with a clearer late-quarter acceleration.",
            },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        <CurrentReportPanel
          currentReport={report}
          files={[salesFile]}
          emptyMessage="No report slides yet."
          dataTestIdBase="report-agent-carousel"
        />,
      );
    });

    expect(container.textContent).toContain("1 / 2");
    const nextButton = container.querySelector(
      "[data-testid='report-agent-carousel-next-slide']",
    ) as HTMLButtonElement | null;
    expect(nextButton).not.toBeNull();

    await act(async () => {
      nextButton?.click();
    });

    expect(container.textContent).toContain("2 / 2");
    expect(container.textContent).toContain("Narrative summary");
    expect(container.textContent).toContain("West outperformed East");
  });

  it("follows a newly appended slide when the viewer is already on the last slide", async () => {
    const initialReport: WorkspaceReportV1 = {
      version: "v1",
      report_id: "board-report",
      title: "Board revenue report",
      created_at: "2026-03-19T10:00:00.000Z",
      updated_at: "2026-03-19T10:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          created_at: "2026-03-19T10:00:00.000Z",
          title: "Regional performance",
          layout: "1x1",
          panels: [
            {
              id: "narrative-panel-1",
              type: "narrative",
              title: "Summary",
              markdown: "West leads.",
            },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        <CurrentReportPanel
          currentReport={initialReport}
          files={[salesFile]}
          emptyMessage="No report slides yet."
          dataTestIdBase="report-agent-follow-append"
        />,
      );
    });

    const appendedReport: WorkspaceReportV1 = {
      ...initialReport,
      updated_at: "2026-03-19T10:05:00.000Z",
      slides: [
        ...initialReport.slides,
        {
          id: "slide-2",
          created_at: "2026-03-19T10:05:00.000Z",
          title: "New summary",
          layout: "1x1",
          panels: [
            {
              id: "narrative-panel-2",
              type: "narrative",
              title: "Takeaway",
              markdown: "The latest slide stays in view.",
            },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        <CurrentReportPanel
          currentReport={appendedReport}
          files={[salesFile]}
          emptyMessage="No report slides yet."
          dataTestIdBase="report-agent-follow-append"
        />,
      );
    });

    expect(container.textContent).toContain("2 / 2");
    expect(container.textContent).toContain("New summary");
    expect(container.textContent).toContain("The latest slide stays in view.");
  });

  it("shows the empty message when no current report is available yet", async () => {
    await act(async () => {
      root.render(
        <CurrentReportPanel
          currentReport={null}
          files={[]}
          emptyMessage="The active report will appear here soon."
          dataTestIdBase="report-agent-current-report"
        />,
      );
    });

    expect(container.textContent).toContain("The active report will appear here soon.");
  });
});
