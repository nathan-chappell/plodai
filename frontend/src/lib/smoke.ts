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
  listedCsvFileCount: number;
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
      name: "list_attached_csv_files",
      arguments: { includeSamples: true },
    },
    datasets,
  );
  const csvFiles = Array.isArray(listResult.payload.csv_files)
    ? listResult.payload.csv_files
    : [];
  assertions.push({
    label: "Lists bundled CSV fixtures",
    ok: csvFiles.length === datasets.length,
    detail: `Expected ${datasets.length} files, received ${csvFiles.length}.`,
  });

  const chartSpecs: Array<{
    queryId: string;
    expectedType: "bar" | "line" | "pie";
    title: string;
    plan: QueryPlan;
    chartPlan: ClientChartSpec;
  }> = [
    {
      queryId: "smoke-bar-region",
      expectedType: "bar",
      title: "Revenue by Region",
      plan: {
        dataset_id: "sales_fixture",
        group_by: [{ as: "region", expr: { kind: "column", column: "region" } }],
        aggregates: [{ op: "sum", as: "total_revenue", expr: { kind: "column", column: "revenue" } }],
        sort: [{ field: "total_revenue", direction: "desc" }],
      } satisfies QueryPlan,
      chartPlan: {
        type: "bar",
        title: "Revenue by Region",
        label_key: "region",
        style_preset: "editorial",
        series: [{ label: "Revenue", data_key: "total_revenue" }],
      },
    },
    {
      queryId: "smoke-line-month",
      expectedType: "line",
      title: "Revenue by Month",
      plan: {
        dataset_id: "sales_fixture",
        group_by: [{ as: "month", expr: { kind: "column", column: "month" } }],
        aggregates: [{ op: "sum", as: "total_revenue", expr: { kind: "column", column: "revenue" } }],
        sort: [{ field: "month", direction: "asc" }],
      } satisfies QueryPlan,
      chartPlan: {
        type: "line",
        title: "Revenue by Month",
        label_key: "month",
        style_preset: "ocean",
        smooth: true,
        series: [{ label: "Revenue", data_key: "total_revenue" }],
      },
    },
    {
      queryId: "smoke-pie-category",
      expectedType: "pie",
      title: "Revenue by Category",
      plan: {
        dataset_id: "sales_fixture",
        group_by: [{ as: "category", expr: { kind: "column", column: "category" } }],
        aggregates: [{ op: "sum", as: "total_revenue", expr: { kind: "column", column: "revenue" } }],
        sort: [{ field: "total_revenue", direction: "desc" }],
      } satisfies QueryPlan,
      chartPlan: {
        type: "pie",
        title: "Revenue by Category",
        label_key: "category",
        style_preset: "sunrise",
        series: [{ label: "Revenue", data_key: "total_revenue" }],
      },
    },
  ];

  const aggregateRowsByChart: Record<string, Record<string, unknown>[]> = {};
  const chartEffects: ChartRenderedEffect[] = [];

  for (const chartSpec of chartSpecs) {
    const aggregateResult = await executeSmokeTool(
      {
        name: "run_aggregate_query",
        arguments: { query_plan: chartSpec.plan },
      },
      datasets,
    );
    const aggregateRows = Array.isArray(aggregateResult.payload.rows)
      ? aggregateResult.payload.rows
      : [];
    aggregateRowsByChart[chartSpec.expectedType] = aggregateRows;
    assertions.push({
      label: `${chartSpec.expectedType} aggregate returns rows`,
      ok: aggregateRows.length > 0,
      detail: `Returned ${aggregateRows.length} rows for ${chartSpec.title}.`,
    });

    const chartResult = await executeSmokeTool(
      {
        name: "request_chart_render",
        arguments: {
          query_id: chartSpec.queryId,
          query_plan: chartSpec.plan,
          chart_plan: chartSpec.chartPlan,
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
    label: "Bar chart aggregate identifies West as top region",
    ok: barTopRow?.region === "West" && barTopRow?.total_revenue === 360,
    detail: `Top bar row was ${JSON.stringify(barTopRow)}.`,
  });

  const lineRows = aggregateRowsByChart.line ?? [];
  assertions.push({
    label: "Line chart aggregate covers all three months",
    ok: lineRows.length == 3,
    detail: `Line rows: ${JSON.stringify(lineRows)}.`,
  });

  const pieRows = aggregateRowsByChart.pie ?? [];
  assertions.push({
    label: "Pie chart aggregate captures hardware, software, and services",
    ok: pieRows.length == 3,
    detail: `Pie rows: ${JSON.stringify(pieRows)}.`,
  });

  assertions.push({
    label: "All three chart types were produced",
    ok: new Set(chartEffects.map((effect) => effect.chart.type)).size === 3,
    detail: `Chart types: ${chartEffects.map((effect) => effect.chart.type).join(", ")}.`,
  });

  return {
    ok: assertions.every((assertion) => assertion.ok),
    datasets,
    listedCsvFileCount: csvFiles.length,
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
