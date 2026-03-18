import { executeQueryPlan } from "./analysis";
import { parseCsvText } from "./csv";
import { parseJsonText } from "./json";
import {
  appendWorkspaceReportItems,
  buildArtifactTargetPath,
  buildWorkspaceBootstrapMetadata,
  effectsToReportItems,
  readWorkspaceAppState,
  readWorkspaceReport,
  readWorkspaceReportIndex,
  removeWorkspacePath,
  replaceWorkspaceReportItems,
  updateWorkspaceAppState,
  writeWorkspaceTextFile,
} from "./workspace-contract";
import {
  addWorkspaceFilesWithResult,
  ensureDirectoryPath,
  getDirectoryByPath,
  getWorkspaceContext,
  listDirectoryEntries,
  normalizeAbsolutePath,
  resolveWorkspacePath,
} from "./workspace-fs";
import { findWorkspaceFile, getFileExtension, rowsToCsv, rowsToJson, summarizeWorkspaceFiles } from "./workspace-files";
import {
  base64ToUint8Array,
  extractPdfPageRangeFromBytes,
  inspectPdfBytes,
  smartSplitPdfBytes,
} from "./pdf";
import type {
  AppendReportSectionToolArgs,
  ChangeWorkspaceDirectoryToolArgs,
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  CreateCsvFileToolArgs,
  CreateJsonFileToolArgs,
  CreateWorkspaceDirectoryToolArgs,
  DataRow,
  GetPdfPageRangeToolArgs,
  GetReportToolArgs,
  GetWorkspaceContextToolArgs,
  InspectChartableFileSchemaToolArgs,
  InspectPdfFileToolArgs,
  ListLoadedDatasetsToolArgs,
  ListWorkspaceFilesToolArgs,
  RenderChartFromFileToolArgs,
  RunLocalQueryToolArgs,
  SmartSplitPdfToolArgs,
} from "../types/analysis";
import type { LocalChartableFile, LocalDataset, LocalJsonFile, LocalPdfFile, LocalWorkspaceFile } from "../types/report";
import type { ToolExecutionRequestV1, ToolExecutionResultV1, VfsMutationV1, WorkspaceSnapshotV1 } from "../types/tool-runtime";
import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceFilesystem, WorkspaceItem } from "../types/workspace";
import type { ReportItemV1 } from "../types/workspace-contract";
import {
  WORKSPACE_DATA_ARTIFACTS_DIR,
  WORKSPACE_PDF_ARTIFACTS_DIR,
} from "../types/workspace-contract";

function summarizeDirectory(directory: WorkspaceDirectoryNode): Record<string, unknown> {
  return {
    id: directory.id,
    kind: "directory",
    name: directory.name || "/",
    path: directory.path,
  };
}

function listAllFileNodes(filesystem: WorkspaceFilesystem): WorkspaceFileNode[] {
  return filesystem.items.filter((item): item is WorkspaceFileNode => item.kind === "file");
}

function summarizeWorkspaceFileNode(
  fileNode: WorkspaceFileNode,
  includeSamples = true,
): Record<string, unknown> {
  return {
    ...summarizeWorkspaceFiles([fileNode.file], { includeSamples })[0],
    path: fileNode.path,
  };
}

function currentDirectoryNodes(snapshot: WorkspaceSnapshotV1): WorkspaceItem[] {
  return listDirectoryEntries(snapshot.filesystem, snapshot.cwd_path);
}

function currentDirectoryFileNodes(snapshot: WorkspaceSnapshotV1): WorkspaceFileNode[] {
  return currentDirectoryNodes(snapshot).filter(
    (entry): entry is WorkspaceFileNode => entry.kind === "file",
  );
}

function buildWorkspacePayload(
  snapshot: WorkspaceSnapshotV1,
  options: { includeSamples?: boolean } = {},
): Record<string, unknown> {
  const includeSamples = options.includeSamples ?? true;
  const fileNodes = currentDirectoryFileNodes(snapshot);
  const reportIndex = readWorkspaceReportIndex(snapshot.filesystem);
  return {
    cwd_path: snapshot.cwd_path,
    workspace_context: snapshot.workspace_context,
    directories: currentDirectoryNodes(snapshot)
      .filter((entry): entry is WorkspaceDirectoryNode => entry.kind === "directory")
      .map(summarizeDirectory),
    files: listAllFileNodes(snapshot.filesystem).map((fileNode) =>
      summarizeWorkspaceFileNode(fileNode, includeSamples),
    ),
    cwd_files: fileNodes.map((fileNode) => summarizeWorkspaceFileNode(fileNode, includeSamples)),
    reports:
      reportIndex?.report_ids.map((reportId) => {
        const report = readWorkspaceReport(snapshot.filesystem, reportId);
        return {
          report_id: reportId,
          title: report?.title ?? reportId,
          item_count: report?.items.length ?? 0,
          updated_at: report?.updated_at ?? null,
        };
      }) ?? [],
    current_report_id: reportIndex?.current_report_id ?? null,
    agents_file: snapshot.bootstrap.agents_file,
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
    throw new Error(`File ${file.name} is not a chartable artifact.`);
  }
  return file;
}

function createSnapshot(
  filesystem: WorkspaceFilesystem,
  cwdPath: string,
): WorkspaceSnapshotV1 {
  return {
    version: "v1",
    filesystem,
    cwd_path: cwdPath,
    workspace_context: getWorkspaceContext(filesystem, cwdPath),
    bootstrap: buildWorkspaceBootstrapMetadata(filesystem),
  };
}

export function applyVfsMutations(
  snapshot: WorkspaceSnapshotV1,
  mutations: VfsMutationV1[],
): WorkspaceSnapshotV1 {
  let filesystem = snapshot.filesystem;
  let cwdPath = snapshot.cwd_path;

  for (const mutation of mutations) {
    switch (mutation.type) {
      case "mkdir":
        filesystem = ensureDirectoryPath(filesystem, mutation.path).filesystem;
        break;
      case "write_text_file":
        filesystem = writeWorkspaceTextFile(
          filesystem,
          mutation.path,
          mutation.text,
          mutation.source,
        );
        break;
      case "delete_path":
        filesystem = removeWorkspacePath(filesystem, mutation.path);
        break;
      case "append_workspace_files":
        filesystem = addWorkspaceFilesWithResult(
          filesystem,
          mutation.directory_path,
          mutation.files,
          mutation.source,
        ).filesystem;
        break;
      case "replace_report_items":
        filesystem = replaceWorkspaceReportItems(
          filesystem,
          mutation.report_id,
          mutation.items,
        );
        break;
      case "append_report_items":
        filesystem = appendWorkspaceReportItems(
          filesystem,
          mutation.report_id,
          mutation.items,
        );
        break;
      case "update_app_state":
        filesystem = updateWorkspaceAppState(filesystem, mutation.patch as never);
        break;
      case "change_directory":
        cwdPath = getDirectoryByPath(
          filesystem,
          resolveWorkspacePath(mutation.path, cwdPath),
        ).path;
        break;
      case "render_chart_artifact":
        break;
    }
  }

  return createSnapshot(filesystem, cwdPath);
}

function ensureCsvFilename(filename: string): string {
  const trimmed = filename.trim() || "derived.csv";
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}

function ensureJsonFilename(filename: string): string {
  const trimmed = filename.trim() || "derived.json";
  return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
}

function buildCreatedFilePayload(
  snapshot: WorkspaceSnapshotV1,
  file: LocalWorkspaceFile,
): Record<string, unknown> {
  const node =
    listAllFileNodes(snapshot.filesystem).find((candidate) => candidate.file.id === file.id) ??
    null;
  return node
    ? summarizeWorkspaceFileNode(node, true)
    : summarizeWorkspaceFiles([file], { includeSamples: true })[0];
}

async function executeTool<Name extends ClientToolName>(
  toolCall: ClientToolCall<Name>,
  snapshot: WorkspaceSnapshotV1,
): Promise<Omit<ToolExecutionResultV1, "version" | "request_id" | "tool_name">> {
  const allFiles = listAllFileNodes(snapshot.filesystem).map((node) => node.file);

  switch (toolCall.name) {
    case "get_workspace_context": {
      void (toolCall.arguments as GetWorkspaceContextToolArgs);
      return {
        payload: buildWorkspacePayload(snapshot, { includeSamples: true }),
        mutations: [],
        effects: [],
        warnings: [],
      };
    }
    case "create_workspace_directory": {
      const args = toolCall.arguments as CreateWorkspaceDirectoryToolArgs;
      const targetPath = resolveWorkspacePath(args.path, snapshot.cwd_path);
      const mutations: VfsMutationV1[] = [{ type: "mkdir", path: targetPath }];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          ...buildWorkspacePayload(nextSnapshot, { includeSamples: false }),
          created_directory: { path: targetPath },
          workspace_operation: {
            kind: "create_directory",
            target_path: targetPath,
            cwd_path: nextSnapshot.cwd_path,
          },
        },
        mutations,
        effects: [],
        warnings: [],
      };
    }
    case "change_workspace_directory": {
      const args = toolCall.arguments as ChangeWorkspaceDirectoryToolArgs;
      const targetPath = resolveWorkspacePath(args.path, snapshot.cwd_path);
      const mutations: VfsMutationV1[] = [{ type: "change_directory", path: targetPath }];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          ...buildWorkspacePayload(nextSnapshot, { includeSamples: true }),
          changed_directory: { path: nextSnapshot.cwd_path },
          workspace_operation: {
            kind: "change_directory",
            target_path: nextSnapshot.cwd_path,
            cwd_path: nextSnapshot.cwd_path,
          },
        },
        mutations,
        effects: [],
        warnings: [],
      };
    }
    case "list_workspace_files": {
      const args = toolCall.arguments as ListWorkspaceFilesToolArgs;
      return {
        payload: buildWorkspacePayload(snapshot, { includeSamples: args.includeSamples }),
        mutations: [],
        effects: [],
        warnings: [],
      };
    }
    case "list_attached_csv_files": {
      const args = toolCall.arguments as ListLoadedDatasetsToolArgs;
      const includeSamples = args.includeSamples ?? true;
      const csvFiles = currentDirectoryFileNodes(snapshot).filter((entry) => entry.file.kind === "csv");
      return {
        payload: {
          cwd_path: snapshot.cwd_path,
          workspace_context: snapshot.workspace_context,
          csv_files: csvFiles.map((fileNode) =>
            summarizeWorkspaceFileNode(fileNode, includeSamples),
          ),
          files: listAllFileNodes(snapshot.filesystem).map((fileNode) =>
            summarizeWorkspaceFileNode(fileNode, includeSamples),
          ),
        },
        mutations: [],
        effects: [],
        warnings: [],
      };
    }
    case "list_chartable_files": {
      const args = toolCall.arguments as ListLoadedDatasetsToolArgs;
      const includeSamples = args.includeSamples ?? true;
      const chartableFiles = currentDirectoryFileNodes(snapshot).filter(
        (entry) => entry.file.kind === "csv" || entry.file.kind === "json",
      );
      return {
        payload: {
          cwd_path: snapshot.cwd_path,
          workspace_context: snapshot.workspace_context,
          chartable_files: chartableFiles.map((fileNode) =>
            summarizeWorkspaceFileNode(fileNode, includeSamples),
          ),
          files: listAllFileNodes(snapshot.filesystem).map((fileNode) =>
            summarizeWorkspaceFileNode(fileNode, includeSamples),
          ),
        },
        mutations: [],
        effects: [],
        warnings: [],
      };
    }
    case "inspect_chartable_file_schema": {
      const args = toolCall.arguments as InspectChartableFileSchemaToolArgs;
      const file = findChartableFile(allFiles, args.file_id);
      return {
        payload: {
          file_id: file.id,
          kind: file.kind,
          row_count: file.row_count,
          columns: file.columns,
          numeric_columns: file.numeric_columns,
          sample_rows: file.sample_rows,
        },
        mutations: [],
        effects: [],
        warnings: [],
      };
    }
    case "run_aggregate_query": {
      const args = toolCall.arguments as RunLocalQueryToolArgs;
      const dataset = findDataset(allFiles, args.query_plan.dataset_id);
      const rows = (dataset.rows as DataRow[]) ?? dataset.sample_rows;
      const resultRows = executeQueryPlan(rows, args.query_plan).rows;
      return {
        payload: {
          rows: resultRows,
          row_count: resultRows.length,
        },
        mutations: [],
        effects: [],
        warnings: [],
      };
    }
    case "create_csv_file": {
      const args = toolCall.arguments as CreateCsvFileToolArgs;
      const dataset = findDataset(allFiles, args.query_plan.dataset_id);
      const resultRows = executeQueryPlan(dataset.rows as DataRow[], args.query_plan).rows;
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
      const mutations: VfsMutationV1[] = [
        {
          type: "append_workspace_files",
          directory_path: WORKSPACE_DATA_ARTIFACTS_DIR,
          files: [nextFile],
          source: "derived",
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          ...buildWorkspacePayload(nextSnapshot, { includeSamples: true }),
          created_file: buildCreatedFilePayload(nextSnapshot, nextFile),
          row_count: nextFile.row_count,
        },
        mutations,
        effects: [],
        warnings: [],
      };
    }
    case "create_json_file": {
      const args = toolCall.arguments as CreateJsonFileToolArgs;
      const dataset = findDataset(allFiles, args.query_plan.dataset_id);
      const resultRows = executeQueryPlan(dataset.rows as DataRow[], args.query_plan).rows;
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
      const mutations: VfsMutationV1[] = [
        {
          type: "append_workspace_files",
          directory_path: WORKSPACE_DATA_ARTIFACTS_DIR,
          files: [nextFile],
          source: "derived",
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          ...buildWorkspacePayload(nextSnapshot, { includeSamples: true }),
          created_file: buildCreatedFilePayload(nextSnapshot, nextFile),
          row_count: nextFile.row_count,
        },
        mutations,
        effects: [],
        warnings: [],
      };
    }
    case "render_chart_from_file": {
      const args = toolCall.arguments as RenderChartFromFileToolArgs;
      const file = findChartableFile(allFiles, args.file_id);
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
      const artifactPath = buildArtifactTargetPath(
        "chart",
        `${args.chart_plan_id}.json`,
      );
      const mutations: VfsMutationV1[] = [
        {
          type: "render_chart_artifact",
          chart_plan_id: args.chart_plan_id,
          file_id: args.file_id,
          title: chartPlan.title,
          chart: chartPlan as Record<string, unknown>,
          artifact_path: artifactPath,
        },
      ];
      return {
        payload: {
          rows: file.rows,
          row_count: file.rows.length,
          chart: chartPlan,
          file_id: args.file_id,
          chart_plan_id: args.chart_plan_id,
          imageDataUrl: null,
          workspace_context: snapshot.workspace_context,
        },
        mutations,
        effects: [],
        warnings: [],
      };
    }
    case "inspect_pdf_file": {
      const args = toolCall.arguments as InspectPdfFileToolArgs;
      const file = findWorkspaceFile(allFiles, args.file_id);
      if (file.kind !== "pdf") {
        throw new Error(`File ${file.name} is not a PDF.`);
      }
      const inspection = await inspectPdfBytes(base64ToUint8Array(file.bytes_base64), {
        maxPages: args.max_pages,
      });
      return {
        payload: {
          file_id: file.id,
          page_count: inspection.pageCount,
          outline: inspection.outline,
          page_hints: inspection.pageHints.map((page) => ({
            page_number: page.pageNumber,
            title_candidate: page.titleCandidate,
            summary: page.summary,
          })),
        },
        mutations: [],
        effects: [],
        warnings: [],
      };
    }
    case "get_pdf_page_range": {
      const args = toolCall.arguments as GetPdfPageRangeToolArgs;
      const file = findWorkspaceFile(allFiles, args.file_id);
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
      const mutations: VfsMutationV1[] = [
        {
          type: "append_workspace_files",
          directory_path: WORKSPACE_PDF_ARTIFACTS_DIR,
          files: [nextFile],
          source: "derived",
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          ...buildWorkspacePayload(nextSnapshot, { includeSamples: true }),
          created_file: buildCreatedFilePayload(nextSnapshot, nextFile),
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
        mutations,
        effects: [],
        warnings: [],
      };
    }
    case "smart_split_pdf": {
      const args = toolCall.arguments as SmartSplitPdfToolArgs;
      const file = findWorkspaceFile(allFiles, args.file_id);
      if (file.kind !== "pdf") {
        throw new Error(`File ${file.name} is not a PDF.`);
      }
      const result = await smartSplitPdfBytes(base64ToUint8Array(file.bytes_base64), {
        filename: file.name,
        goal: args.goal,
      });
      const createdFiles: LocalWorkspaceFile[] = result.extractedFiles.map((extracted) => ({
        id: crypto.randomUUID(),
        name: extracted.filename,
        kind: "pdf",
        extension: "pdf",
        byte_size: Math.ceil((extracted.fileDataBase64.length * 3) / 4),
        mime_type: extracted.mimeType,
        page_count: extracted.pageRange.pageCount,
        bytes_base64: extracted.fileDataBase64,
      }));
      const indexFile: LocalWorkspaceFile = {
        id: crypto.randomUUID(),
        name: "index.md",
        kind: "other",
        extension: "md",
        mime_type: "text/markdown",
        byte_size: new TextEncoder().encode(result.indexMarkdown).length,
        text_content: result.indexMarkdown,
      };
      const archiveFile: LocalWorkspaceFile = {
        id: crypto.randomUUID(),
        name: result.archiveName,
        kind: "other",
        extension: "zip",
        mime_type: "application/zip",
        byte_size: Math.ceil((result.archiveBase64.length * 3) / 4),
        bytes_base64: result.archiveBase64,
      };
      const allCreatedFiles = [...createdFiles, indexFile, archiveFile];
      const effect: ClientEffect = {
        type: "pdf_smart_split_completed",
        sourceFileId: file.id,
        sourceFileName: file.name,
        archiveFileId: archiveFile.id,
        archiveFileName: archiveFile.name,
        indexFileId: indexFile.id,
        indexFileName: indexFile.name,
        entries: createdFiles.map((createdFile, index) => ({
          fileId: createdFile.id,
          name: createdFile.name,
          title: result.extractedFiles[index].title,
          startPage: result.extractedFiles[index].pageRange.startPage,
          endPage: result.extractedFiles[index].pageRange.endPage,
          pageCount: result.extractedFiles[index].pageRange.pageCount,
        })),
        markdown: result.indexMarkdown,
      };
      const mutations: VfsMutationV1[] = [
        {
          type: "append_workspace_files",
          directory_path: WORKSPACE_PDF_ARTIFACTS_DIR,
          files: allCreatedFiles,
          source: "derived",
        },
        {
          type: "append_report_items",
          report_id:
            readWorkspaceAppState(snapshot.filesystem)?.current_report_id ??
            readWorkspaceReportIndex(snapshot.filesystem)?.current_report_id ??
            "report-1",
          items: effectsToReportItems([effect]),
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          ...buildWorkspacePayload(nextSnapshot, { includeSamples: true }),
          created_files: allCreatedFiles.map((createdFile) =>
            buildCreatedFilePayload(nextSnapshot, createdFile),
          ),
          smart_split: {
            entries: effect.entries.map((entry) => ({
              title: entry.title,
              start_page: entry.startPage,
              end_page: entry.endPage,
              page_count: entry.pageCount,
              file_id: entry.fileId,
              file_name: entry.name,
            })),
            archive_file: buildCreatedFilePayload(nextSnapshot, archiveFile),
            index_file: buildCreatedFilePayload(nextSnapshot, indexFile),
          },
        },
        mutations,
        effects: [effect],
        warnings: [],
      };
    }
    case "list_reports": {
      const reportIndex = readWorkspaceReportIndex(snapshot.filesystem);
      return {
        payload: {
          reports:
            reportIndex?.report_ids.map((reportId) => {
              const report = readWorkspaceReport(snapshot.filesystem, reportId);
              return {
                report_id: reportId,
                title: report?.title ?? reportId,
                item_count: report?.items.length ?? 0,
                updated_at: report?.updated_at ?? null,
              };
            }) ?? [],
          current_report_id: reportIndex?.current_report_id ?? null,
        },
        mutations: [],
        effects: [],
        warnings: [],
      };
    }
    case "get_report": {
      const args = toolCall.arguments as GetReportToolArgs;
      const report = readWorkspaceReport(snapshot.filesystem, args.report_id);
      if (!report) {
        throw new Error(`Unknown report: ${args.report_id}`);
      }
      return {
        payload: {
          report,
        },
        mutations: [],
        effects: [],
        warnings: [],
      };
    }
    case "append_report_section": {
      const args = toolCall.arguments as AppendReportSectionToolArgs;
      const item: ReportItemV1 = {
        id: crypto.randomUUID(),
        type: "section",
        created_at: new Date().toISOString(),
        title: args.title,
        markdown: args.markdown,
      };
      const effect: ClientEffect = {
        type: "report_section_appended",
        title: args.title,
        markdown: args.markdown,
      };
      const mutations: VfsMutationV1[] = [
        {
          type: "append_report_items",
          report_id: args.report_id,
          items: [item],
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          report_id: args.report_id,
          title: args.title,
          markdown: args.markdown,
          reports: buildWorkspacePayload(nextSnapshot).reports,
        },
        mutations,
        effects: [effect],
        warnings: [],
      };
    }
  }
}

export async function executeToolRequest(
  request: ToolExecutionRequestV1,
): Promise<ToolExecutionResultV1> {
  const toolCall: ClientToolCall = {
    name: request.tool_name,
    arguments: request.arguments,
  };
  const result = await executeTool(toolCall, request.snapshot);
  return {
    version: "v1",
    request_id: request.request_id,
    tool_name: request.tool_name,
    payload: result.payload,
    mutations: result.mutations,
    effects: result.effects,
    warnings: result.warnings,
  };
}
