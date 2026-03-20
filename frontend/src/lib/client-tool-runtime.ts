import { executeQueryPlan } from "./analysis";
import { parseCsvText } from "./csv";
import { parseJsonText } from "./json";
import {
  appendWorkspaceReportSlides,
  buildArtifactTargetPath,
  buildWorkspaceBootstrapMetadata,
  createWorkspaceReport,
  readWorkspaceAppState,
  readWorkspaceReport,
  readWorkspaceReportIndex,
  removeWorkspacePath,
  replaceWorkspaceReportSlides,
  updateWorkspaceAppState,
  writeWorkspaceIndex,
  writeWorkspaceReport,
  writeWorkspaceReportIndex,
  writeWorkspaceTextFile,
} from "./workspace-contract";
import {
  addWorkspaceFilesAtPathsWithResult,
  findWorkspaceFileNodeByPath,
  getWorkspaceContext,
  listDirectoryEntries,
  normalizeAbsolutePath,
  normalizePathPrefix,
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
  AppendReportSlideToolArgs,
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  CreateReportToolArgs,
  CreateCsvFileToolArgs,
  CreateJsonFileToolArgs,
  DataRow,
  GetPdfPageRangeToolArgs,
  GetReportToolArgs,
  InspectChartableFileSchemaToolArgs,
  InspectPdfFileToolArgs,
  ListLoadedDatasetsToolArgs,
  ListWorkspaceFilesToolArgs,
  RemoveReportSlideToolArgs,
  RenderChartFromFileToolArgs,
  RunLocalQueryToolArgs,
  SmartSplitPdfToolArgs,
} from "../types/analysis";
import type { LocalChartableFile, LocalDataset, LocalJsonFile, LocalPdfFile, LocalWorkspaceFile } from "../types/report";
import type { ToolExecutionRequestV1, ToolExecutionResultV1, VfsMutationV1, WorkspaceSnapshotV1 } from "../types/tool-runtime";
import type { WorkspaceFileNode, WorkspaceFilesystem } from "../types/workspace";
import type { ReportSlideV1 } from "../types/workspace-contract";

function listAllFileNodes(filesystem: WorkspaceFilesystem): WorkspaceFileNode[] {
  return listDirectoryEntries(filesystem, "/");
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

function fileNodesForPrefix(
  snapshot: WorkspaceSnapshotV1,
  prefix?: string,
): WorkspaceFileNode[] {
  return listDirectoryEntries(
    snapshot.filesystem,
    prefix?.trim() ? normalizePathPrefix(prefix) : snapshot.path_prefix,
  );
}

function buildWorkspacePayload(
  snapshot: WorkspaceSnapshotV1,
  options: { includeSamples?: boolean; prefix?: string } = {},
): Record<string, unknown> {
  const includeSamples = options.includeSamples ?? true;
  const effectivePrefix = options.prefix?.trim()
    ? normalizePathPrefix(options.prefix)
    : snapshot.path_prefix;
  const fileNodes = fileNodesForPrefix(snapshot, effectivePrefix);
  const reportIndex = readWorkspaceReportIndex(snapshot.filesystem);
  return {
    path_prefix: effectivePrefix,
    workspace_context: getWorkspaceContext(snapshot.filesystem, effectivePrefix),
    files: fileNodes.map((fileNode) => summarizeWorkspaceFileNode(fileNode, includeSamples)),
    reports:
      reportIndex?.report_ids.map((reportId) => {
        const report = readWorkspaceReport(snapshot.filesystem, reportId);
        return {
          report_id: reportId,
          title: report?.title ?? reportId,
          item_count: report?.slides.length ?? 0,
          slide_count: report?.slides.length ?? 0,
          updated_at: report?.updated_at ?? null,
        };
      }) ?? [],
    current_report_id: reportIndex?.current_report_id ?? null,
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
  pathPrefix: string,
): WorkspaceSnapshotV1 {
  const normalizedPrefix = normalizePathPrefix(pathPrefix);
  return {
    version: "v1",
    filesystem,
    path_prefix: normalizedPrefix,
    workspace_context: getWorkspaceContext(filesystem, normalizedPrefix),
    bootstrap: buildWorkspaceBootstrapMetadata(filesystem),
  };
}

export function applyVfsMutations(
  snapshot: WorkspaceSnapshotV1,
  mutations: VfsMutationV1[],
): WorkspaceSnapshotV1 {
  let filesystem = snapshot.filesystem;

  for (const mutation of mutations) {
    switch (mutation.type) {
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
      case "upsert_workspace_files":
        filesystem = addWorkspaceFilesAtPathsWithResult(filesystem, mutation.files).filesystem;
        break;
      case "upsert_report":
        filesystem = writeWorkspaceReport(filesystem, mutation.report);
        break;
      case "update_report_index":
        filesystem = writeWorkspaceReportIndex(filesystem, {
          version: "v1",
          report_ids: mutation.report_ids,
          current_report_id: mutation.current_report_id,
        });
        filesystem = updateWorkspaceAppState(filesystem, {
          current_report_id: mutation.current_report_id,
        });
        filesystem = writeWorkspaceIndex(
          filesystem,
          {
            version: "v1",
            reserved_paths: [],
            report_ids: mutation.report_ids,
            current_report_id: mutation.current_report_id,
          },
        );
        break;
      case "replace_report_slides":
        filesystem = replaceWorkspaceReportSlides(
          filesystem,
          mutation.report_id,
          mutation.slides,
        );
        break;
      case "append_report_slides":
        filesystem = appendWorkspaceReportSlides(
          filesystem,
          mutation.report_id,
          mutation.slides,
        );
        break;
      case "update_app_state":
        filesystem = updateWorkspaceAppState(filesystem, mutation.patch as never);
        break;
      case "render_chart_artifact":
        break;
    }
  }

  return createSnapshot(filesystem, snapshot.path_prefix);
}

function ensureCsvPath(path: string, basePrefix: string): string {
  const resolvedPath = resolveWorkspacePath(path.trim() || "derived.csv", basePrefix);
  return resolvedPath.toLowerCase().endsWith(".csv") ? resolvedPath : `${resolvedPath}.csv`;
}

function ensureJsonPath(path: string, basePrefix: string): string {
  const resolvedPath = resolveWorkspacePath(path.trim() || "derived.json", basePrefix);
  return resolvedPath.toLowerCase().endsWith(".json") ? resolvedPath : `${resolvedPath}.json`;
}

function buildCreatedFilePayload(
  snapshot: WorkspaceSnapshotV1,
  filePath: string,
): Record<string, unknown> {
  const node = findWorkspaceFileNodeByPath(snapshot.filesystem, filePath);
  if (!node) {
    throw new Error(`Expected workspace file at path ${filePath}.`);
  }
  return summarizeWorkspaceFileNode(node, true);
}

function buildPdfIndexFilename(archiveName: string): string {
  return archiveName.toLowerCase().endsWith(".zip")
    ? archiveName.slice(0, -4) + ".md"
    : `${archiveName}.md`;
}

function hasValidSlidePanelCount(
  layout: AppendReportSlideToolArgs["slide"]["layout"],
  panelCount: number,
): boolean {
  return (
    (layout === "1x1" && panelCount === 1) ||
    (layout === "1x2" && panelCount === 2) ||
    (layout === "2x2" && panelCount >= 3 && panelCount <= 4)
  );
}

function buildReportSlideFromDraft(args: AppendReportSlideToolArgs): ReportSlideV1 {
  const createdAt = new Date().toISOString();
  if (!hasValidSlidePanelCount(args.slide.layout, args.slide.panels.length)) {
    throw new Error(`Invalid panel count for ${args.slide.layout} slide.`);
  }
  return {
    id: crypto.randomUUID(),
    created_at: createdAt,
    title: args.slide.title,
    layout: args.slide.layout,
    panels: args.slide.panels.map((panel) =>
      panel.type === "narrative"
        ? {
            id: crypto.randomUUID(),
            type: "narrative",
            title: panel.title,
            markdown: panel.markdown,
          }
        : {
            id: crypto.randomUUID(),
            type: "chart",
            title: panel.title,
            file_id: panel.file_id,
            chart_plan_id: panel.chart_plan_id,
            chart: panel.chart as Record<string, unknown>,
            image_data_url: panel.image_data_url ?? null,
          },
    ),
  };
}

async function executeTool<Name extends ClientToolName>(
  toolCall: ClientToolCall<Name>,
  snapshot: WorkspaceSnapshotV1,
): Promise<Omit<ToolExecutionResultV1, "version" | "request_id" | "tool_name">> {
  const allFiles = listAllFileNodes(snapshot.filesystem).map((node) => node.file);

  switch (toolCall.name) {
    case "list_csv_files": {
      const args = toolCall.arguments as ListLoadedDatasetsToolArgs;
      const includeSamples = args.includeSamples ?? true;
      const normalizedPrefix = args.prefix?.trim() ? normalizePathPrefix(args.prefix) : "/";
      const csvFiles = fileNodesForPrefix(snapshot, normalizedPrefix).filter((entry) => entry.file.kind === "csv");
      return {
        payload: {
          path_prefix: normalizedPrefix,
          workspace_context: getWorkspaceContext(snapshot.filesystem, normalizedPrefix),
          csv_files: csvFiles.map((fileNode) =>
            summarizeWorkspaceFileNode(fileNode, includeSamples),
          ),
          files: csvFiles.map((fileNode) =>
            summarizeWorkspaceFileNode(fileNode, includeSamples),
          ),
        },
        mutations: [],
        effects: [],
        warnings: [],
      };
    }
    case "list_pdf_files": {
      const args = toolCall.arguments as ListWorkspaceFilesToolArgs;
      const includeSamples = args.includeSamples ?? true;
      const normalizedPrefix = args.prefix?.trim() ? normalizePathPrefix(args.prefix) : "/";
      const pdfFiles = fileNodesForPrefix(snapshot, normalizedPrefix).filter((entry) => entry.file.kind === "pdf");
      return {
        payload: {
          path_prefix: normalizedPrefix,
          workspace_context: getWorkspaceContext(snapshot.filesystem, normalizedPrefix),
          pdf_files: pdfFiles.map((fileNode) =>
            summarizeWorkspaceFileNode(fileNode, includeSamples),
          ),
          files: pdfFiles.map((fileNode) =>
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
      const normalizedPrefix = args.prefix?.trim() ? normalizePathPrefix(args.prefix) : "/";
      const chartableFiles = fileNodesForPrefix(snapshot, normalizedPrefix).filter(
        (entry) => entry.file.kind === "csv" || entry.file.kind === "json",
      );
      return {
        payload: {
          path_prefix: normalizedPrefix,
          workspace_context: getWorkspaceContext(snapshot.filesystem, normalizedPrefix),
          chartable_files: chartableFiles.map((fileNode) =>
            summarizeWorkspaceFileNode(fileNode, includeSamples),
          ),
          files: chartableFiles.map((fileNode) =>
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
      const targetPath = ensureCsvPath(args.path, snapshot.path_prefix);
      const nextFile: LocalDataset = {
        id: crypto.randomUUID(),
        name: targetPath.split("/").filter(Boolean).at(-1) ?? "derived.csv",
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
          type: "upsert_workspace_files",
          files: [{ path: targetPath, file: nextFile, source: "derived" }],
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          ...buildWorkspacePayload(nextSnapshot, { includeSamples: true, prefix: snapshot.path_prefix }),
          created_file: buildCreatedFilePayload(nextSnapshot, targetPath),
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
      const targetPath = ensureJsonPath(args.path, snapshot.path_prefix);
      const nextFile: LocalJsonFile = {
        id: crypto.randomUUID(),
        name: targetPath.split("/").filter(Boolean).at(-1) ?? "derived.json",
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
          type: "upsert_workspace_files",
          files: [{ path: targetPath, file: nextFile, source: "derived" }],
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          ...buildWorkspacePayload(nextSnapshot, { includeSamples: true, prefix: snapshot.path_prefix }),
          created_file: buildCreatedFilePayload(nextSnapshot, targetPath),
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
          path_prefix: snapshot.path_prefix,
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
      const targetPath = buildArtifactTargetPath("pdf", extracted.filename);
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
          type: "upsert_workspace_files",
          files: [{ path: targetPath, file: nextFile, source: "derived" }],
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          ...buildWorkspacePayload(nextSnapshot, { includeSamples: true, prefix: snapshot.path_prefix }),
          created_file: buildCreatedFilePayload(nextSnapshot, targetPath),
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
      const createdFiles = result.extractedFiles.map((extracted) => {
        const targetPath = buildArtifactTargetPath("pdf", extracted.filename);
        return {
          path: targetPath,
          file: {
            id: crypto.randomUUID(),
            name: extracted.filename,
            kind: "pdf",
            extension: "pdf",
            byte_size: Math.ceil((extracted.fileDataBase64.length * 3) / 4),
            mime_type: extracted.mimeType,
            page_count: extracted.pageRange.pageCount,
            bytes_base64: extracted.fileDataBase64,
          } satisfies LocalPdfFile,
        };
      });
      const indexPath = buildArtifactTargetPath("pdf", buildPdfIndexFilename(result.archiveName));
      const indexFile: LocalWorkspaceFile = {
        id: crypto.randomUUID(),
        name: indexPath.split("/").filter(Boolean).at(-1) ?? "index.md",
        kind: "other",
        extension: "md",
        mime_type: "text/markdown",
        byte_size: new TextEncoder().encode(result.indexMarkdown).length,
        text_content: result.indexMarkdown,
      };
      const archivePath = buildArtifactTargetPath("pdf", result.archiveName);
      const archiveFile: LocalWorkspaceFile = {
        id: crypto.randomUUID(),
        name: result.archiveName,
        kind: "other",
        extension: "zip",
        mime_type: "application/zip",
        byte_size: Math.ceil((result.archiveBase64.length * 3) / 4),
        bytes_base64: result.archiveBase64,
      };
      const effect: ClientEffect = {
        type: "pdf_smart_split_completed",
        sourceFileId: file.id,
        sourceFileName: file.name,
        archiveFileId: archiveFile.id,
        archiveFileName: archiveFile.name,
        indexFileId: indexFile.id,
        indexFileName: indexFile.name,
        entries: createdFiles.map((createdFile, index) => ({
          fileId: createdFile.file.id,
          name: createdFile.file.name,
          title: result.extractedFiles[index].title,
          startPage: result.extractedFiles[index].pageRange.startPage,
          endPage: result.extractedFiles[index].pageRange.endPage,
          pageCount: result.extractedFiles[index].pageRange.pageCount,
        })),
        markdown: result.indexMarkdown,
      };
      const mutations: VfsMutationV1[] = [
        {
          type: "upsert_workspace_files",
          files: [
            ...createdFiles.map((createdFile) => ({
              path: createdFile.path,
              file: createdFile.file,
              source: "derived" as const,
            })),
            { path: indexPath, file: indexFile, source: "derived" as const },
            { path: archivePath, file: archiveFile, source: "derived" as const },
          ],
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          ...buildWorkspacePayload(nextSnapshot, { includeSamples: true, prefix: snapshot.path_prefix }),
          created_files: [
            ...createdFiles.map((createdFile) => buildCreatedFilePayload(nextSnapshot, createdFile.path)),
            buildCreatedFilePayload(nextSnapshot, indexPath),
            buildCreatedFilePayload(nextSnapshot, archivePath),
          ],
          smart_split: {
            entries: effect.entries.map((entry) => ({
              title: entry.title,
              start_page: entry.startPage,
              end_page: entry.endPage,
              page_count: entry.pageCount,
              file_id: entry.fileId,
              file_name: entry.name,
            })),
            archive_file: buildCreatedFilePayload(nextSnapshot, archivePath),
            index_file: buildCreatedFilePayload(nextSnapshot, indexPath),
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
                item_count: report?.slides.length ?? 0,
                slide_count: report?.slides.length ?? 0,
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
    case "create_report": {
      const args = toolCall.arguments as CreateReportToolArgs;
      const created = createWorkspaceReport(snapshot.filesystem, {
        reportId: args.report_id,
        title: args.title,
      });
      const nextReportIndex = readWorkspaceReportIndex(created.filesystem);
      if (!nextReportIndex) {
        throw new Error("Unable to persist report index for created report.");
      }
      const mutations: VfsMutationV1[] = [
        {
          type: "upsert_report",
          report: created.report,
        },
        {
          type: "update_report_index",
          report_ids: nextReportIndex.report_ids,
          current_report_id: nextReportIndex.current_report_id,
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          report: created.report,
          reports: buildWorkspacePayload(nextSnapshot).reports,
          current_report_id: nextReportIndex.current_report_id,
        },
        mutations,
        effects: [],
        warnings: [],
      };
    }
    case "append_report_slide": {
      const args = toolCall.arguments as AppendReportSlideToolArgs;
      const slide = buildReportSlideFromDraft(args);
      const mutations: VfsMutationV1[] = [
        {
          type: "append_report_slides",
          report_id: args.report_id,
          slides: [slide],
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          report_id: args.report_id,
          slide,
          report: readWorkspaceReport(nextSnapshot.filesystem, args.report_id),
          reports: buildWorkspacePayload(nextSnapshot).reports,
          current_report_id:
            readWorkspaceAppState(nextSnapshot.filesystem)?.current_report_id ??
            readWorkspaceReportIndex(nextSnapshot.filesystem)?.current_report_id ??
            null,
        },
        mutations,
        effects: [],
        warnings: [],
      };
    }
    case "remove_report_slide": {
      const args = toolCall.arguments as RemoveReportSlideToolArgs;
      const report = readWorkspaceReport(snapshot.filesystem, args.report_id);
      if (!report) {
        throw new Error(`Unknown report: ${args.report_id}`);
      }
      const nextSlides = report.slides.filter((slide) => slide.id !== args.slide_id);
      const mutations: VfsMutationV1[] = [
        {
          type: "replace_report_slides",
          report_id: args.report_id,
          slides: nextSlides,
        },
      ];
      const nextSnapshot = applyVfsMutations(snapshot, mutations);
      return {
        payload: {
          report_id: args.report_id,
          slide_id: args.slide_id,
          removed: nextSlides.length !== report.slides.length,
          report: readWorkspaceReport(nextSnapshot.filesystem, args.report_id),
        },
        mutations,
        effects: [],
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
  const normalizedSnapshot = createSnapshot(
    request.snapshot.filesystem,
    request.snapshot.path_prefix,
  );
  const result = await executeTool(toolCall, {
    ...request.snapshot,
    filesystem: normalizedSnapshot.filesystem,
    path_prefix: normalizedSnapshot.path_prefix,
    workspace_context: normalizedSnapshot.workspace_context,
    bootstrap: request.snapshot.bootstrap ?? normalizedSnapshot.bootstrap,
  });
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
