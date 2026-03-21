import { executeClientTool, type ClientToolExecutionResult, type LoadedDataset } from "./chatkit-tools";
import { parseCsvText } from "./csv";
import type { ChartRenderedEffect, ClientChartSpec, ClientToolCall, QueryPlan } from "../types/analysis";
import type { LocalDataset } from "../types/report";

const SALES_CSV = `month,region,category,revenue,units
Jan,North,Hardware,120,3
Jan,South,Services,90,2
Feb,North,Software,180,5
Feb,West,Hardware,150,4
Mar,West,Software,210,6
Mar,South,Services,60,1
`;

const SUPPORT_CSV = `month,region,tickets_open,csat
Jan,North,12,4.6
Feb,South,19,4.1
Mar,West,8,4.8
`;

export type FrontendSmokeResult = {
  ok: boolean;
  datasets: LocalDataset[];
  listedDatasetCount: number;
  aggregateRowsByChart: Record<string, Record<string, unknown>[]>;
  chartEffects: ChartRenderedEffect[];
  assertions: Array<{ label: string; ok: boolean; detail: string }>;
};

export function createSmokeDatasets(): LocalDataset[] {
  return [
    buildDataset("sales_fixture", "sales_fixture.csv", SALES_CSV),
    buildDataset("support_fixture", "support_fixture.csv", SUPPORT_CSV),
  ];
}

export async function runFrontendSmokeTest(): Promise<FrontendSmokeResult> {
  const datasets = createSmokeDatasets();
  const assertions: FrontendSmokeResult["assertions"] = [];

  const listResult = await executeSmokeTool(
    {
      name: "list_datasets",
      arguments: { includeSamples: true },
    },
    datasets,
  );
  const listedDatasets = Array.isArray(listResult.payload.datasets)
    ? listResult.payload.datasets
    : [];
  assertions.push({
    label: "Lists bundled dataset fixtures",
    ok: listedDatasets.length === datasets.length,
    detail: `Expected ${datasets.length} datasets, received ${listedDatasets.length}.`,
  });

  const chartSpecs: Array<{
    chartPlanId: string;
    fileId: string;
    expectedType: "bar" | "line" | "pie";
    title: string;
    chartPlan: ClientChartSpec;
  }> = [
    {
      chartPlanId: "plan-bar-region",
      fileId: "sales_fixture",
      expectedType: "bar",
      title: "Revenue by Region",
      chartPlan: {
        type: "bar",
        title: "Revenue by Region",
        label_key: "region",
        value_format: "currency",
        style_preset: "editorial",
        series: [{ label: "Revenue", data_key: "revenue" }],
      },
    },
    {
      chartPlanId: "plan-line-month",
      fileId: "sales_fixture",
      expectedType: "line",
      title: "Revenue by Month",
      chartPlan: {
        type: "line",
        title: "Revenue by Month",
        label_key: "month",
        style_preset: "ocean",
        smooth: true,
        series: [{ label: "Revenue", data_key: "revenue" }],
      },
    },
    {
      chartPlanId: "plan-pie-category",
      fileId: "sales_fixture",
      expectedType: "pie",
      title: "Revenue by Category",
      chartPlan: {
        type: "pie",
        title: "Revenue by Category",
        label_key: "category",
        style_preset: "sunrise",
        series: [{ label: "Revenue", data_key: "revenue" }],
      },
    },
  ];

  const aggregatePlan: QueryPlan = {
    dataset_id: "sales_fixture",
    group_by: [{ as: "region", expr: { kind: "column", column: "region" } }],
    aggregates: [{ op: "sum", as: "total_revenue", expr: { kind: "column", column: "revenue" } }],
    sort: [{ field: "total_revenue", direction: "desc" }],
  };
  const aggregateResult = await executeSmokeTool(
    {
      name: "run_aggregate_query",
      arguments: { query_plan: aggregatePlan },
    },
    datasets,
  );
  const aggregateRowsByChart: Record<string, Record<string, unknown>[]> = {
    bar: Array.isArray(aggregateResult.payload.rows) ? aggregateResult.payload.rows : [],
  };

  const chartEffects: ChartRenderedEffect[] = [];
  for (const chartSpec of chartSpecs) {
    const chartResult = await executeSmokeTool(
      {
        name: "render_chart_from_dataset",
        arguments: {
          dataset_id: chartSpec.fileId,
          chart_plan_id: chartSpec.chartPlanId,
          chart_plan: chartSpec.chartPlan,
          x_key: chartSpec.chartPlan.label_key,
          y_key: "revenue",
        },
      },
      datasets,
    );
    const chartEffect = chartResult.effects.find(
      (effect): effect is ChartRenderedEffect => effect.type === "chart_rendered",
    );
    if (chartEffect) {
      chartEffects.push(chartEffect);
    }
    assertions.push({
      label: `${chartSpec.expectedType} chart renders`,
      ok: chartEffect?.chart.type === chartSpec.expectedType,
      detail: chartEffect ? `Rendered ${chartEffect.chart.type} chart.` : `No ${chartSpec.expectedType} chart effect returned.`,
    });
  }

  const barTopRow = aggregateRowsByChart.bar?.[0];
  assertions.push({
    label: "Bar aggregate identifies West as top region",
    ok: barTopRow?.region === "West" && barTopRow?.total_revenue === 360,
    detail: `Top bar row was ${JSON.stringify(barTopRow)}.`,
  });

  assertions.push({
    label: "All three chart types were produced",
    ok: new Set(chartEffects.map((effect) => effect.chart.type)).size === 3,
    detail: `Chart types: ${chartEffects.map((effect) => effect.chart.type).join(", ")}.`,
  });

  return {
    ok:
      listedDatasets.length === datasets.length &&
      barTopRow?.region === "West" &&
      barTopRow?.total_revenue === 360 &&
      new Set(chartEffects.map((effect) => effect.chart.type)).size === 3,
    datasets,
    listedDatasetCount: listedDatasets.length,
    aggregateRowsByChart,
    chartEffects,
    assertions,
  };
}

function buildDataset(id: string, name: string, csvText: string): LocalDataset {
  const preview = parseCsvText(csvText);
  return {
    id,
    name,
    kind: "csv",
    extension: "csv",
    row_count: preview.rowCount,
    columns: preview.columns,
    numeric_columns: preview.numericColumns,
    sample_rows: preview.sampleRows,
    rows: preview.rows,
    preview_rows: preview.previewRows,
  };
}

async function executeSmokeTool(
  toolCall: ClientToolCall,
  datasets: LoadedDataset[],
): Promise<ClientToolExecutionResult> {
  return executeClientTool(toolCall, datasets);
}
