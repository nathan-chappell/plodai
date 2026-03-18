import { executeToolWithBroker } from "../../lib/client-tool-broker";
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
  changeWorkspaceDirectoryToolSchema,
  buildAppendReportSectionToolSchema,
  buildGetReportToolSchema,
  createCsvFileToolSchema,
  createJsonFileToolSchema,
  createWorkspaceDirectoryToolSchema,
  getPdfPageRangeToolSchema,
  getWorkspaceContextToolSchema,
  includeSamplesSchema,
  inspectChartableFileSchemaToolSchema,
  inspectPdfFileToolSchema,
  listReportsToolSchema,
  renderChartFromFileToolSchema,
  runAggregateQueryToolSchema,
  smartSplitPdfToolSchema,
} from "../../lib/tool-schemas";
import { readWorkspaceReportIndex } from "../../lib/workspace-contract";
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
  ChangeWorkspaceDirectoryToolArgs,
  ClientEffect,
  CreateCsvFileToolArgs,
  CreateJsonFileToolArgs,
  CreateWorkspaceDirectoryToolArgs,
  DataRow,
  GetPdfPageRangeToolArgs,
  GetWorkspaceContextToolArgs,
  InspectChartableFileSchemaToolArgs,
  InspectPdfFileToolArgs,
  ListLoadedDatasetsToolArgs,
  ListWorkspaceFilesToolArgs,
  PdfSmartSplitEffect,
  RenderChartFromFileToolArgs,
  RunLocalQueryToolArgs,
  SmartSplitEntry,
  SmartSplitPdfToolArgs,
  ListReportsToolArgs,
  GetReportToolArgs,
  AppendReportSectionToolArgs,
  ClientToolArgsMap,
  ClientToolName,
} from "../../types/analysis";
import type {
  LocalChartableFile,
  LocalDataset,
  LocalJsonFile,
  LocalOtherFile,
  LocalPdfFile,
  LocalWorkspaceFile,
} from "../../types/report";
import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceItem } from "../../types/workspace";

function readWorkspaceState(workspace: CapabilityWorkspaceContext) {
  return workspace.getState();
}

function currentDirectoryFileNodes(workspace: CapabilityWorkspaceContext): WorkspaceFileNode[] {
  return readWorkspaceState(workspace).entries.filter((entry): entry is WorkspaceFileNode => entry.kind === "file");
}

function currentDirectoryNodes(workspace: CapabilityWorkspaceContext): WorkspaceItem[] {
  return readWorkspaceState(workspace).entries;
}

function summarizeWorkspaceFileNode(
  fileNode: WorkspaceFileNode,
  options: { includeSamples?: boolean } = {},
): Record<string, unknown> {
  return {
    ...summarizeWorkspaceFiles([fileNode.file], { includeSamples: options.includeSamples })[0],
    path: fileNode.path,
  };
}

function summarizeCsvFileNode(
  fileNode: WorkspaceFileNode,
  includeSamples: boolean,
): Record<string, unknown> {
  const file = fileNode.file;
  if (file.kind !== "csv") {
    throw new Error(`File ${file.name} is not a CSV dataset.`);
  }
  return {
    id: file.id,
    name: file.name,
    path: fileNode.path,
    row_count: file.row_count,
    columns: file.columns,
    numeric_columns: file.numeric_columns,
    sample_rows: includeSamples ? file.sample_rows : [],
  };
}

function summarizeChartableFileNode(
  fileNode: WorkspaceFileNode,
  includeSamples: boolean,
): Record<string, unknown> {
  const file = fileNode.file;
  if (file.kind !== "csv" && file.kind !== "json") {
    throw new Error(`File ${file.name} is not chartable.`);
  }
  return {
    id: file.id,
    name: file.name,
    path: fileNode.path,
    kind: file.kind,
    extension: file.extension,
    row_count: file.row_count,
    columns: file.columns,
    numeric_columns: file.numeric_columns,
    sample_rows: includeSamples ? file.sample_rows : [],
  };
}

function summarizeDirectory(directory: WorkspaceDirectoryNode): Record<string, unknown> {
  return {
    id: directory.id,
    name: directory.name || "/",
    kind: "directory",
    path: directory.path,
  };
}

function buildWorkspaceSnapshotPayload(
  workspace: CapabilityWorkspaceContext,
  options: { includeSamples?: boolean } = {},
): Record<string, unknown> {
  const state = readWorkspaceState(workspace);
  const includeSamples = options.includeSamples ?? true;
  const fileNodes = state.entries.filter((entry): entry is WorkspaceFileNode => entry.kind === "file");
  const csvFileNodes = fileNodes.filter((entry) => entry.file.kind === "csv");
  const chartableFileNodes = fileNodes.filter(
    (entry) => entry.file.kind === "csv" || entry.file.kind === "json",
  );
  return {
    cwd_path: state.cwdPath,
    workspace_context: state.workspaceContext,
    directories: state.entries
      .filter((entry): entry is WorkspaceDirectoryNode => entry.kind === "directory")
      .map(summarizeDirectory),
    files: fileNodes.map((fileNode) => summarizeWorkspaceFileNode(fileNode, { includeSamples })),
    csv_files: csvFileNodes.map((fileNode) => summarizeCsvFileNode(fileNode, includeSamples)),
    chartable_files: chartableFileNodes.map((fileNode) => summarizeChartableFileNode(fileNode, includeSamples)),
  };
}

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

async function getWorkspaceContextTool(
  _args: GetWorkspaceContextToolArgs,
  workspace: CapabilityWorkspaceContext,
): Promise<Record<string, unknown>> {
  return buildWorkspaceSnapshotPayload(workspace, { includeSamples: true });
}

async function createWorkspaceDirectoryTool(
  args: CreateWorkspaceDirectoryToolArgs,
  workspace: CapabilityWorkspaceContext,
): Promise<Record<string, unknown>> {
  const createdPath = workspace.createDirectory(args.path);
  const state = readWorkspaceState(workspace);
  const createdDirectory = currentDirectoryNodes(workspace).find(
    (entry): entry is WorkspaceDirectoryNode => entry.kind === "directory" && entry.path === createdPath,
  );
  return {
    ...buildWorkspaceSnapshotPayload(workspace, { includeSamples: false }),
    created_directory: createdDirectory ? summarizeDirectory(createdDirectory) : { path: createdPath },
    workspace_operation: {
      kind: "create_directory",
      target_path: createdPath,
      cwd_path: state.cwdPath,
    },
  };
}

async function changeWorkspaceDirectoryTool(
  args: ChangeWorkspaceDirectoryToolArgs,
  workspace: CapabilityWorkspaceContext,
): Promise<Record<string, unknown>> {
  const cwdPath = workspace.changeDirectory(args.path);
  return {
    ...buildWorkspaceSnapshotPayload(workspace, { includeSamples: true }),
    changed_directory: { path: cwdPath },
    workspace_operation: {
      kind: "change_directory",
      target_path: cwdPath,
      cwd_path: cwdPath,
    },
  };
}

async function listWorkspaceFilesTool(
  args: ListWorkspaceFilesToolArgs,
  workspace: CapabilityWorkspaceContext,
): Promise<Record<string, unknown>> {
  return buildWorkspaceSnapshotPayload(workspace, { includeSamples: args.includeSamples });
}

async function listAttachedCsvFilesTool(
  args: ListLoadedDatasetsToolArgs,
  workspace: CapabilityWorkspaceContext,
): Promise<Record<string, unknown>> {
  const includeSamples = args.includeSamples ?? true;
  const csvFiles = currentDirectoryFileNodes(workspace).filter((entry) => entry.file.kind === "csv");
  return {
    cwd_path: readWorkspaceState(workspace).cwdPath,
    workspace_context: readWorkspaceState(workspace).workspaceContext,
    csv_files: csvFiles.map((fileNode) => summarizeCsvFileNode(fileNode, includeSamples)),
    files: csvFiles.map((fileNode) => summarizeWorkspaceFileNode(fileNode, { includeSamples })),
  };
}

async function listChartableFilesTool(
  args: ListWorkspaceFilesToolArgs,
  workspace: CapabilityWorkspaceContext,
): Promise<Record<string, unknown>> {
  const includeSamples = args.includeSamples ?? true;
  const fileNodes = currentDirectoryFileNodes(workspace).filter(
    (entry) => entry.file.kind === "csv" || entry.file.kind === "json",
  );
  return {
    cwd_path: readWorkspaceState(workspace).cwdPath,
    workspace_context: readWorkspaceState(workspace).workspaceContext,
    chartable_files: fileNodes.map((fileNode) => summarizeChartableFileNode(fileNode, includeSamples)),
    files: fileNodes.map((fileNode) => summarizeWorkspaceFileNode(fileNode, { includeSamples })),
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
): Promise<LocalDataset> {
  const dataset = findDataset(files, args.query_plan.dataset_id);
  const rows = (dataset.rows as DataRow[]) ?? dataset.sample_rows;
  const resultRows = await executeQueryPlanInWorker(rows, args.query_plan);
  const csvText = rowsToCsv(resultRows);
  const preview = parseCsvText(csvText);
  const filename = ensureCsvFilename(args.filename);
  return {
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
}

async function createJsonFileTool(
  args: CreateJsonFileToolArgs,
  files: LocalWorkspaceFile[],
): Promise<LocalJsonFile> {
  const dataset = findDataset(files, args.query_plan.dataset_id);
  const rows = (dataset.rows as DataRow[]) ?? dataset.sample_rows;
  const resultRows = await executeQueryPlanInWorker(rows, args.query_plan);
  const jsonText = rowsToJson(resultRows);
  const preview = parseJsonText(jsonText);
  const filename = ensureJsonFilename(args.filename);
  return {
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
): Promise<{ files: LocalWorkspaceFile[]; effect: PdfSmartSplitEffect }> {
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

export const getWorkspaceContextToolDefinition = buildToolDefinition(
  "get_workspace_context",
  "Describe the current working directory, its entries, and the workspace references visible from the current surface.",
  getWorkspaceContextToolSchema,
);

export const createWorkspaceDirectoryToolDefinition = buildToolDefinition(
  "create_workspace_directory",
  "Create a workspace directory using a relative or absolute path without changing the current directory.",
  createWorkspaceDirectoryToolSchema,
);

export const changeWorkspaceDirectoryToolDefinition = buildToolDefinition(
  "change_workspace_directory",
  "Change the current working directory using a relative or absolute path.",
  changeWorkspaceDirectoryToolSchema,
);

export const listWorkspaceFilesToolDefinition = buildToolDefinition(
  "list_workspace_files",
  "List the current-directory workspace files available on the client, including lightweight metadata and tiny familiarization samples when requested.",
  includeSamplesSchema,
);

export const listAttachedCsvFilesToolDefinition = buildToolDefinition(
  "list_attached_csv_files",
  "List the current-directory CSV files available on the client, including safe schema details, row counts, numeric columns, and tiny familiarization samples.",
  includeSamplesSchema,
);

export const runAggregateQueryToolDefinition = buildToolDefinition(
  "run_aggregate_query",
  "Execute a validated aggregate query plan against the client-side CSV rows and return grouped or summary results.",
  runAggregateQueryToolSchema,
);

export const createCsvFileToolDefinition = buildToolDefinition(
  "create_csv_file",
  "Run a validated query plan locally, materialize the result rows as a new CSV artifact, and add it to the current workspace directory.",
  createCsvFileToolSchema,
);

export const createJsonFileToolDefinition = buildToolDefinition(
  "create_json_file",
  "Run a validated query plan locally, materialize the result rows as a JSON array-of-objects artifact, and add it to the current workspace directory.",
  createJsonFileToolSchema,
);

export const listChartableFilesToolDefinition = buildToolDefinition(
  "list_chartable_files",
  "List current-directory chartable CSV and JSON artifacts available on the client, including schema hints and tiny samples when requested.",
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
  "Extract an inclusive page range from a PDF file, add the derived sub-PDF to the current workspace directory, and return it as a file input payload.",
  getPdfPageRangeToolSchema,
);

export const smartSplitPdfToolDefinition = buildToolDefinition(
  "smart_split_pdf",
  "Inspect a PDF locally, propose a useful split, create titled sub-PDFs plus index.md, and add a ZIP archive to the current workspace directory.",
  smartSplitPdfToolSchema,
);

export const listReportsToolDefinition = buildToolDefinition(
  "list_reports",
  "List structured reports stored in the workspace VFS.",
  listReportsToolSchema,
);

export function buildGetReportToolDefinition(
  reportIds: readonly string[],
): FunctionToolDefinition {
  return buildToolDefinition(
    "get_report",
    "Read a structured report document from the workspace VFS.",
    buildGetReportToolSchema(reportIds),
  );
}

export function buildAppendReportSectionToolDefinition(
  reportIds: readonly string[],
): FunctionToolDefinition {
  return buildToolDefinition(
    "append_report_section",
    "Append a narrative section to a structured report stored in the workspace VFS.",
    buildAppendReportSectionToolSchema(reportIds),
  );
}

function reportIdsForWorkspace(workspace: CapabilityWorkspaceContext): string[] {
  const index = readWorkspaceReportIndex(readWorkspaceState(workspace).filesystem);
  if (!index?.report_ids.length) {
    return ["report-1"];
  }
  return index.report_ids;
}

async function invokeBrokeredTool<Name extends ClientToolName>(
  workspace: CapabilityWorkspaceContext,
  toolName: Name,
  args: ClientToolArgsMap[Name],
  context: { emitEffects: (effects: ClientEffect[]) => void },
): Promise<Record<string, unknown>> {
  const result = await executeToolWithBroker(workspace, toolName, args);
  if (result.effects.length) {
    context.emitEffects(result.effects);
  }
  return result.payload;
}

export function createGetWorkspaceContextTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...getWorkspaceContextToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "get_workspace_context", args as GetWorkspaceContextToolArgs, context),
  };
}

export function createCreateWorkspaceDirectoryTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...createWorkspaceDirectoryToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "create_workspace_directory", args as CreateWorkspaceDirectoryToolArgs, context),
  };
}

export function createChangeWorkspaceDirectoryTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...changeWorkspaceDirectoryToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "change_workspace_directory", args as ChangeWorkspaceDirectoryToolArgs, context),
  };
}

export function createListWorkspaceFilesTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...listWorkspaceFilesToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "list_workspace_files", args as ListWorkspaceFilesToolArgs, context),
  };
}

export function createListAttachedCsvFilesTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...listAttachedCsvFilesToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "list_attached_csv_files", args as ListLoadedDatasetsToolArgs, context),
  };
}

export function createRunAggregateQueryTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...runAggregateQueryToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "run_aggregate_query", args as RunLocalQueryToolArgs, context),
  };
}

export function createCreateCsvFileTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...createCsvFileToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "create_csv_file", args as CreateCsvFileToolArgs, context),
  };
}

export function createCreateJsonFileTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...createJsonFileToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "create_json_file", args as CreateJsonFileToolArgs, context),
  };
}

export function createListChartableFilesTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...listChartableFilesToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "list_chartable_files", args as ListWorkspaceFilesToolArgs, context),
  };
}

export function createInspectChartableFileSchemaTool(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool {
  return {
    ...inspectChartableFileSchemaToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(
        workspace,
        "inspect_chartable_file_schema",
        args as InspectChartableFileSchemaToolArgs,
        context,
      ),
  };
}

export function createRenderChartFromFileTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...renderChartFromFileToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "render_chart_from_file", args as RenderChartFromFileToolArgs, context),
  };
}

export function createInspectPdfFileTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...inspectPdfFileToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "inspect_pdf_file", args as InspectPdfFileToolArgs, context),
  };
}

export function createGetPdfPageRangeTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...getPdfPageRangeToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "get_pdf_page_range", args as GetPdfPageRangeToolArgs, context),
  };
}

export function createSmartSplitPdfTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...smartSplitPdfToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "smart_split_pdf", args as SmartSplitPdfToolArgs, context),
  };
}

export function createListReportsTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...listReportsToolDefinition,
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "list_reports", args as ListReportsToolArgs, context),
  };
}

export function createGetReportTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...buildGetReportToolDefinition(reportIdsForWorkspace(workspace)),
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "get_report", args as GetReportToolArgs, context),
  };
}

export function createAppendReportSectionTool(workspace: CapabilityWorkspaceContext): CapabilityClientTool {
  return {
    ...buildAppendReportSectionToolDefinition(reportIdsForWorkspace(workspace)),
    handler: (args, context) =>
      invokeBrokeredTool(workspace, "append_report_section", args as AppendReportSectionToolArgs, context),
  };
}
