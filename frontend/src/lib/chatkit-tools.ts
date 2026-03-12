import type {
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  DataRow,
  ListLoadedDatasetsToolArgs,
  RenderChartToolArgs,
  RunLocalQueryToolArgs,
} from "../types/analysis";
import type { DatasetSummary } from "../types/report";

import { executeQueryPlan } from "./analysis";
import { renderChartToDataUrl } from "./chart";

export type LoadedDataset = DatasetSummary & {
  rows?: DataRow[];
};

export type ClientToolExecutionResult = {
  payload: Record<string, unknown>;
  effects: ClientEffect[];
};

export async function executeClientTool<Name extends ClientToolName>(
  toolCall: ClientToolCall<Name>,
  datasets: LoadedDataset[],
): Promise<ClientToolExecutionResult> {
  switch (toolCall.name) {
    case "list_accessible_datasets": {
      const args = toolCall.arguments as ListLoadedDatasetsToolArgs;
      return {
        payload: {
          datasets: datasets.map((dataset) => ({
            id: dataset.id,
            name: dataset.name,
            row_count: dataset.row_count,
            columns: dataset.columns,
            sample_rows: args.includeSamples ? dataset.sample_rows : [],
          })),
        },
        effects: [],
      };
    }
    case "run_aggregate_query": {
      const args = toolCall.arguments as RunLocalQueryToolArgs;
      const dataset = findDataset(datasets, args.query_plan.dataset_id);
      const rows = dataset.rows ?? dataset.sample_rows;
      const result = executeQueryPlan(rows, args.query_plan);
      return {
        payload: {
          rows: result.rows,
          row_count: result.rows.length,
        },
        effects: [],
      };
    }
    case "request_chart_render": {
      const args = toolCall.arguments as RenderChartToolArgs;
      const dataset = findDataset(datasets, args.query_plan.dataset_id);
      const rows = dataset.rows ?? dataset.sample_rows;
      const result = executeQueryPlan(rows, args.query_plan);
      const imageDataUrl = await renderChartToDataUrl(args.chart_plan, result.rows);
      return {
        payload: {
          rows: result.rows,
          row_count: result.rows.length,
          chart: args.chart_plan,
          query_id: args.query_id,
          imageDataUrl,
        },
        effects: [
          {
            type: "chart_rendered",
            queryId: args.query_id,
            chart: args.chart_plan,
            imageDataUrl: imageDataUrl ?? undefined,
            rows: result.rows,
          },
        ],
      };
    }
  }
}

function findDataset(datasets: LoadedDataset[], datasetId: string): LoadedDataset {
  const dataset = datasets.find((candidate) => candidate.id === datasetId);
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetId}`);
  }
  return dataset;
}
