// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LatestWorkspaceItemPane,
  latestWorkspacePreviewItemKey,
} from "../LatestWorkspaceItemPane";
import type { ShellWorkspaceArtifact } from "../../agents/types";
import type { LocalWorkspaceFile } from "../../types/report";
import type { WorkspaceReportV1 } from "../../types/workspace-contract";

vi.mock("../DatasetChart", () => ({
  DatasetChart: () => <div data-testid="mock-dataset-chart">chart</div>,
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const sourceCsv: LocalWorkspaceFile = {
  id: "sales-file",
  name: "sales_tour.csv",
  kind: "csv",
  extension: "csv",
  mime_type: "text/csv",
  byte_size: 182,
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

function makeArtifact(
  entryId: string,
  createdAt: string,
  file: LocalWorkspaceFile,
): ShellWorkspaceArtifact {
  return {
    entryId,
    createdAt,
    bucket: file.kind === "pdf" ? "pdf" : "uploaded",
    source: "uploaded",
    producerKey: "uploaded",
    producerLabel: "Uploaded",
    file,
  };
}

describe("LatestWorkspaceItemPane", () => {
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

  it("shows the newest report slide as the latest item", async () => {
    const currentReport: WorkspaceReportV1 = {
      version: "v1",
      report_id: "board-report",
      title: "Board report",
      created_at: "2026-03-20T09:00:00.000Z",
      updated_at: "2026-03-20T10:05:00.000Z",
      slides: [
        {
          id: "slide-1",
          created_at: "2026-03-20T10:05:00.000Z",
          title: "Regional summary",
          layout: "1x1",
          panels: [
            {
              id: "panel-1",
              type: "narrative",
              title: "Summary",
              markdown: "West is still leading.",
            },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        <LatestWorkspaceItemPane
          artifacts={[makeArtifact("artifact-sales", "2026-03-20T10:00:00.000Z", sourceCsv)]}
          files={[sourceCsv]}
          currentReport={currentReport}
          emptyMessage="No items yet."
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Latest item");
    expect(container.textContent).toContain("Preview: Regional summary");
    expect(container.textContent).toContain("Report slide");
    expect(container.textContent).toContain("Board report");
    expect(container.textContent).not.toContain("Download");
  });

  it("picks the newest artifact key when a new chart render appears", () => {
    const chartFile: LocalWorkspaceFile = {
      id: "chart-file",
      name: "plan-1.json",
      kind: "other",
      extension: "json",
      mime_type: "application/json",
      byte_size: 240,
      text_content: JSON.stringify({
        version: "v1",
        chart_plan_id: "plan-1",
        dataset_id: sourceCsv.id,
        title: "Revenue by region",
        chart: { type: "bar" },
        image_data_url: "data:image/png;base64,chart-preview",
      }),
    };

    expect(
      latestWorkspacePreviewItemKey({
        artifacts: [
          makeArtifact("artifact-sales", "2026-03-20T10:00:00.000Z", sourceCsv),
          {
            ...makeArtifact(
              "artifact-chart",
              "2026-03-20T10:10:00.000Z",
              chartFile,
            ),
            bucket: "chart",
            source: "derived",
            producerKey: "chart-agent",
            producerLabel: "Charts",
          },
        ],
        currentReport: null,
      }),
    ).toBe("artifact:artifact-chart");
  });

  it("auto-follows a newly added artifact when it appears", async () => {
    const chartFile: LocalWorkspaceFile = {
      id: "chart-file",
      name: "plan_fd6e1bebf2954c07a9f1c668501e65c9.json",
      kind: "other",
      extension: "json",
      mime_type: "application/json",
      byte_size: 240,
      text_content: JSON.stringify({
        version: "v1",
        chart_plan_id: "plan-2",
        dataset_id: sourceCsv.id,
        title: "Revenue by region",
        chart: { type: "bar" },
        image_data_url: "data:image/png;base64,chart-preview",
      }),
    };

    await act(async () => {
      root.render(
        <LatestWorkspaceItemPane
          artifacts={[makeArtifact("artifact-sales", "2026-03-20T10:00:00.000Z", sourceCsv)]}
          files={[sourceCsv]}
          currentReport={null}
          emptyMessage="No items yet."
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Preview: sales_tour.csv");

    await act(async () => {
      root.render(
        <LatestWorkspaceItemPane
          artifacts={[
            makeArtifact("artifact-sales", "2026-03-20T10:00:00.000Z", sourceCsv),
            {
              ...makeArtifact(
                "artifact-chart",
                "2026-03-20T10:10:00.000Z",
                chartFile,
              ),
              bucket: "chart",
              source: "derived",
              producerKey: "chart-agent",
              producerLabel: "Charts",
            },
          ]}
          files={[sourceCsv, chartFile]}
          currentReport={null}
          emptyMessage="No items yet."
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Preview: Revenue by region");
    const rows = Array.from(container.querySelectorAll("[data-item-key]"));
    expect(rows[0]?.getAttribute("data-item-key")).toBe("artifact:artifact-chart");
    expect(rows[0]?.textContent).toContain("CHT");
    expect(rows[0]?.textContent).toContain("Revenue by region");
  });

  it("renders a report slide chart from the saved chart artifact image", async () => {
    const chartArtifactFile: LocalWorkspaceFile = {
      id: "chart-artifact",
      name: "revenue_by_region_chart.json",
      kind: "other",
      extension: "json",
      mime_type: "application/json",
      byte_size: 240,
      text_content: JSON.stringify({
        version: "v1",
        chart_plan_id: "plan-9",
        dataset_id: sourceCsv.id,
        title: "Revenue by region",
        chart: { type: "bar" },
        image_data_url: "data:image/png;base64,chart-preview-from-artifact",
      }),
    };

    const currentReport: WorkspaceReportV1 = {
      version: "v1",
      report_id: "board-report",
      title: "Board report",
      created_at: "2026-03-20T09:00:00.000Z",
      updated_at: "2026-03-20T10:05:00.000Z",
      slides: [
        {
          id: "slide-1",
          created_at: "2026-03-20T10:05:00.000Z",
          title: "Regional summary",
          layout: "1x1",
          panels: [
            {
              id: "panel-1",
              type: "chart",
              title: "Revenue by region",
              dataset_id: chartArtifactFile.id,
              chart_plan_id: "plan-9",
              chart: {
                type: "bar",
                title: "Revenue by region",
                label_key: "region",
                series: [{ label: "Revenue", data_key: "revenue" }],
              },
              image_data_url: null,
            },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        <LatestWorkspaceItemPane
          artifacts={[makeArtifact("artifact-sales", "2026-03-20T10:00:00.000Z", sourceCsv)]}
          files={[sourceCsv, chartArtifactFile]}
          currentReport={currentReport}
          emptyMessage="No items yet."
        />,
      );
      await Promise.resolve();
    });

    const chartImage = container.querySelector("img[alt='Revenue by region']");
    expect(chartImage).not.toBeNull();
    expect(chartImage?.getAttribute("src")).toContain("chart-preview-from-artifact");
    expect(container.textContent).toContain("Source file: sales_tour.csv.");
  });

  it("shows a pending source preview while the tool is still working from the current latest item", async () => {
    const olderArtifact = makeArtifact(
      "artifact-sales",
      "2026-03-20T10:00:00.000Z",
      sourceCsv,
    );

    await act(async () => {
      root.render(
        <LatestWorkspaceItemPane
          artifacts={[olderArtifact]}
          files={[sourceCsv]}
          currentReport={null}
          pendingToolActivity={{
            name: "render_chart_from_dataset",
            params: { dataset_id: sourceCsv.id },
          }}
          pendingAnchorItemKey="artifact:artifact-sales"
          emptyMessage="No items yet."
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Render Chart From Dataset in progress.");
    expect(container.textContent).toContain("Preview: sales_tour.csv");
  });
});
