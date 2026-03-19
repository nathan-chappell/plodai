import { describe, expect, it, vi } from "vitest";

vi.mock("../chart", () => ({
  renderChartToDataUrl: vi.fn(async () => "data:image/png;base64,smoke-chart"),
}));

import { buildCapabilityBundleForRoot } from "../../capabilities/registry";
import type { CapabilityWorkspaceContext } from "../../capabilities/types";
import { createSmokeDatasets, runFrontendSmokeTest } from "../smoke";
import { createWorkspaceFilesystem } from "../workspace-fs";

describe("frontend smoke harness", () => {
  it("builds a serializable report bundle for the browser harness", () => {
    const workspace: CapabilityWorkspaceContext = {
      activePrefix: "/report-agent/",
      cwdPath: "/report-agent/",
      files: [],
      entries: [],
      workspaceContext: {
        path_prefix: "/report-agent/",
        referenced_item_ids: [],
      },
      setActivePrefix: () => {},
      createDirectory: (path: string) => path,
      changeDirectory: (path: string) => path,
      updateFilesystem: () => {},
      getState: () => ({
        activePrefix: "/report-agent/",
        cwdPath: "/report-agent/",
        files: [],
        entries: [],
        filesystem: createWorkspaceFilesystem(),
        workspaceContext: {
          path_prefix: "/report-agent/",
          referenced_item_ids: [],
        },
      }),
    };
    const bundle = buildCapabilityBundleForRoot("report-agent", workspace);

    expect(() => JSON.stringify(bundle)).not.toThrow();
    const reportCapability = bundle.capabilities.find(
      (capability) => capability.capability_id === bundle.root_capability_id,
    );
    expect(reportCapability?.client_tools.map((tool) => tool.name)).toEqual([
      "list_reports",
      "get_report",
      "create_report",
      "append_report_item",
      "remove_report_item",
    ]);
  });

  it("creates bundled smoke datasets", () => {
    const datasets = createSmokeDatasets();

    expect(datasets).toHaveLength(2);
    expect(datasets[0].name).toBe("sales_fixture.csv");
    expect(datasets[0].row_count).toBe(6);
  });

  it("runs the closed-loop smoke scenario with three chart types", async () => {
    const result = await runFrontendSmokeTest();

    expect(result.ok).toBe(true);
    expect(result.listedCsvFileCount).toBe(2);
    expect(result.aggregateRowsByChart.bar[0]).toMatchObject({ region: "West", total_revenue: 360 });
    expect(result.chartEffects.map((effect) => effect.chart.type).sort()).toEqual(["bar", "line", "pie"]);
  });
});
