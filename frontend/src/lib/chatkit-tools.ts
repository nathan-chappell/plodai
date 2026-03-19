import type {
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  CreateReportToolArgs,
  CreateCsvFileToolArgs,
  CreateJsonFileToolArgs,
  DataRow,
  GetReportToolArgs,
  AppendReportItemToolArgs,
  ListLoadedDatasetsToolArgs,
  ListReportsToolArgs,
  ListWorkspaceFilesToolArgs,
  RemoveReportItemToolArgs,
  RenderChartFromFileToolArgs,
  RunLocalQueryToolArgs,
} from "../types/analysis";
import type { LocalChartableFile, LocalDataset } from "../types/report";

import { executeQueryPlan } from "./analysis";
import { renderChartToDataUrl } from "./chart";
import { parseCsvText } from "./csv";
import { parseJsonText } from "./json";
import { normalizeAbsolutePath, normalizePathPrefix, pathStartsWithPrefix, resolveWorkspacePath } from "./workspace-fs";
import { rowsToCsv, rowsToJson } from "./workspace-files";

export type LoadedDataset = LocalDataset;

export type ClientToolExecutionResult = {
  payload: Record<string, unknown>;
  effects: ClientEffect[];
};

function filePathForDataset(dataset: LoadedDataset): string {
  return normalizeAbsolutePath(`/${dataset.name}`);
}

function summarizeDataset(dataset: LoadedDataset, includeSamples: boolean): Record<string, unknown> {
  return {
    id: dataset.id,
    name: dataset.name,
    path: filePathForDataset(dataset),
    kind: "csv",
    extension: "csv",
    row_count: dataset.row_count,
    columns: dataset.columns,
    numeric_columns: dataset.numeric_columns,
    sample_rows: includeSamples ? dataset.sample_rows : [],
  };
}

function listDatasetsByPrefix(
  datasets: LoadedDataset[],
  prefix: string | undefined,
): LoadedDataset[] {
  const normalizedPrefix = prefix?.trim() ? normalizePathPrefix(prefix) : "/";
  return datasets.filter((dataset) => pathStartsWithPrefix(filePathForDataset(dataset), normalizedPrefix));
}

function buildWorkspaceContextPayload(
  datasets: LoadedDataset[],
  prefix = "/",
): { path_prefix: string; referenced_item_ids: string[] } {
  const normalizedPrefix = normalizePathPrefix(prefix);
  return {
    path_prefix: normalizedPrefix,
    referenced_item_ids: listDatasetsByPrefix(datasets, normalizedPrefix).map((dataset) => dataset.id),
  };
}

function ensureCsvPath(path: string): string {
  const trimmed = path.trim() || "derived.csv";
  const resolvedPath = resolveWorkspacePath(trimmed, "/");
  return resolvedPath.toLowerCase().endsWith(".csv") ? resolvedPath : `${resolvedPath}.csv`;
}

function ensureJsonPath(path: string): string {
  const trimmed = path.trim() || "derived.json";
  const resolvedPath = resolveWorkspacePath(trimmed, "/");
  return resolvedPath.toLowerCase().endsWith(".json") ? resolvedPath : `${resolvedPath}.json`;
}

export async function executeClientTool<Name extends ClientToolName>(
  toolCall: ClientToolCall<Name>,
  datasets: LoadedDataset[],
): Promise<ClientToolExecutionResult> {
  switch (toolCall.name) {
    case "list_csv_files": {
      const args = toolCall.arguments as ListLoadedDatasetsToolArgs;
      const normalizedPrefix = args.prefix?.trim() ? normalizePathPrefix(args.prefix) : "/";
      const csvFiles = listDatasetsByPrefix(datasets, normalizedPrefix).map((dataset) =>
        summarizeDataset(dataset, args.includeSamples ?? true),
      );
      return {
        payload: {
          path_prefix: normalizedPrefix,
          workspace_context: buildWorkspaceContextPayload(datasets, normalizedPrefix),
          csv_files: csvFiles,
          files: csvFiles,
        },
        effects: [],
      };
    }
    case "list_chartable_files": {
      const args = toolCall.arguments as ListWorkspaceFilesToolArgs;
      const normalizedPrefix = args.prefix?.trim() ? normalizePathPrefix(args.prefix) : "/";
      const chartableFiles = listDatasetsByPrefix(datasets, normalizedPrefix).map((dataset) =>
        summarizeDataset(dataset, args.includeSamples ?? true),
      );
      return {
        payload: {
          path_prefix: normalizedPrefix,
          workspace_context: buildWorkspaceContextPayload(datasets, normalizedPrefix),
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
          path_prefix: "/",
          workspace_context: buildWorkspaceContextPayload(datasets, "/"),
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
      const targetPath = ensureCsvPath(args.path);
      return {
        payload: {
          path_prefix: "/",
          workspace_context: buildWorkspaceContextPayload(datasets, "/"),
          created_file: {
            id: "smoke-csv",
            name: targetPath.split("/").filter(Boolean).at(-1) ?? "derived.csv",
            path: targetPath,
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
      const targetPath = ensureJsonPath(args.path);
      return {
        payload: {
          path_prefix: "/",
          workspace_context: buildWorkspaceContextPayload(datasets, "/"),
          created_file: {
            id: "smoke-json",
            name: targetPath.split("/").filter(Boolean).at(-1) ?? "derived.json",
            path: targetPath,
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
            items: [],
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
            items: [],
          },
          reports: [],
          current_report_id: args.report_id ?? "smoke-report",
        },
        effects: [],
      };
    }
    case "append_report_item": {
      const args = toolCall.arguments as AppendReportItemToolArgs;
      return {
        payload: {
          report_id: args.report_id,
          item: args.item,
        },
        effects: [],
      };
    }
    case "remove_report_item": {
      const args = toolCall.arguments as RemoveReportItemToolArgs;
      return {
        payload: {
          report_id: args.report_id,
          item_id: args.item_id,
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
