import { describe, expect, it, vi } from "vitest";

vi.mock("../chart", () => ({
  renderChartToDataUrl: vi.fn(async () => "data:image/png;base64,smoke-chart"),
}));

import { buildReportAgentBundle } from "../../capabilities/manifests";
import { createSmokeDatasets, runFrontendSmokeTest } from "../smoke";

describe("frontend smoke harness", () => {
  it("builds a serializable report bundle for the browser harness", () => {
    const bundle = buildReportAgentBundle();

    expect(() => JSON.stringify(bundle)).not.toThrow();
    const reportCapability = bundle.capabilities.find(
      (capability) => capability.capability_id === bundle.root_capability_id,
    );
    expect(reportCapability?.client_tools.map((tool) => tool.name)).toContain("render_chart_from_file");
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
