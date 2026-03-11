import type { ClientEffect, ClientToolArgsMap, ClientToolCall, ClientToolName, DataRow } from "../types/analysis";
import type { DatasetSummary } from "../types/report";

import { executeAnalysisPlan } from "./analysis";

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
    case "list_loaded_datasets": {
      return {
        payload: {
          datasets: datasets.map((dataset) => ({
            id: dataset.id,
            name: dataset.name,
            row_count: dataset.row_count,
            columns: dataset.columns,
            sample_rows: toolCall.arguments.includeSamples ? dataset.sample_rows : [],
          })),
        },
        effects: [],
      };
    }
    case "run_local_query": {
      const dataset = findDataset(datasets, toolCall.arguments.datasetId);
      const rows = dataset.rows ?? dataset.sample_rows;
      const result = executeAnalysisPlan(rows, toolCall.arguments.analysis);
      return {
        payload: {
          rows: result.rows,
          row_count: result.rows.length,
        },
        effects: [],
      };
    }
    case "render_chart": {
      const dataset = findDataset(datasets, toolCall.arguments.datasetId);
      const rows = dataset.rows ?? dataset.sample_rows;
      const result = executeAnalysisPlan(rows, toolCall.arguments.analysis);
      return {
        payload: {
          rows: result.rows,
          row_count: result.rows.length,
          chart: toolCall.arguments.chart,
          query_id: toolCall.arguments.queryId,
        },
        effects: [
          {
            type: "chart_rendered",
            queryId: toolCall.arguments.queryId,
            chart: toolCall.arguments.chart,
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
