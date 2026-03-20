import type {
  AppendReportSlideToolArgs,
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  CreateCsvFileToolArgs,
  CreateJsonFileToolArgs,
  CreateReportToolArgs,
  DataRow,
  GetReportToolArgs,
  ListLoadedDatasetsToolArgs,
  ListReportsToolArgs,
  ListWorkspaceFilesToolArgs,
  RemoveReportSlideToolArgs,
  RenderChartFromFileToolArgs,
  RunLocalQueryToolArgs,
} from "../types/analysis";
import type { LocalChartableFile, LocalDataset } from "../types/report";

import { executeQueryPlan } from "./analysis";
import { renderChartToDataUrl } from "./chart";
import { parseCsvText } from "./csv";
import { parseJsonText } from "./json";
import { rowsToCsv, rowsToJson } from "./workspace-files";

export type LoadedDataset = LocalDataset;

export type ClientToolExecutionResult = {
  payload: Record<string, unknown>;
  effects: ClientEffect[];
};

function buildWorkspaceContextPayload(
  datasets: LoadedDataset[],
): { workspace_id: string; referenced_item_ids: string[] } {
  return {
    workspace_id: "smoke",
    referenced_item_ids: datasets.map((dataset) => dataset.id),
  };
}

function summarizeDataset(dataset: LoadedDataset, includeSamples: boolean): Record<string, unknown> {
  return {
    id: dataset.id,
    name: dataset.name,
    bucket: "uploaded",
    producer_key: "uploaded",
    producer_label: "Uploaded",
    source: "uploaded",
    kind: "csv",
    extension: "csv",
    row_count: dataset.row_count,
    columns: dataset.columns,
    numeric_columns: dataset.numeric_columns,
    sample_rows: includeSamples ? dataset.sample_rows : [],
  };
}

function ensureCsvFilename(filename: string): string {
  const requested = filename.trim() || "derived.csv";
  return requested.toLowerCase().endsWith(".csv") ? requested : `${requested}.csv`;
}

function ensureJsonFilename(filename: string): string {
  const requested = filename.trim() || "derived.json";
  return requested.toLowerCase().endsWith(".json") ? requested : `${requested}.json`;
}

export async function executeClientTool<Name extends ClientToolName>(
  toolCall: ClientToolCall<Name>,
  datasets: LoadedDataset[],
): Promise<ClientToolExecutionResult> {
  switch (toolCall.name) {
    case "list_csv_files": {
      const args = toolCall.arguments as ListLoadedDatasetsToolArgs;
      const csvFiles = datasets.map((dataset) =>
        summarizeDataset(dataset, args.includeSamples ?? true),
      );
      return {
        payload: {
          workspace_id: "smoke",
          workspace_context: buildWorkspaceContextPayload(datasets),
          csv_files: csvFiles,
          files: csvFiles,
        },
        effects: [],
      };
    }
    case "list_chartable_files": {
      const args = toolCall.arguments as ListWorkspaceFilesToolArgs;
      const chartableFiles = datasets.map((dataset) =>
        summarizeDataset(dataset, args.includeSamples ?? true),
      );
      return {
        payload: {
          workspace_id: "smoke",
          workspace_context: buildWorkspaceContextPayload(datasets),
          chartable_files: chartableFiles,
          files: chartableFiles,
        },
        effects: [],
      };
    }
    case "list_pdf_files": {
      void (toolCall.arguments as ListWorkspaceFilesToolArgs);
      return {
        payload: {
          workspace_id: "smoke",
          workspace_context: buildWorkspaceContextPayload(datasets),
          pdf_files: [],
          files: [],
        },
        effects: [],
      };
    }
    case "run_aggregate_query": {
      const args = toolCall.arguments as RunLocalQueryToolArgs;
      const dataset = findDataset(datasets, args.query_plan.dataset_id);
      const result = executeQueryPlan(dataset.rows as DataRow[], args.query_plan);
      return {
        payload: {
          rows: result.rows,
          row_count: result.rows.length,
        },
        effects: [],
      };
    }
    case "create_csv_file": {
      const args = toolCall.arguments as CreateCsvFileToolArgs;
      const dataset = findDataset(datasets, args.query_plan.dataset_id);
      const result = executeQueryPlan(dataset.rows as DataRow[], args.query_plan);
      const csvText = rowsToCsv(result.rows);
      const preview = parseCsvText(csvText);
      return {
        payload: {
          workspace_id: "smoke",
          workspace_context: buildWorkspaceContextPayload(datasets),
          created_file: {
            id: "smoke-csv",
            name: ensureCsvFilename(args.filename),
            bucket: "data",
            producer_key: "smoke",
            producer_label: "Smoke",
            source: "derived",
            kind: "csv",
            extension: "csv",
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
    case "create_json_file": {
      const args = toolCall.arguments as CreateJsonFileToolArgs;
      const dataset = findDataset(datasets, args.query_plan.dataset_id);
      const result = executeQueryPlan(dataset.rows as DataRow[], args.query_plan);
      const jsonText = rowsToJson(result.rows);
      const preview = parseJsonText(jsonText);
      return {
        payload: {
          workspace_id: "smoke",
          workspace_context: buildWorkspaceContextPayload(datasets),
          created_file: {
            id: "smoke-json",
            name: ensureJsonFilename(args.filename),
            bucket: "data",
            producer_key: "smoke",
            producer_label: "Smoke",
            source: "derived",
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
    case "list_reports": {
      void (toolCall.arguments as ListReportsToolArgs);
      return {
        payload: {
          reports: [],
          current_report_id: null,
        },
        effects: [],
      };
    }
    case "get_report": {
      const args = toolCall.arguments as GetReportToolArgs;
      return {
        payload: {
          report: {
            version: "v1",
            report_id: args.report_id,
            title: args.report_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            slides: [],
          },
        },
        effects: [],
      };
    }
    case "create_report": {
      const args = toolCall.arguments as CreateReportToolArgs;
      return {
        payload: {
          report: {
            version: "v1",
            report_id: args.report_id ?? "smoke-report",
            title: args.title,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            slides: [],
          },
          reports: [],
          current_report_id: args.report_id ?? "smoke-report",
        },
        effects: [],
      };
    }
    case "append_report_slide": {
      const args = toolCall.arguments as AppendReportSlideToolArgs;
      return {
        payload: {
          report_id: args.report_id,
          slide: args.slide,
        },
        effects: [],
      };
    }
    case "remove_report_slide": {
      const args = toolCall.arguments as RemoveReportSlideToolArgs;
      return {
        payload: {
          report_id: args.report_id,
          slide_id: args.slide_id,
          removed: true,
        },
        effects: [],
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
