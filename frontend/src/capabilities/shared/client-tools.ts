import { executeQueryPlanInWorker } from "../../lib/analysis-worker-client";
import { renderChartToDataUrl } from "../../lib/chart";
import { parseCsvText } from "../../lib/csv";
import { parseJsonText } from "../../lib/json";
import {
  base64ToUint8Array,
  extractPdfPageRangeFromBytes,
  inspectPdfBytes,
  smartSplitPdfBytes,
} from "../../lib/pdf";
import {
  createCsvFileToolSchema,
  createJsonFileToolSchema,
  getPdfPageRangeToolSchema,
  includeSamplesSchema,
  inspectChartableFileSchemaToolSchema,
  inspectPdfFileToolSchema,
  renderChartFromFileToolSchema,
  runAggregateQueryToolSchema,
  smartSplitPdfToolSchema,
} from "../../lib/tool-schemas";
import {
  findWorkspaceFile,
  getChartableFiles,
  getCsvFiles,
  getFileExtension,
  rowsToCsv,
  rowsToJson,
  summarizeWorkspaceFiles,
} from "../../lib/workspace-files";
import type {
  CapabilityClientTool,
  CapabilityWorkspaceContext,
  FunctionToolDefinition,
} from "../types";
import type {
  ClientEffect,
  CreateCsvFileToolArgs,
  CreateJsonFileToolArgs,
  DataRow,
  GetPdfPageRangeToolArgs,
  InspectChartableFileSchemaToolArgs,
  InspectPdfFileToolArgs,
  ListLoadedDatasetsToolArgs,
  ListWorkspaceFilesToolArgs,
  RenderChartFromFileToolArgs,
  RunLocalQueryToolArgs,
  SmartSplitEntry,
  SmartSplitPdfToolArgs,
} from "../../types/analysis";
import type {
  LocalChartableFile,
  LocalDataset,
  LocalJsonFile,
  LocalOtherFile,
  LocalPdfFile,
  LocalWorkspaceFile,
} from "../../types/report";

function findDataset(files: LocalWorkspaceFile[], datasetId: string): LocalDataset {
  const file = findWorkspaceFile(files, datasetId);
  if (file.kind !== "csv") {
    throw new Error(`File ${file.name} is not a CSV dataset.`);
  }
  return file;
}

function findChartableFile(files: LocalWorkspaceFile[], fileId: string): LocalChartableFile {
  const file = findWorkspaceFile(files, fileId);
  if (file.kind !== "csv" && file.kind !== "json") {
    throw new Error(`File ${file.name} is not a chartable CSV or JSON artifact.`);
  }
  return file;
}

function ensureCsvFilename(filename: string): string {
  const trimmed = filename.trim() || "derived.csv";
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}

function ensureJsonFilename(filename: string): string {
  const trimmed = filename.trim() || "derived.json";
  return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
}

async function listWorkspaceFilesTool(
  args: ListWorkspaceFilesToolArgs,
  files: LocalWorkspaceFile[],
): Promise<Record<string, unknown>> {
  const csvFiles = getCsvFiles(files);
  const chartableFiles = getChartableFiles(files);
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
    chartable_files: chartableFiles.map((file) => ({
      id: file.id,
      name: file.name,
      kind: file.kind,
      extension: file.extension,
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

async function listChartableFilesTool(
  args: ListWorkspaceFilesToolArgs,
  files: LocalWorkspaceFile[],
): Promise<Record<string, unknown>> {
  const chartableFiles = getChartableFiles(files);
  return {
    chartable_files: chartableFiles.map((file) => ({
      id: file.id,
      name: file.name,
      kind: file.kind,
      extension: file.extension,
      row_count: file.row_count,
      columns: file.columns,
      numeric_columns: file.numeric_columns,
      sample_rows: args.includeSamples ? file.sample_rows : [],
    })),
    files: summarizeWorkspaceFiles(chartableFiles, { includeSamples: args.includeSamples }),
  };
}

async function inspectChartableFileSchemaTool(
  args: InspectChartableFileSchemaToolArgs,
  files: LocalWorkspaceFile[],
): Promise<Record<string, unknown>> {
  const file = findChartableFile(files, args.file_id);
  return {
    file_id: file.id,
    kind: file.kind,
    row_count: file.row_count,
    columns: file.columns,
    numeric_columns: file.numeric_columns,
    sample_rows: file.sample_rows,
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

async function createJsonFileTool(
  args: CreateJsonFileToolArgs,
  files: LocalWorkspaceFile[],
): Promise<{ payload: Record<string, unknown>; file: LocalJsonFile }> {
  const dataset = findDataset(files, args.query_plan.dataset_id);
  const rows = (dataset.rows as DataRow[]) ?? dataset.sample_rows;
  const resultRows = await executeQueryPlanInWorker(rows, args.query_plan);
  const jsonText = rowsToJson(resultRows);
  const preview = parseJsonText(jsonText);
  const filename = ensureJsonFilename(args.filename);
  const nextFile: LocalJsonFile = {
    id: crypto.randomUUID(),
    name: filename,
    kind: "json",
    extension: "json",
    byte_size: new TextEncoder().encode(jsonText).length,
    mime_type: "application/json",
    row_count: preview.rowCount,
    columns: preview.columns,
    numeric_columns: preview.numericColumns,
    sample_rows: preview.sampleRows,
    rows: preview.rows,
    preview_rows: preview.previewRows,
    json_text: preview.jsonText,
  };
  return {
    payload: {
      created_file: summarizeWorkspaceFiles([nextFile], { includeSamples: true })[0],
      row_count: resultRows.length,
    },
    file: nextFile,
  };
}

async function renderChartFromFileTool(
  args: RenderChartFromFileToolArgs,
  files: LocalWorkspaceFile[],
): Promise<{ payload: Record<string, unknown>; effect: ClientEffect }> {
  const file = findChartableFile(files, args.file_id);
  const rows = file.rows;
  if (!rows.length) {
    throw new Error(`File ${file.name} does not contain any rows to chart.`);
  }
  const chartPlan = {
    ...args.chart_plan,
    label_key: args.x_key,
    series:
      args.series_key && !args.y_key
        ? [{ label: args.series_key, data_key: args.series_key }]
        : args.y_key
          ? [{ label: args.y_key, data_key: args.y_key }]
          : args.chart_plan.series,
  };
  const imageDataUrl = await renderChartToDataUrl(chartPlan, rows);
  return {
    payload: {
      rows,
      row_count: rows.length,
      chart: chartPlan,
      file_id: args.file_id,
      chart_plan_id: args.chart_plan_id,
      imageDataUrl,
    },
    effect: {
      type: "chart_rendered",
      fileId: args.file_id,
      chartPlanId: args.chart_plan_id,
      chart: chartPlan,
      imageDataUrl: imageDataUrl ?? undefined,
      rows,
    },
  };
}

async function inspectPdfFileTool(
  args: InspectPdfFileToolArgs,
  files: LocalWorkspaceFile[],
): Promise<Record<string, unknown>> {
  const file = findWorkspaceFile(files, args.file_id);
  if (file.kind !== "pdf") {
    throw new Error(`File ${file.name} is not a PDF.`);
  }
  const inspection = await inspectPdfBytes(base64ToUint8Array(file.bytes_base64), {
    maxPages: args.max_pages,
  });
  return {
    file_id: file.id,
    page_count: inspection.pageCount,
    outline: inspection.outline,
    page_hints: inspection.pageHints.map((page) => ({
      page_number: page.pageNumber,
      title_candidate: page.titleCandidate,
      summary: page.summary,
    })),
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

async function smartSplitPdfTool(
  args: SmartSplitPdfToolArgs,
  files: LocalWorkspaceFile[],
): Promise<{ payload: Record<string, unknown>; files: LocalWorkspaceFile[]; effect: ClientEffect }> {
  const file = findWorkspaceFile(files, args.file_id);
  if (file.kind !== "pdf") {
    throw new Error(`File ${file.name} is not a PDF.`);
  }

  const result = await smartSplitPdfBytes(base64ToUint8Array(file.bytes_base64), {
    filename: file.name,
    goal: args.goal,
  });
  const createdFiles: LocalWorkspaceFile[] = [];
  const entries: SmartSplitEntry[] = [];

  for (const extracted of result.extractedFiles) {
    const nextFile: LocalPdfFile = {
      id: crypto.randomUUID(),
      name: extracted.filename,
      kind: "pdf",
      extension: "pdf",
      byte_size: Math.ceil((extracted.fileDataBase64.length * 3) / 4),
      mime_type: extracted.mimeType,
      page_count: extracted.pageRange.pageCount,
      bytes_base64: extracted.fileDataBase64,
    };
    createdFiles.push(nextFile);
    entries.push({
      fileId: nextFile.id,
      name: nextFile.name,
      title: extracted.title,
      startPage: extracted.pageRange.startPage,
      endPage: extracted.pageRange.endPage,
      pageCount: extracted.pageRange.pageCount,
    });
  }

  const indexFile: LocalOtherFile = {
    id: crypto.randomUUID(),
    name: "index.md",
    kind: "other",
    extension: "md",
    mime_type: "text/markdown",
    byte_size: new TextEncoder().encode(result.indexMarkdown).length,
    text_content: result.indexMarkdown,
  };
  const archiveFile: LocalOtherFile = {
    id: crypto.randomUUID(),
    name: result.archiveName,
    kind: "other",
    extension: "zip",
    mime_type: "application/zip",
    byte_size: Math.ceil((result.archiveBase64.length * 3) / 4),
    bytes_base64: result.archiveBase64,
  };
  createdFiles.push(indexFile, archiveFile);

  return {
    payload: {
      created_files: summarizeWorkspaceFiles(createdFiles),
      smart_split: {
        entries: entries.map((entry) => ({
          title: entry.title,
          start_page: entry.startPage,
          end_page: entry.endPage,
          page_count: entry.pageCount,
          file_id: entry.fileId,
          file_name: entry.name,
        })),
        archive_file: summarizeWorkspaceFiles([archiveFile])[0],
        index_file: summarizeWorkspaceFiles([indexFile])[0],
      },
    },
    files: createdFiles,
    effect: {
      type: "pdf_smart_split_completed",
      sourceFileId: file.id,
      sourceFileName: file.name,
      archiveFileId: archiveFile.id,
      archiveFileName: archiveFile.name,
      indexFileId: indexFile.id,
      indexFileName: indexFile.name,
      entries,
      markdown: result.indexMarkdown,
    },
  };
}

function buildToolDefinition(
  name: string,
  description: string,
  parameters: FunctionToolDefinition["parameters"],
): FunctionToolDefinition {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters,
  };
}

export const listWorkspaceFilesToolDefinition = buildToolDefinition(
  "list_workspace_files",
  "List the workspace files currently available on the client, including lightweight metadata and tiny familiarization samples when requested.",
  includeSamplesSchema,
);

export const listAttachedCsvFilesToolDefinition = buildToolDefinition(
  "list_attached_csv_files",
  "List the CSV files currently available on the client, including safe schema details, row counts, numeric columns, and tiny familiarization samples.",
  includeSamplesSchema,
);

export const runAggregateQueryToolDefinition = buildToolDefinition(
  "run_aggregate_query",
  "Execute a validated aggregate query plan against the client-side CSV rows and return grouped or summary results.",
  runAggregateQueryToolSchema,
);

export const createCsvFileToolDefinition = buildToolDefinition(
  "create_csv_file",
  "Run a validated query plan locally, materialize the result rows as a new CSV artifact, and add it to the workspace.",
  createCsvFileToolSchema,
);

export const createJsonFileToolDefinition = buildToolDefinition(
  "create_json_file",
  "Run a validated query plan locally, materialize the result rows as a JSON array-of-objects artifact, and add it to the workspace.",
  createJsonFileToolSchema,
);

export const listChartableFilesToolDefinition = buildToolDefinition(
  "list_chartable_files",
  "List chartable CSV and JSON artifacts available on the client, including schema hints and tiny samples when requested.",
  includeSamplesSchema,
);

export const inspectChartableFileSchemaToolDefinition = buildToolDefinition(
  "inspect_chartable_file_schema",
  "Inspect a CSV or JSON chartable artifact before building a chart plan.",
  inspectChartableFileSchemaToolSchema,
);

export const renderChartFromFileToolDefinition = buildToolDefinition(
  "render_chart_from_file",
  "Render a chart from a chartable CSV or JSON artifact after the chart has been planned.",
  renderChartFromFileToolSchema,
);

export const inspectPdfFileToolDefinition = buildToolDefinition(
  "inspect_pdf_file",
  "Inspect a PDF locally, returning page count, outline/bookmark hints, and page-level structure summaries.",
  inspectPdfFileToolSchema,
);

export const getPdfPageRangeToolDefinition = buildToolDefinition(
  "get_pdf_page_range",
  "Extract an inclusive page range from a PDF file, add the derived sub-PDF to the workspace, and return it as a file input payload.",
  getPdfPageRangeToolSchema,
);

export const smartSplitPdfToolDefinition = buildToolDefinition(
  "smart_split_pdf",
  "Inspect a PDF locally, propose a useful split, create titled sub-PDFs plus index.md, and add a ZIP archive to the workspace.",
  smartSplitPdfToolSchema,
);

export function createListWorkspaceFilesTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...listWorkspaceFilesToolDefinition,
    handler: (args) => listWorkspaceFilesTool(args as ListWorkspaceFilesToolArgs, workspace.files),
  };
}

export function createListAttachedCsvFilesTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...listAttachedCsvFilesToolDefinition,
    handler: (args) => listAttachedCsvFilesTool(args as ListLoadedDatasetsToolArgs, workspace.files),
  };
}

export function createRunAggregateQueryTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...runAggregateQueryToolDefinition,
    handler: (args) => runAggregateQueryTool(args as RunLocalQueryToolArgs, workspace.files),
  };
}

export function createCreateCsvFileTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...createCsvFileToolDefinition,
    handler: async (args, context) => {
      const result = await createCsvFileTool(args as CreateCsvFileToolArgs, workspace.files);
      context.appendFiles([result.file]);
      return result.payload;
    },
  };
}

export function createCreateJsonFileTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...createJsonFileToolDefinition,
    handler: async (args, context) => {
      const result = await createJsonFileTool(args as CreateJsonFileToolArgs, workspace.files);
      context.appendFiles([result.file]);
      return result.payload;
    },
  };
}

export function createListChartableFilesTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...listChartableFilesToolDefinition,
    handler: (args) => listChartableFilesTool(args as ListWorkspaceFilesToolArgs, workspace.files),
  };
}

export function createInspectChartableFileSchemaTool(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool {
  return {
    ...inspectChartableFileSchemaToolDefinition,
    handler: (args) =>
      inspectChartableFileSchemaTool(
        args as InspectChartableFileSchemaToolArgs,
        workspace.files,
      ),
  };
}

export function createRenderChartFromFileTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...renderChartFromFileToolDefinition,
    handler: async (args, context) => {
      const result = await renderChartFromFileTool(
        args as RenderChartFromFileToolArgs,
        workspace.files,
      );
      context.emitEffect(result.effect);
      return result.payload;
    },
  };
}

export function createInspectPdfFileTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...inspectPdfFileToolDefinition,
    handler: (args) => inspectPdfFileTool(args as InspectPdfFileToolArgs, workspace.files),
  };
}

export function createGetPdfPageRangeTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...getPdfPageRangeToolDefinition,
    handler: async (args, context) => {
      const result = await getPdfPageRangeTool(args as GetPdfPageRangeToolArgs, workspace.files);
      context.appendFiles([result.file]);
      return result.payload;
    },
  };
}

export function createSmartSplitPdfTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...smartSplitPdfToolDefinition,
    handler: async (args, context) => {
      const result = await smartSplitPdfTool(args as SmartSplitPdfToolArgs, workspace.files);
      context.appendFiles(result.files);
      context.emitEffect(result.effect);
      return result.payload;
    },
  };
}
