import { executeQueryPlan } from "./analysis";
import { buildChartArtifactFilename } from "./chart-artifacts";
import { renderChartToDataUrl } from "./chart";
import { parseCsvText } from "./csv";
import { parseJsonText } from "./json";
import {
  base64ToUint8Array,
  extractPdfPageRangeFromBytes,
  inspectPdfBytes,
  smartSplitPdfBytes,
} from "./pdf";
import { getFileExtension, rowsToCsv, rowsToJson } from "./workspace-files";

import type {
  AppendReportSlideToolArgs,
  ClientEffect,
  ClientToolArgsMap,
  ClientToolName,
  CreateDatasetToolArgs,
  CreateReportToolArgs,
  DataRow,
  GetFarmStateToolArgs,
  GetPdfPageRangeToolArgs,
  GetReportToolArgs,
  InspectDatasetSchemaToolArgs,
  InspectPdfFileToolArgs,
  ListDatasetsToolArgs,
  ListReportsToolArgs,
  ListWorkspaceFilesToolArgs,
  RemoveReportSlideToolArgs,
  RenderChartFromDatasetToolArgs,
  RunAggregateQueryToolArgs,
  SaveFarmStateToolArgs,
  SmartSplitEntry,
  SmartSplitPdfToolArgs,
} from "../types/analysis";
import type { AgentRuntimeContext } from "../agents/types";
import type {
  LocalDataset,
  LocalOtherAttachment,
  LocalPdfAttachment,
  LocalAttachment,
} from "../types/report";
import type {
  ChartItemPayloadV1,
  FarmItemPayloadV1,
  PdfSplitItemPayloadV1,
  WorkspaceCreatedItemDetail,
  WorkspaceCreatedItemSummary,
  WorkspaceUploadItemSummary,
} from "../types/workspace";
import type { ReportSlideV1, WorkspaceReportV1 } from "../types/workspace-contract";
import { buildDefaultWorkspaceReport, normalizeReportId } from "../types/workspace-contract";

type ToolExecutionResult = {
  payload: Record<string, unknown>;
  effects: ClientEffect[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function currentAgentId(workspace: AgentRuntimeContext): string {
  return workspace.agentId ?? workspace.activeAgentId;
}

function summarizeFileEntry(
  file: WorkspaceUploadItemSummary,
  options: { includeSamples?: boolean } = {},
): Record<string, unknown> {
  const includeSamples = options.includeSamples ?? true;
  return {
    id: file.id,
    name: file.name,
    kind: file.kind,
    extension: file.extension,
    byte_size: file.byte_size,
    mime_type: file.mime_type,
    origin: file.origin,
    local_status: file.local_status,
    source_item_id: file.source_item_id,
    ...(file.kind === "csv" || file.kind === "json"
      ? {
          row_count: "row_count" in file.preview ? file.preview.row_count : undefined,
          columns: "columns" in file.preview ? file.preview.columns : [],
          numeric_columns:
            "numeric_columns" in file.preview ? file.preview.numeric_columns : [],
          sample_rows:
            includeSamples && "sample_rows" in file.preview ? file.preview.sample_rows : [],
        }
      : {}),
    ...(file.kind === "pdf"
      ? {
          page_count: "page_count" in file.preview ? file.preview.page_count : undefined,
        }
      : {}),
    ...(file.kind === "image"
      ? {
          width: "width" in file.preview ? file.preview.width : undefined,
          height: "height" in file.preview ? file.preview.height : undefined,
        }
      : {}),
  };
}

function summarizeReportArtifact(artifact: WorkspaceCreatedItemSummary): Record<string, unknown> {
  const slideCount = "slide_count" in artifact.summary ? artifact.summary.slide_count : 0;
  return {
    report_id: artifact.id,
    artifact_id: artifact.id,
    artifact_kind: artifact.kind,
    revision: artifact.current_revision,
    title: artifact.title,
    item_count: slideCount,
    slide_count: slideCount,
    updated_at: artifact.updated_at,
  };
}

function findFileEntry(
  workspace: AgentRuntimeContext,
  fileId: string,
): WorkspaceUploadItemSummary {
  const entry = workspace.getFile(fileId);
  if (!entry) {
    throw new Error(`Unknown workspace file: ${fileId}`);
  }
  return entry;
}

async function requireLocalFile(
  workspace: AgentRuntimeContext,
  fileId: string,
): Promise<LocalAttachment> {
  const entry = findFileEntry(workspace, fileId);
  const file = await workspace.resolveLocalFile(entry.id);
  if (!file) {
    throw new Error(
      `Workspace file ${entry.name} is registered, but its local payload is unavailable in this browser.`,
    );
  }
  return file;
}

async function requireLocalDataset(
  workspace: AgentRuntimeContext,
  fileId: string,
): Promise<LocalDataset> {
  const file = await requireLocalFile(workspace, fileId);
  if (file.kind !== "csv" && file.kind !== "json") {
    throw new Error(`Workspace file ${fileId} is not a dataset.`);
  }
  return file;
}

async function requireLocalPdf(
  workspace: AgentRuntimeContext,
  fileId: string,
): Promise<LocalPdfAttachment> {
  const file = await requireLocalFile(workspace, fileId);
  if (file.kind !== "pdf") {
    throw new Error(`Workspace file ${fileId} is not a PDF.`);
  }
  return file;
}

function listFilesByKind(
  workspace: AgentRuntimeContext,
  kinds: LocalAttachment["kind"][],
): WorkspaceUploadItemSummary[] {
  const allowedKinds = new Set(kinds);
  return workspace
    .listFiles()
    .filter((file) => allowedKinds.has(file.kind))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

function reportArtifacts(workspace: AgentRuntimeContext): WorkspaceCreatedItemSummary[] {
  return workspace
    .listArtifacts()
    .filter((artifact) => artifact.kind === "report.v1")
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

function currentReportId(workspace: AgentRuntimeContext): string | null {
  const preferred = workspace.currentReportArtifactId ?? null;
  if (preferred && reportArtifacts(workspace).some((artifact) => artifact.id === preferred)) {
    return preferred;
  }
  return reportArtifacts(workspace)[0]?.id ?? null;
}

function buildReportSlideFromDraft(args: AppendReportSlideToolArgs): ReportSlideV1 {
  const createdAt = nowIso();
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
        : panel.type === "chart"
          ? {
              id: crypto.randomUUID(),
              type: "chart",
              title: panel.title,
              dataset_id: panel.dataset_id,
              chart_plan_id: panel.chart_plan_id,
              chart: panel.chart as Record<string, unknown>,
              image_data_url: panel.image_data_url ?? null,
            }
          : {
              id: crypto.randomUUID(),
              type: "image",
              title: panel.title,
              file_id: panel.file_id,
              image_data_url: panel.image_data_url ?? null,
              alt_text: panel.alt_text ?? null,
            },
    ),
  };
}

function ensureCsvFilename(filename: string): string {
  const trimmed = filename.trim() || "derived.csv";
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}

function ensureJsonFilename(filename: string): string {
  const trimmed = filename.trim() || "derived.json";
  return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
}

function ensureChartArtifactId(
  workspace: AgentRuntimeContext,
  chartPlanId: string,
): string | null {
  const existing = workspace
    .listArtifacts()
    .find(
      (artifact) =>
        artifact.kind === "chart.v1" &&
        "chart_plan_id" in artifact.summary &&
        artifact.summary.chart_plan_id === chartPlanId,
    );
  return existing?.id ?? null;
}

function ensurePdfSplitArtifactId(
  workspace: AgentRuntimeContext,
  sourceFileId: string,
): string | null {
  const existing = workspace
    .listArtifacts()
    .find(
      (artifact) =>
        artifact.kind === "pdf_split.v1" &&
        "source_file_id" in artifact.summary &&
        artifact.summary.source_file_id === sourceFileId,
    );
  return existing?.id ?? null;
}

function currentFarmArtifact(
  workspace: AgentRuntimeContext,
): WorkspaceCreatedItemSummary | null {
  return (
    workspace
      .listArtifacts()
      .find((artifact) => artifact.kind === "farm.v1") ?? null
  );
}

function createFarmArtifactId(): string {
  return `farm-${crypto.randomUUID()}`;
}

async function getReportArtifactDetail(
  workspace: AgentRuntimeContext,
  reportId: string,
): Promise<WorkspaceCreatedItemDetail> {
  const detail = await workspace.getArtifact(normalizeReportId(reportId));
  if (!detail || detail.kind !== "report.v1") {
    throw new Error(`Unknown report: ${reportId}`);
  }
  return detail;
}

function asWorkspaceReport(payload: WorkspaceCreatedItemDetail["payload"]): WorkspaceReportV1 {
  return payload as WorkspaceReportV1;
}

export async function executeLocalTool<Name extends ClientToolName>(
  workspace: AgentRuntimeContext,
  toolName: Name,
  args: ClientToolArgsMap[Name],
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "list_pdf_files": {
      const includeSamples = (args as ListWorkspaceFilesToolArgs).includeSamples ?? true;
      const files = listFilesByKind(workspace, ["pdf"]);
      return {
        payload: {
          pdf_files: files.map((file) => summarizeFileEntry(file, { includeSamples })),
          files: files.map((file) => summarizeFileEntry(file, { includeSamples })),
        },
        effects: [],
      };
    }
    case "list_datasets": {
      const includeSamples = (args as ListDatasetsToolArgs).includeSamples ?? true;
      const files = listFilesByKind(workspace, ["csv", "json"]);
      return {
        payload: {
          datasets: files.map((file) => summarizeFileEntry(file, { includeSamples })),
          files: files.map((file) => summarizeFileEntry(file, { includeSamples })),
        },
        effects: [],
      };
    }
    case "inspect_dataset_schema": {
      const toolArgs = args as InspectDatasetSchemaToolArgs;
      const entry = findFileEntry(workspace, toolArgs.dataset_id);
      return {
        payload: {
          dataset_id: entry.id,
          kind: entry.kind,
          row_count: "row_count" in entry.preview ? entry.preview.row_count : 0,
          columns: "columns" in entry.preview ? entry.preview.columns : [],
          numeric_columns:
            "numeric_columns" in entry.preview ? entry.preview.numeric_columns : [],
          sample_rows: "sample_rows" in entry.preview ? entry.preview.sample_rows : [],
          local_status: entry.local_status,
        },
        effects: [],
      };
    }
    case "run_aggregate_query": {
      const queryPlan = (args as RunAggregateQueryToolArgs).query_plan;
      const dataset = await requireLocalDataset(workspace, queryPlan.dataset_id);
      const resultRows = executeQueryPlan(dataset.rows as DataRow[], queryPlan).rows;
      return {
        payload: {
          rows: resultRows,
          row_count: resultRows.length,
        },
        effects: [],
      };
    }
    case "create_dataset": {
      const toolArgs = args as CreateDatasetToolArgs;
      const dataset = await requireLocalDataset(workspace, toolArgs.query_plan.dataset_id);
      const resultRows = executeQueryPlan(dataset.rows as DataRow[], toolArgs.query_plan).rows;
      const nextFile: LocalDataset =
        toolArgs.format === "json"
          ? (() => {
              const jsonText = rowsToJson(resultRows);
              const preview = parseJsonText(jsonText);
              return {
                id: crypto.randomUUID(),
                name: ensureJsonFilename(toolArgs.filename),
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
            })()
          : (() => {
              const csvText = rowsToCsv(resultRows);
              const preview = parseCsvText(csvText);
              return {
                id: crypto.randomUUID(),
                name: ensureCsvFilename(toolArgs.filename),
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
            })();
      const entry = await workspace.registerFile(nextFile);
      return {
        payload: {
          created_file: summarizeFileEntry(entry),
          row_count: nextFile.row_count,
          source_dataset_id: toolArgs.query_plan.dataset_id,
        },
        effects: [],
      };
    }
    case "render_chart_from_dataset": {
      const toolArgs = args as RenderChartFromDatasetToolArgs;
      const dataset = await requireLocalDataset(workspace, toolArgs.dataset_id);
      const chartPlan = {
        ...toolArgs.chart_plan,
        label_key: toolArgs.x_key,
        series:
          toolArgs.series_key && !toolArgs.y_key
            ? [{ label: toolArgs.series_key, data_key: toolArgs.series_key }]
            : toolArgs.y_key
              ? [{ label: toolArgs.y_key, data_key: toolArgs.y_key }]
              : toolArgs.chart_plan.series,
      };
      const imageDataUrl = await renderChartToDataUrl(chartPlan as never, dataset.rows);
      const artifactId = ensureChartArtifactId(workspace, toolArgs.chart_plan_id) ?? `chart-${crypto.randomUUID()}`;
      const currentArtifact = artifactId ? await workspace.getArtifact(artifactId) : null;
      const projectionFileId =
        currentArtifact &&
        currentArtifact.kind === "chart.v1" &&
        "projection_file_id" in currentArtifact.payload &&
        currentArtifact.payload.projection_file_id
          ? currentArtifact.payload.projection_file_id
          : crypto.randomUUID();

      const artifactFile: LocalOtherAttachment = {
        id: projectionFileId,
        name: buildChartArtifactFilename({
          title: chartPlan.title,
          sourceFileName: dataset.name,
        }),
        kind: "other",
        extension: "json",
        mime_type: "application/json",
        text_content: JSON.stringify(
          {
            version: "v1",
            chart_plan_id: toolArgs.chart_plan_id,
            dataset_id: toolArgs.dataset_id,
            title: chartPlan.title,
            chart: chartPlan,
            image_data_url: imageDataUrl,
          },
          null,
          2,
        ),
        byte_size: 0,
      };
      artifactFile.byte_size = new TextEncoder().encode(artifactFile.text_content ?? "").length;
      const projectionEntry = await workspace.registerFile(artifactFile, {
        sourceItemId: artifactId,
      });

      let artifactDetail: WorkspaceCreatedItemDetail;
      if (!currentArtifact) {
        artifactDetail = await workspace.createArtifact({
          id: artifactId,
          kind: "chart.v1",
          created_by_agent_id: currentAgentId(workspace),
          payload: {
            version: "v1",
            source_file_id: toolArgs.dataset_id,
            chart_plan_id: toolArgs.chart_plan_id,
            title: chartPlan.title,
            chart: chartPlan as Record<string, unknown>,
            image_data_url: imageDataUrl,
            linked_report_id: workspace.currentReportArtifactId ?? null,
            projection_file_id: projectionEntry.id,
          } satisfies ChartItemPayloadV1,
        });
      } else {
        const afterSpec = await workspace.applyArtifactOperation(artifactId, {
          base_revision: currentArtifact.current_revision,
          created_by_agent_id: currentAgentId(workspace),
          operation: {
            op: "chart.set_spec",
            source_file_id: toolArgs.dataset_id,
            chart_plan_id: toolArgs.chart_plan_id,
            title: chartPlan.title,
            chart: chartPlan as Record<string, unknown>,
            linked_report_id: workspace.currentReportArtifactId ?? null,
            projection_file_id: projectionEntry.id,
          },
        });
        artifactDetail = await workspace.applyArtifactOperation(artifactId, {
          base_revision: afterSpec.current_revision,
          created_by_agent_id: currentAgentId(workspace),
          operation: {
            op: "chart.set_preview",
            image_data_url: imageDataUrl,
            projection_file_id: projectionEntry.id,
          },
        });
      }

      return {
        payload: {
          chart: chartPlan,
          dataset_id: toolArgs.dataset_id,
          chart_plan_id: toolArgs.chart_plan_id,
          artifact_id: artifactDetail.id,
          artifact_kind: artifactDetail.kind,
          revision: artifactDetail.current_revision,
          created_file: summarizeFileEntry(projectionEntry),
          imageDataUrl,
        },
        effects: [
          {
            type: "chart_rendered",
            datasetId: toolArgs.dataset_id,
            chartPlanId: toolArgs.chart_plan_id,
            chart: chartPlan as never,
            imageDataUrl: imageDataUrl ?? undefined,
            rows: dataset.rows,
          },
        ],
      };
    }
    case "inspect_pdf_file": {
      const toolArgs = args as InspectPdfFileToolArgs;
      const file = await requireLocalPdf(workspace, toolArgs.file_id);
      const inspection = await inspectPdfBytes(base64ToUint8Array(file.bytes_base64), {
        maxPages: toolArgs.max_pages,
      });
      return {
        payload: {
          file_id: toolArgs.file_id,
          page_count: inspection.pageCount,
          outline: inspection.outline,
          page_hints: inspection.pageHints.map((page) => ({
            page_number: page.pageNumber,
            title_candidate: page.titleCandidate,
            summary: page.summary,
          })),
        },
        effects: [],
      };
    }
    case "get_pdf_page_range": {
      const toolArgs = args as GetPdfPageRangeToolArgs;
      const file = await requireLocalPdf(workspace, toolArgs.file_id);
      const extracted = await extractPdfPageRangeFromBytes(base64ToUint8Array(file.bytes_base64), {
        filename: file.name,
        startPage: toolArgs.start_page,
        endPage: toolArgs.end_page,
      });
      const nextFile: LocalPdfAttachment = {
        id: crypto.randomUUID(),
        name: extracted.filename,
        kind: "pdf",
        extension: getFileExtension(extracted.filename),
        byte_size: Math.ceil((extracted.fileDataBase64.length * 3) / 4),
        mime_type: extracted.mimeType,
        page_count: extracted.pageRange.pageCount,
        bytes_base64: extracted.fileDataBase64,
      };
      const entry = await workspace.registerFile(nextFile);
      return {
        payload: {
          created_file: summarizeFileEntry(entry),
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
        effects: [],
      };
    }
    case "smart_split_pdf": {
      const toolArgs = args as SmartSplitPdfToolArgs;
      const file = await requireLocalPdf(workspace, toolArgs.file_id);
      const result = await smartSplitPdfBytes(base64ToUint8Array(file.bytes_base64), {
        filename: file.name,
        goal: toolArgs.goal,
      });
      const artifactId =
        ensurePdfSplitArtifactId(workspace, toolArgs.file_id) ?? `pdf-split-${crypto.randomUUID()}`;
      const currentArtifact = artifactId ? await workspace.getArtifact(artifactId) : null;
      const createdEntries: SmartSplitEntry[] = [];
      const createdFileEntries: WorkspaceUploadItemSummary[] = [];

      for (const extracted of result.extractedFiles) {
        const nextFile: LocalPdfAttachment = {
          id: crypto.randomUUID(),
          name: extracted.filename,
          kind: "pdf",
          extension: "pdf",
          byte_size: Math.ceil((extracted.fileDataBase64.length * 3) / 4),
          mime_type: extracted.mimeType,
          page_count: extracted.pageRange.pageCount,
          bytes_base64: extracted.fileDataBase64,
        };
        const entry = await workspace.registerFile(nextFile, {
          sourceItemId: artifactId,
        });
        createdFileEntries.push(entry);
        createdEntries.push({
          fileId: entry.id,
          name: nextFile.name,
          title: extracted.title,
          startPage: extracted.pageRange.startPage,
          endPage: extracted.pageRange.endPage,
          pageCount: extracted.pageRange.pageCount,
        });
      }

      const indexFileId =
        currentArtifact &&
        currentArtifact.kind === "pdf_split.v1" &&
        "index_file_id" in currentArtifact.payload
          ? currentArtifact.payload.index_file_id
          : crypto.randomUUID();
      const archiveFileId =
        currentArtifact &&
        currentArtifact.kind === "pdf_split.v1" &&
        "archive_file_id" in currentArtifact.payload
          ? currentArtifact.payload.archive_file_id
          : crypto.randomUUID();

      const indexFile: LocalOtherAttachment = {
        id: indexFileId,
        name: result.archiveName.toLowerCase().endsWith(".zip")
          ? `${result.archiveName.slice(0, -4)}.md`
          : `${result.archiveName}.md`,
        kind: "other",
        extension: "md",
        mime_type: "text/markdown",
        text_content: result.indexMarkdown,
        byte_size: new TextEncoder().encode(result.indexMarkdown).length,
      };
      const archiveFile: LocalOtherAttachment = {
        id: archiveFileId,
        name: result.archiveName,
        kind: "other",
        extension: "zip",
        mime_type: "application/zip",
        bytes_base64: result.archiveBase64,
        byte_size: Math.ceil((result.archiveBase64.length * 3) / 4),
      };
      const indexEntry = await workspace.registerFile(indexFile, {
        sourceItemId: artifactId,
      });
      const archiveEntry = await workspace.registerFile(archiveFile, {
        sourceItemId: artifactId,
      });

      let artifactDetail: WorkspaceCreatedItemDetail;
      const payload: PdfSplitItemPayloadV1 = {
        version: "v1",
        title: `Split ${file.name}`,
        source_file_id: toolArgs.file_id,
        entries: createdEntries.map((entry) => ({
          title: entry.title,
          start_page: entry.startPage,
          end_page: entry.endPage,
          page_count: entry.pageCount,
          file_id: entry.fileId,
          file_name: entry.name,
        })),
        archive_file_id: archiveEntry.id,
        index_file_id: indexEntry.id,
        markdown: result.indexMarkdown,
      };

      if (!currentArtifact) {
        artifactDetail = await workspace.createArtifact({
          id: artifactId,
          kind: "pdf_split.v1",
          created_by_agent_id: currentAgentId(workspace),
          payload,
        });
      } else {
        artifactDetail = await workspace.applyArtifactOperation(artifactId, {
          base_revision: currentArtifact.current_revision,
          created_by_agent_id: currentAgentId(workspace),
          operation: {
            op: "pdf_split.set_result",
            title: payload.title,
            source_file_id: payload.source_file_id,
            entries: payload.entries,
            archive_file_id: payload.archive_file_id,
            index_file_id: payload.index_file_id,
            markdown: payload.markdown,
          },
        });
      }

      return {
        payload: {
          artifact_id: artifactDetail.id,
          artifact_kind: artifactDetail.kind,
          revision: artifactDetail.current_revision,
          created_files: [...createdFileEntries, indexEntry, archiveEntry].map((entry) =>
            summarizeFileEntry(entry),
          ),
          smart_split: {
            entries: createdEntries.map((entry) => ({
              title: entry.title,
              start_page: entry.startPage,
              end_page: entry.endPage,
              page_count: entry.pageCount,
              file_id: entry.fileId,
              file_name: entry.name,
            })),
            archive_file: summarizeFileEntry(archiveEntry),
            index_file: summarizeFileEntry(indexEntry),
          },
        },
        effects: [
          {
            type: "pdf_smart_split_completed",
            sourceFileId: toolArgs.file_id,
            sourceFileName: file.name,
            archiveFileId: archiveEntry.id,
            archiveFileName: archiveEntry.name,
            indexFileId: indexEntry.id,
            indexFileName: indexEntry.name,
            entries: createdEntries,
            markdown: result.indexMarkdown,
          },
        ],
      };
    }
    case "get_farm_state": {
      void (args as GetFarmStateToolArgs);
      const artifact = currentFarmArtifact(workspace);
      if (!artifact) {
        return {
          payload: {
            artifact_id: null,
            farm: null,
          },
          effects: [],
        };
      }
      const detail = await workspace.getArtifact(artifact.id);
      if (!detail || detail.kind !== "farm.v1") {
        return {
          payload: {
            artifact_id: null,
            farm: null,
          },
          effects: [],
        };
      }
      return {
        payload: {
          artifact_id: detail.id,
          artifact_kind: detail.kind,
          revision: detail.current_revision,
          farm: detail.payload as FarmItemPayloadV1,
        },
        effects: [],
      };
    }
    case "save_farm_state": {
      const toolArgs = args as SaveFarmStateToolArgs;
      const existing = currentFarmArtifact(workspace);
      let detail: WorkspaceCreatedItemDetail;

      if (!existing) {
        detail = await workspace.createArtifact({
          id: createFarmArtifactId(),
          kind: "farm.v1",
          created_by_agent_id: currentAgentId(workspace),
          payload: {
            version: "v1",
            farm_name: toolArgs.farm_name,
            location: toolArgs.location ?? null,
            crops: toolArgs.crops,
            issues: toolArgs.issues,
            projects: toolArgs.projects,
            orders: toolArgs.orders ?? [],
            current_work: toolArgs.current_work,
            notes: toolArgs.notes ?? null,
          } satisfies FarmItemPayloadV1,
        });
      } else {
        const existingDetail = await workspace.getArtifact(existing.id);
        const existingFarm =
          existingDetail && existingDetail.kind === "farm.v1"
            ? (existingDetail.payload as FarmItemPayloadV1)
            : null;
        detail = await workspace.applyArtifactOperation(existing.id, {
          base_revision: existing.current_revision,
          created_by_agent_id: currentAgentId(workspace),
          operation: {
            op: "farm.set_state",
            farm_name: toolArgs.farm_name,
            location: toolArgs.location ?? null,
            crops: toolArgs.crops,
            issues: toolArgs.issues,
            projects: toolArgs.projects,
            orders: toolArgs.orders ?? existingFarm?.orders ?? [],
            current_work: toolArgs.current_work,
            notes: toolArgs.notes ?? null,
          },
        });
      }

      await workspace.updateWorkspace({
        selected_item_id: detail.id,
      });

      return {
        payload: {
          artifact_id: detail.id,
          artifact_kind: detail.kind,
          revision: detail.current_revision,
          farm: detail.payload as FarmItemPayloadV1,
        },
        effects: [],
      };
    }
    case "list_reports": {
      void (args as ListReportsToolArgs);
      const reports = reportArtifacts(workspace);
      return {
        payload: {
          reports: reports.map((artifact) => summarizeReportArtifact(artifact)),
          current_report_id: currentReportId(workspace),
        },
        effects: [],
      };
    }
    case "get_report": {
      const toolArgs = args as GetReportToolArgs;
      const detail = await getReportArtifactDetail(workspace, toolArgs.report_id);
      return {
        payload: {
          artifact_id: detail.id,
          artifact_kind: detail.kind,
          revision: detail.current_revision,
          report: asWorkspaceReport(detail.payload),
        },
        effects: [],
      };
    }
    case "create_report": {
      const toolArgs = args as CreateReportToolArgs;
      const reportId = normalizeReportId(toolArgs.report_id ?? toolArgs.title);
      const report = buildDefaultWorkspaceReport({
        reportId,
        title: toolArgs.title,
      });
      const detail = await workspace.createArtifact({
        id: report.report_id,
        kind: "report.v1",
        created_by_agent_id: currentAgentId(workspace),
        payload: report,
      });
      await workspace.updateWorkspace({
        current_report_item_id: detail.id,
        selected_item_id: detail.id,
      });
      return {
        payload: {
          artifact_id: detail.id,
          artifact_kind: detail.kind,
          revision: detail.current_revision,
          report: asWorkspaceReport(detail.payload),
          reports: reportArtifacts(workspace).map((artifact) => summarizeReportArtifact(artifact)),
          current_report_id: detail.id,
        },
        effects: [],
      };
    }
    case "append_report_slide": {
      const toolArgs = args as AppendReportSlideToolArgs;
      const detail = await getReportArtifactDetail(workspace, toolArgs.report_id);
      const slide = buildReportSlideFromDraft(toolArgs);
      const nextDetail = await workspace.applyArtifactOperation(detail.id, {
        base_revision: detail.current_revision,
        created_by_agent_id: currentAgentId(workspace),
        operation: {
          op: "report.append_slide",
          slide,
        },
      });
      await workspace.updateWorkspace({
        current_report_item_id: nextDetail.id,
        selected_item_id: nextDetail.id,
      });
      return {
        payload: {
          artifact_id: nextDetail.id,
          artifact_kind: nextDetail.kind,
          revision: nextDetail.current_revision,
          report: asWorkspaceReport(nextDetail.payload),
          current_report_id: nextDetail.id,
        },
        effects: [],
      };
    }
    case "remove_report_slide": {
      const toolArgs = args as RemoveReportSlideToolArgs;
      const detail = await getReportArtifactDetail(workspace, toolArgs.report_id);
      const nextDetail = await workspace.applyArtifactOperation(detail.id, {
        base_revision: detail.current_revision,
        created_by_agent_id: currentAgentId(workspace),
        operation: {
          op: "report.remove_slide",
          slide_id: toolArgs.slide_id,
        },
      });
      await workspace.updateWorkspace({
        current_report_item_id: nextDetail.id,
        selected_item_id: nextDetail.id,
      });
      return {
        payload: {
          artifact_id: nextDetail.id,
          artifact_kind: nextDetail.kind,
          revision: nextDetail.current_revision,
          report: asWorkspaceReport(nextDetail.payload),
          current_report_id: nextDetail.id,
        },
        effects: [],
      };
    }
  }

  throw new Error(`Unsupported client tool: ${toolName}`);
}
