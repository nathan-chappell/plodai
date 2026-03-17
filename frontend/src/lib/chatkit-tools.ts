import type {
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  CreateJsonFileToolArgs,
  DataRow,
  ListLoadedDatasetsToolArgs,
  RenderChartFromFileToolArgs,
  RunLocalQueryToolArgs,
} from "../types/analysis";
import type { LocalChartableFile, LocalDataset } from "../types/report";

import { executeQueryPlan } from "./analysis";
import { renderChartToDataUrl } from "./chart";
import { parseJsonText } from "./json";
import { rowsToJson } from "./workspace-files";

export type LoadedDataset = LocalDataset;

export type ClientToolExecutionResult = {
  payload: Record<string, unknown>;
  effects: ClientEffect[];
};

export async function executeClientTool<Name extends ClientToolName>(
  toolCall: ClientToolCall<Name>,
  datasets: LoadedDataset[],
): Promise<ClientToolExecutionResult> {
  switch (toolCall.name) {
    case "list_workspace_files": {
      const args = toolCall.arguments as ListLoadedDatasetsToolArgs;
      return {
        payload: {
          files: datasets.map((dataset) => ({
            id: dataset.id,
            name: dataset.name,
            kind: "csv",
            extension: "csv",
            row_count: dataset.row_count,
            columns: dataset.columns,
            numeric_columns: dataset.numeric_columns,
            sample_rows: args.includeSamples ? dataset.sample_rows : [],
          })),
          csv_files: datasets.map((dataset) => ({
            id: dataset.id,
            name: dataset.name,
            row_count: dataset.row_count,
            columns: dataset.columns,
            numeric_columns: dataset.numeric_columns,
            sample_rows: args.includeSamples ? dataset.sample_rows : [],
          })),
          chartable_files: datasets.map((dataset) => ({
            id: dataset.id,
            name: dataset.name,
            kind: "csv",
            extension: "csv",
            row_count: dataset.row_count,
            columns: dataset.columns,
            numeric_columns: dataset.numeric_columns,
            sample_rows: args.includeSamples ? dataset.sample_rows : [],
          })),
        },
        effects: [],
      };
    }
    case "list_attached_csv_files": {
      const args = toolCall.arguments as ListLoadedDatasetsToolArgs;
      return {
        payload: {
          csv_files: datasets.map((dataset) => ({
            id: dataset.id,
            name: dataset.name,
            row_count: dataset.row_count,
            columns: dataset.columns,
            numeric_columns: dataset.numeric_columns,
            sample_rows: args.includeSamples ? dataset.sample_rows : [],
          })),
        },
        effects: [],
      };
    }
    case "list_chartable_files": {
      const args = toolCall.arguments as ListLoadedDatasetsToolArgs;
      return {
        payload: {
          chartable_files: datasets.map((dataset) => ({
            id: dataset.id,
            name: dataset.name,
            kind: "csv",
            extension: "csv",
            row_count: dataset.row_count,
            columns: dataset.columns,
            numeric_columns: dataset.numeric_columns,
            sample_rows: args.includeSamples ? dataset.sample_rows : [],
          })),
        },
        effects: [],
      };
    }
    case "run_aggregate_query": {
      const args = toolCall.arguments as RunLocalQueryToolArgs;
      const dataset = findDataset(datasets, args.query_plan.dataset_id);
      const result = executeQueryPlan(dataset.rows, args.query_plan);
      return {
        payload: {
          rows: result.rows,
          row_count: result.rows.length,
        },
        effects: [],
      };
    }
    case "create_json_file": {
      const args = toolCall.arguments as CreateJsonFileToolArgs;
      const dataset = findDataset(datasets, args.query_plan.dataset_id);
      const result = executeQueryPlan(dataset.rows, args.query_plan);
      const jsonText = rowsToJson(result.rows);
      const preview = parseJsonText(jsonText);
      return {
        payload: {
          created_file: {
            id: "smoke-json",
            name: args.filename,
            kind: "json",
            extension: "json",
            row_count: preview.rowCount,
            columns: preview.columns,
            numeric_columns: preview.numericColumns,
            sample_rows: preview.sampleRows,
          },
          row_count: result.rows.length,
        },
        effects: [],
      };
    }
    case "render_chart_from_file": {
      const args = toolCall.arguments as RenderChartFromFileToolArgs;
      const dataset = findChartableFile(datasets, args.file_id);
      const chartPlan = {
        ...args.chart_plan,
        label_key: args.x_key,
        series: args.y_key ? [{ label: args.y_key, data_key: args.y_key }] : args.chart_plan.series,
      };
      const imageDataUrl = await renderChartToDataUrl(chartPlan, dataset.rows);
      return {
        payload: {
          rows: dataset.rows,
          row_count: dataset.rows.length,
          chart: chartPlan,
          file_id: args.file_id,
          chart_plan_id: args.chart_plan_id,
          imageDataUrl,
        },
        effects: [
          {
            type: "chart_rendered",
            fileId: args.file_id,
            chartPlanId: args.chart_plan_id,
            chart: chartPlan,
            imageDataUrl: imageDataUrl ?? undefined,
            rows: dataset.rows,
          },
        ],
      };
    }
    default:
      throw new Error(`Tool ${toolCall.name} is not implemented in the smoke-test client executor.`);
  }
}

function findDataset(datasets: LoadedDataset[], datasetId: string): LoadedDataset {
  const dataset = datasets.find((candidate) => candidate.id === datasetId);
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetId}`);
  }
  return dataset;
}

function findChartableFile(files: LocalChartableFile[], fileId: string): LocalChartableFile {
  const file = files.find((candidate) => candidate.id === fileId);
  if (!file) {
    throw new Error(`Unknown chartable file: ${fileId}`);
  }
  return file;
}
