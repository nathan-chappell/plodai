import { describe, expect, it, vi } from "vitest";

vi.mock("../chart", () => ({
  renderChartToDataUrl: vi.fn(async () => "data:image/png;base64,smoke-chart"),
}));

import { createSmokeDatasets, runFrontendSmokeTest } from "../smoke";

describe("frontend smoke harness", () => {
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
    expect(result.aggregateRowsByChart.line).toHaveLength(3);
    expect(result.aggregateRowsByChart.pie).toHaveLength(3);
    expect(result.chartEffects.map((effect) => effect.chart.type).sort()).toEqual(["bar", "line", "pie"]);
  });
});
