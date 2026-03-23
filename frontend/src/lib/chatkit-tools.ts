import type {
  AppendReportSlideToolArgs,
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  CreateDatasetToolArgs,
  CreateReportToolArgs,
  DataRow,
  GetFarmStateToolArgs,
  GetReportToolArgs,
  InspectDatasetSchemaToolArgs,
  InspectImageFileToolArgs,
  ListDatasetsToolArgs,
  ListImageFilesToolArgs,
  ListReportsToolArgs,
  ListWorkspaceFilesToolArgs,
  RemoveReportSlideToolArgs,
  RenderChartFromDatasetToolArgs,
  RunAggregateQueryToolArgs,
  SaveFarmStateToolArgs,
} from "../types/analysis";
import type { LocalDataset, LocalAttachment } from "../types/report";

import { executeQueryPlan } from "./analysis";
import { renderChartToDataUrl } from "./chart";
import { parseCsvText } from "./csv";
import { buildImageDataUrlFromBase64 } from "./image";
import { parseJsonText } from "./json";
import { rowsToCsv, rowsToJson } from "./workspace-files";

export type LoadedDataset = LocalDataset;

export type ClientToolExecutionResult = {
  payload: Record<string, unknown>;
  effects: ClientEffect[];
};

function findImageFile(files: LocalAttachment[], fileId: string) {
  const file = files.find((candidate) => candidate.id === fileId);
  if (!file || file.kind !== "image") {
    throw new Error(`Unknown image file: ${fileId}`);
  }
  return file;
}

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
    kind: dataset.kind,
    extension: dataset.extension,
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
    case "list_datasets": {
      const args = toolCall.arguments as ListDatasetsToolArgs;
      const summarizedDatasets = datasets.map((dataset) =>
        summarizeDataset(dataset, args.includeSamples ?? true),
      );
      return {
        payload: {
          workspace_id: "smoke",
          workspace_context: buildWorkspaceContextPayload(datasets),
          datasets: summarizedDatasets,
          files: summarizedDatasets,
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
    case "list_image_files": {
      void (toolCall.arguments as ListImageFilesToolArgs);
      const imageFiles = (datasets as unknown as LocalAttachment[]).filter(
        (
          file,
        ): file is Extract<LocalAttachment, { kind: "image" }> => file.kind === "image",
      );
      return {
        payload: {
          workspace_id: "smoke",
          workspace_context: buildWorkspaceContextPayload(datasets),
          image_files: imageFiles,
          files: imageFiles,
        },
        effects: [],
      };
    }
    case "run_aggregate_query": {
      const args = toolCall.arguments as RunAggregateQueryToolArgs;
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
    case "create_dataset": {
      const args = toolCall.arguments as CreateDatasetToolArgs;
      const dataset = findDataset(datasets, args.query_plan.dataset_id);
      const result = executeQueryPlan(dataset.rows as DataRow[], args.query_plan);
      const serializedText =
        args.format === "json" ? rowsToJson(result.rows) : rowsToCsv(result.rows);
      const preview =
        args.format === "json"
          ? parseJsonText(serializedText)
          : parseCsvText(serializedText);
      return {
        payload: {
          workspace_id: "smoke",
          workspace_context: buildWorkspaceContextPayload(datasets),
          created_file: {
            id: `smoke-${args.format}`,
            name:
              args.format === "json"
                ? ensureJsonFilename(args.filename)
                : ensureCsvFilename(args.filename),
            bucket: "data",
            producer_key: "smoke",
            producer_label: "Smoke",
            source: "derived",
            kind: args.format,
            extension: args.format,
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
    case "inspect_dataset_schema": {
      const args = toolCall.arguments as InspectDatasetSchemaToolArgs;
      const dataset = findDataset(datasets, args.dataset_id);
      return {
        payload: {
          dataset_id: dataset.id,
          kind: dataset.kind,
          row_count: dataset.row_count,
          columns: dataset.columns,
          numeric_columns: dataset.numeric_columns,
          sample_rows: dataset.sample_rows,
        },
        effects: [],
      };
    }
    case "render_chart_from_dataset": {
      const args = toolCall.arguments as RenderChartFromDatasetToolArgs;
      const dataset = findDataset(datasets, args.dataset_id);
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
          dataset_id: args.dataset_id,
          chart_plan_id: args.chart_plan_id,
          imageDataUrl,
        },
        effects: [
          {
            type: "chart_rendered",
            datasetId: args.dataset_id,
            chartPlanId: args.chart_plan_id,
            chart: chartPlan,
            imageDataUrl: imageDataUrl ?? undefined,
            rows: dataset.rows,
          },
        ],
      };
    }
    case "inspect_image_file": {
      const args = toolCall.arguments as InspectImageFileToolArgs;
      const file = findImageFile(datasets as unknown as LocalAttachment[], args.file_id);
      return {
        payload: {
          workspace_id: "smoke",
          workspace_context: buildWorkspaceContextPayload(datasets),
          file_id: file.id,
          kind: file.kind,
          width: file.width,
          height: file.height,
          mime_type: file.mime_type,
          imageDataUrl: buildImageDataUrlFromBase64(file.bytes_base64, file.mime_type),
        },
        effects: [],
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
    case "get_farm_state": {
      void (toolCall.arguments as GetFarmStateToolArgs);
      return {
        payload: {
          artifact_id: null,
          farm: null,
        },
        effects: [],
      };
    }
    case "save_farm_state": {
      const args = toolCall.arguments as SaveFarmStateToolArgs;
      return {
        payload: {
          artifact_id: "farm-overview",
          artifact_kind: "farm.v1",
          revision: 1,
          farm: {
            version: "v1",
            farm_name: args.farm_name,
            location: args.location ?? null,
            crops: args.crops,
            issues: args.issues,
            projects: args.projects,
            current_work: args.current_work,
            notes: args.notes ?? null,
          },
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
