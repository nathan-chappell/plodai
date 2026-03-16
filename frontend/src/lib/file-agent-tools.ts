import { executeQueryPlanInWorker } from "./analysis-worker-client";
import { renderChartToDataUrl } from "./chart";
import { parseCsvText } from "./csv";
import { base64ToUint8Array, extractPdfPageRangeFromBytes } from "./pdf";
import {
  createCsvFileToolSchema,
  getPdfPageRangeToolSchema,
  includeSamplesSchema,
  requestChartRenderToolSchema,
  runAggregateQueryToolSchema,
} from "./tool-schemas";
import {
  findWorkspaceFile,
  getCsvFiles,
  getFileExtension,
  rowsToCsv,
  summarizeWorkspaceFiles,
} from "./workspace-files";
import type { CapabilityClientTool, FunctionToolDefinition } from "../capabilities/types";
import type {
  ClientEffect,
  ClientToolArgsMap,
  CreateCsvFileToolArgs,
  DataRow,
  GetPdfPageRangeToolArgs,
  ListLoadedDatasetsToolArgs,
  ListWorkspaceFilesToolArgs,
  RenderChartToolArgs,
  RunLocalQueryToolArgs,
} from "../types/analysis";
import type { LocalDataset, LocalPdfFile, LocalWorkspaceFile } from "../types/report";

function findDataset(files: LocalWorkspaceFile[], datasetId: string): LocalDataset {
  const file = findWorkspaceFile(files, datasetId);
  if (file.kind !== "csv") {
    throw new Error(`File ${file.name} is not a CSV dataset.`);
  }
  return file;
}

async function listWorkspaceFilesTool(
  args: ListWorkspaceFilesToolArgs,
  files: LocalWorkspaceFile[],
): Promise<Record<string, unknown>> {
  const csvFiles = getCsvFiles(files);
  return {
    files: summarizeWorkspaceFiles(files, { includeSamples: args.includeSamples }),
    csv_files: csvFiles.map((file) => ({
      id: file.id,
      name: file.name,
      row_count: file.row_count,
      columns: file.columns,
      numeric_columns: file.numeric_columns,
      sample_rows: args.includeSamples ? file.sample_rows : [],
    })),
  };
}

async function listAttachedCsvFilesTool(
  args: ListLoadedDatasetsToolArgs,
  files: LocalWorkspaceFile[],
): Promise<Record<string, unknown>> {
  const datasets = getCsvFiles(files);
  return {
    csv_files: datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      row_count: dataset.row_count,
      columns: dataset.columns,
      numeric_columns: dataset.numeric_columns,
      sample_rows: args.includeSamples ? dataset.sample_rows : [],
    })),
  };
}

async function runAggregateQueryTool(
  args: RunLocalQueryToolArgs,
  files: LocalWorkspaceFile[],
): Promise<Record<string, unknown>> {
  const dataset = findDataset(files, args.query_plan.dataset_id);
  const rows = (dataset.rows as DataRow[]) ?? dataset.sample_rows;
  const resultRows = await executeQueryPlanInWorker(rows, args.query_plan);
  return {
    rows: resultRows,
    row_count: resultRows.length,
  };
}

async function requestChartRenderTool(
  args: RenderChartToolArgs,
  files: LocalWorkspaceFile[],
): Promise<{ payload: Record<string, unknown>; effect: ClientEffect }> {
  const dataset = findDataset(files, args.query_plan.dataset_id);
  const rows = (dataset.rows as DataRow[]) ?? dataset.sample_rows;
  const resultRows = await executeQueryPlanInWorker(rows, args.query_plan);
  const imageDataUrl = await renderChartToDataUrl(args.chart_plan, resultRows);
  return {
    payload: {
      rows: resultRows,
      row_count: resultRows.length,
      chart: args.chart_plan,
      query_id: args.query_id,
      imageDataUrl,
    },
    effect: {
      type: "chart_rendered",
      queryId: args.query_id,
      chart: args.chart_plan,
      imageDataUrl: imageDataUrl ?? undefined,
      rows: resultRows,
    },
  };
}

async function createCsvFileTool(
  args: CreateCsvFileToolArgs,
  files: LocalWorkspaceFile[],
): Promise<{ payload: Record<string, unknown>; file: LocalDataset }> {
  const dataset = findDataset(files, args.query_plan.dataset_id);
  const rows = (dataset.rows as DataRow[]) ?? dataset.sample_rows;
  const resultRows = await executeQueryPlanInWorker(rows, args.query_plan);
  const csvText = rowsToCsv(resultRows);
  const preview = parseCsvText(csvText);
  const filename = ensureCsvFilename(args.filename);
  const nextFile: LocalDataset = {
    id: crypto.randomUUID(),
    name: filename,
    kind: "csv",
    extension: "csv",
    byte_size: new TextEncoder().encode(csvText).length,
    mime_type: "text/csv",
    row_count: preview.rowCount,
    columns: preview.columns,
    numeric_columns: preview.numericColumns,
    sample_rows: preview.sampleRows,
    rows: preview.rows,
    preview_rows: preview.previewRows,
  };
  return {
    payload: {
      created_file: summarizeWorkspaceFiles([nextFile], { includeSamples: true })[0],
      row_count: resultRows.length,
    },
    file: nextFile,
  };
}

async function getPdfPageRangeTool(
  args: GetPdfPageRangeToolArgs,
  files: LocalWorkspaceFile[],
): Promise<{ payload: Record<string, unknown>; file: LocalPdfFile }> {
  const file = findWorkspaceFile(files, args.file_id);
  if (file.kind !== "pdf") {
    throw new Error(`File ${file.name} is not a PDF.`);
  }

  const extracted = await extractPdfPageRangeFromBytes(base64ToUint8Array(file.bytes_base64), {
    filename: file.name,
    startPage: args.start_page,
    endPage: args.end_page,
  });
  const nextFile: LocalPdfFile = {
    id: crypto.randomUUID(),
    name: extracted.filename,
    kind: "pdf",
    extension: getFileExtension(extracted.filename),
    byte_size: Math.ceil((extracted.fileDataBase64.length * 3) / 4),
    mime_type: extracted.mimeType,
    page_count: extracted.pageRange.pageCount,
    bytes_base64: extracted.fileDataBase64,
  };

  return {
    payload: {
      created_file: summarizeWorkspaceFiles([nextFile])[0],
      page_range: {
        start_page: extracted.pageRange.startPage,
        end_page: extracted.pageRange.endPage,
        page_count: extracted.pageRange.pageCount,
      },
      file_input: {
        filename: extracted.filename,
        mime_type: extracted.mimeType,
        file_data: extracted.fileDataBase64,
      },
    },
    file: nextFile,
  };
}

export function createWorkspaceClientTools(
  files: LocalWorkspaceFile[],
  options: WorkspaceClientToolOptions = {},
): CapabilityClientTool[] {
  return buildWorkspaceClientToolCatalog(options).map((tool) => ({
    ...tool,
    handler: async (args, context) => {
      switch (tool.name) {
        case "list_workspace_files":
          return listWorkspaceFilesTool(args as ClientToolArgsMap["list_workspace_files"], files);
        case "list_attached_csv_files":
          return listAttachedCsvFilesTool(args as ClientToolArgsMap["list_attached_csv_files"], files);
        case "run_aggregate_query":
          return runAggregateQueryTool(args as ClientToolArgsMap["run_aggregate_query"], files);
        case "request_chart_render": {
          const result = await requestChartRenderTool(args as ClientToolArgsMap["request_chart_render"], files);
          context.emitEffect(result.effect);
          return result.payload;
        }
        case "create_csv_file": {
          const result = await createCsvFileTool(args as ClientToolArgsMap["create_csv_file"], files);
          context.appendFiles([result.file]);
          return result.payload;
        }
        case "get_pdf_page_range": {
          const result = await getPdfPageRangeTool(args as ClientToolArgsMap["get_pdf_page_range"], files);
          context.appendFiles([result.file]);
          return result.payload;
        }
      }
      throw new Error(`Unhandled workspace client tool: ${tool.name}`);
    },
  }));
}

export type WorkspaceClientToolOptions = {
  includeCsvTools?: boolean;
  includeCharts?: boolean;
  includeCsvCreation?: boolean;
  includePdfRange?: boolean;
};

export function buildWorkspaceClientToolCatalog(
  options: WorkspaceClientToolOptions = {},
): FunctionToolDefinition[] {
  const tools: FunctionToolDefinition[] = [
    {
      type: "function",
      name: "list_workspace_files",
      description:
        "List the workspace files currently available on the client, including lightweight metadata and tiny familiarization samples when requested.",
      strict: true,
      parameters: includeSamplesSchema,
    },
  ];

  if (options.includeCsvTools ?? true) {
    tools.push(
      {
        type: "function",
        name: "list_attached_csv_files",
        description:
          "List the CSV files currently available on the client, including safe schema details, row counts, numeric columns, and tiny familiarization samples.",
        strict: true,
        parameters: includeSamplesSchema,
      },
      {
        type: "function",
        name: "run_aggregate_query",
        description:
          "Execute a validated aggregate query plan against the client-side CSV rows and return grouped or summary results.",
        strict: true,
        parameters: runAggregateQueryToolSchema,
      },
    );
  }

  if (options.includeCharts ?? false) {
    tools.push({
      type: "function",
      name: "request_chart_render",
      description:
        "Run a validated query plan locally, render a chart on the client, and return the result rows plus chart metadata.",
      strict: true,
      parameters: requestChartRenderToolSchema,
    });
  }

  if (options.includeCsvCreation ?? false) {
    tools.push({
      type: "function",
      name: "create_csv_file",
      description:
        "Run a validated query plan locally, materialize the result rows as a new CSV file, and add it to the workspace file list.",
      strict: true,
      parameters: createCsvFileToolSchema,
    });
  }

  if (options.includePdfRange ?? false) {
    tools.push({
      type: "function",
      name: "get_pdf_page_range",
      description:
        "Extract an inclusive page range from a PDF file, add the derived sub-PDF to the workspace, and return it as a file input payload.",
      strict: true,
      parameters: getPdfPageRangeToolSchema,
    });
  }

  return tools;
}

export function buildWorkspaceQuickActions(fileCount: number, investigationBrief: string) {
  const briefSuffix = investigationBrief.trim() ? ` Focus on this goal: ${investigationBrief.trim()}` : "";
  return [
    {
      label: "Summarize files",
      prompt: `Give me a concise summary of the attached files and the strongest next actions.${briefSuffix}`,
    },
    {
      label: "Investigate",
      prompt: `Investigate the attached files proactively and use the available tools instead of stopping after one step.${briefSuffix}`,
    },
    {
      label: "Plan next steps",
      prompt: `Inspect the ${fileCount} attached file${fileCount === 1 ? "" : "s"} and propose the most useful next operations.${briefSuffix}`,
    },
  ] as const;
}

function ensureCsvFilename(filename: string): string {
  const trimmed = filename.trim() || "derived.csv";
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}
