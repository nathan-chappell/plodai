import { executeQueryPlan } from "./analysis";
import { appendReportSlides, createReport, getReport, listReports, removeReportSlide } from "./agent-reports";
import { buildChartArtifactFilename } from "./chart-artifacts";
import { renderChartToDataUrl } from "./chart";
import { parseCsvText } from "./csv";
import { buildModelSafeImageDataUrl } from "./image";
import { parseJsonText } from "./json";
import {
  base64ToUint8Array,
  extractPdfPageRangeFromBytes,
  inspectPdfBytes,
  smartSplitPdfBytes,
} from "./pdf";
import {
  buildResourceFromFile,
  normalizeAgentShellState,
  summarizeSharedExport,
  upsertAgentResource,
} from "./shell-resources";
import { getFileExtension, rowsToCsv, rowsToJson } from "./workspace-files";

import type {
  AppendReportSlideToolArgs,
  ClientEffect,
  ClientToolArgsMap,
  ClientToolName,
  CreateDatasetToolArgs,
  CreateReportToolArgs,
  DataRow,
  GetPdfPageRangeToolArgs,
  GetReportToolArgs,
  InspectDatasetSchemaToolArgs,
  InspectImageFileToolArgs,
  InspectPdfFileToolArgs,
  ListDatasetsToolArgs,
  ListImageFilesToolArgs,
  ListReportsToolArgs,
  ListWorkspaceFilesToolArgs,
  RemoveReportSlideToolArgs,
  RenderChartFromDatasetToolArgs,
  RunAggregateQueryToolArgs,
  SmartSplitEntry,
  SmartSplitPdfToolArgs,
} from "../types/analysis";
import type { AgentRuntimeContext } from "../agents/types";
import type { LocalDataset, LocalImageFile, LocalOtherFile, LocalPdfFile } from "../types/report";
import type { AgentResourceRecord } from "../types/shell";
import type { ReportSlideV1 } from "../types/workspace-contract";

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

function listSharedResourcesByKind(
  workspace: AgentRuntimeContext,
  kinds: Array<AgentResourceRecord["kind"]>,
): AgentResourceRecord[] {
  const allowedKinds = new Set(kinds);
  return workspace
    .listSharedResources()
    .filter((resource) => allowedKinds.has(resource.kind))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function findResource(
  workspace: AgentRuntimeContext,
  resourceId: string,
): AgentResourceRecord {
  const resource = workspace.resolveResource(resourceId);
  if (!resource) {
    throw new Error(`Unknown shared export: ${resourceId}`);
  }
  return resource;
}

function findDatasetResource(
  workspace: AgentRuntimeContext,
  datasetId: string,
): AgentResourceRecord & { payload: { type: "dataset"; file: LocalDataset } } {
  const resource = findResource(workspace, datasetId);
  if (resource.payload.type !== "dataset") {
    throw new Error(`Shared export ${datasetId} is not a dataset.`);
  }
  return resource as AgentResourceRecord & {
    payload: { type: "dataset"; file: LocalDataset };
  };
}

function findImageResource(
  workspace: AgentRuntimeContext,
  resourceId: string,
): AgentResourceRecord & { payload: { type: "image"; file: LocalImageFile } } {
  const resource = findResource(workspace, resourceId);
  if (resource.payload.type !== "image") {
    throw new Error(`Shared export ${resourceId} is not an image.`);
  }
  return resource as AgentResourceRecord & {
    payload: { type: "image"; file: LocalImageFile };
  };
}

function findPdfResource(
  workspace: AgentRuntimeContext,
  resourceId: string,
): AgentResourceRecord & { payload: { type: "document"; file: LocalPdfFile } } {
  const resource = findResource(workspace, resourceId);
  if (resource.payload.type !== "document" || resource.payload.file.kind !== "pdf") {
    throw new Error(`Shared export ${resourceId} is not a PDF document.`);
  }
  return resource as AgentResourceRecord & {
    payload: { type: "document"; file: LocalPdfFile };
  };
}

function listReportsForAgent(
  workspace: AgentRuntimeContext,
): ReturnType<typeof listReports> {
  return listReports(workspace.getAgentState(currentAgentId(workspace)));
}

function summarizeResources(
  resources: AgentResourceRecord[],
): Array<Record<string, unknown>> {
  return resources.map((resource) => summarizeSharedExport(resource));
}

function appendResourceToCurrentAgent(
  workspace: AgentRuntimeContext,
  resource: AgentResourceRecord,
): AgentResourceRecord {
  workspace.updateAgentState(currentAgentId(workspace), (state) =>
    upsertAgentResource(state, resource),
  );
  return resource;
}

function ensureCsvFilename(filename: string): string {
  const trimmed = filename.trim() || "derived.csv";
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}

function ensureJsonFilename(filename: string): string {
  const trimmed = filename.trim() || "derived.json";
  return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
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

export async function executeLocalTool<Name extends ClientToolName>(
  workspace: AgentRuntimeContext,
  toolName: Name,
  args: ClientToolArgsMap[Name],
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "list_image_files": {
      void (args as ListImageFilesToolArgs);
      const imageResources = listSharedResourcesByKind(workspace, ["image"]);
      return {
        payload: {
          image_files: summarizeResources(imageResources),
          resources: summarizeResources(imageResources),
        },
        effects: [],
      };
    }
    case "list_pdf_files": {
      const includeSamples = (args as ListWorkspaceFilesToolArgs).includeSamples ?? true;
      void includeSamples;
      const documentResources = listSharedResourcesByKind(workspace, ["document"]).filter(
        (resource) =>
          resource.payload.type === "document" && resource.payload.file.kind === "pdf",
      );
      return {
        payload: {
          pdf_files: summarizeResources(documentResources),
          resources: summarizeResources(documentResources),
        },
        effects: [],
      };
    }
    case "list_datasets": {
      const includeSamples = (args as ListDatasetsToolArgs).includeSamples ?? true;
      const datasetResources = listSharedResourcesByKind(workspace, ["dataset"]).map((resource) => {
        if (!includeSamples) {
          return {
            ...summarizeSharedExport(resource),
            sample_rows: [],
          };
        }
        return summarizeSharedExport(resource);
      });
      return {
        payload: {
          datasets: datasetResources,
          resources: datasetResources,
        },
        effects: [],
      };
    }
    case "inspect_image_file": {
      const resource = findImageResource(workspace, (args as InspectImageFileToolArgs).file_id);
      return {
        payload: {
          file_id: resource.id,
          name: resource.title,
          kind: resource.kind,
          width: resource.payload.file.width,
          height: resource.payload.file.height,
          mime_type: resource.payload.file.mime_type,
          byte_size: resource.payload.file.byte_size,
          imageDataUrl: await buildModelSafeImageDataUrl(resource.payload.file, {
            maxDimension: (args as InspectImageFileToolArgs).max_dimension ?? 1536,
          }),
        },
        effects: [],
      };
    }
    case "inspect_dataset_schema": {
      const resource = findDatasetResource(workspace, (args as InspectDatasetSchemaToolArgs).dataset_id);
      return {
        payload: {
          dataset_id: resource.id,
          kind: resource.payload.file.kind,
          row_count: resource.payload.file.row_count,
          columns: resource.payload.file.columns,
          numeric_columns: resource.payload.file.numeric_columns,
          sample_rows: resource.payload.file.sample_rows,
        },
        effects: [],
      };
    }
    case "run_aggregate_query": {
      const queryPlan = (args as RunAggregateQueryToolArgs).query_plan;
      const resource = findDatasetResource(workspace, queryPlan.dataset_id);
      const resultRows = executeQueryPlan(resource.payload.file.rows as DataRow[], queryPlan).rows;
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
      const sourceResource = findDatasetResource(workspace, toolArgs.query_plan.dataset_id);
      const resultRows = executeQueryPlan(sourceResource.payload.file.rows as DataRow[], toolArgs.query_plan).rows;
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
      const resource = appendResourceToCurrentAgent(
        workspace,
        buildResourceFromFile(currentAgentId(workspace), nextFile),
      );
      return {
        payload: {
          created_file: summarizeSharedExport(resource),
          row_count: nextFile.row_count,
          source_dataset_id: sourceResource.id,
        },
        effects: [],
      };
    }
    case "render_chart_from_dataset": {
      const toolArgs = args as RenderChartFromDatasetToolArgs;
      const datasetResource = findDatasetResource(workspace, toolArgs.dataset_id);
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
      const imageDataUrl = await renderChartToDataUrl(chartPlan as never, datasetResource.payload.file.rows);
      const artifactFile: LocalOtherFile = {
        id: crypto.randomUUID(),
        name: buildChartArtifactFilename({
          title: chartPlan.title,
          sourceFileName: datasetResource.payload.file.name,
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
      const resource = appendResourceToCurrentAgent(
        workspace,
        buildResourceFromFile(currentAgentId(workspace), artifactFile),
      );
      return {
        payload: {
          chart: chartPlan,
          dataset_id: toolArgs.dataset_id,
          chart_plan_id: toolArgs.chart_plan_id,
          created_file: summarizeSharedExport(resource),
          imageDataUrl,
        },
        effects: [
          {
            type: "chart_rendered",
            datasetId: toolArgs.dataset_id,
            chartPlanId: toolArgs.chart_plan_id,
            chart: chartPlan as never,
            imageDataUrl: imageDataUrl ?? undefined,
            rows: datasetResource.payload.file.rows,
          },
        ],
      };
    }
    case "inspect_pdf_file": {
      const resource = findPdfResource(workspace, (args as InspectPdfFileToolArgs).file_id);
      const inspection = await inspectPdfBytes(
        base64ToUint8Array(resource.payload.file.bytes_base64),
        {
          maxPages: (args as InspectPdfFileToolArgs).max_pages,
        },
      );
      return {
        payload: {
          file_id: resource.id,
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
      const resource = findPdfResource(workspace, toolArgs.file_id);
      const extracted = await extractPdfPageRangeFromBytes(
        base64ToUint8Array(resource.payload.file.bytes_base64),
        {
          filename: resource.payload.file.name,
          startPage: toolArgs.start_page,
          endPage: toolArgs.end_page,
        },
      );
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
      const nextResource = appendResourceToCurrentAgent(
        workspace,
        buildResourceFromFile(currentAgentId(workspace), nextFile),
      );
      return {
        payload: {
          created_file: summarizeSharedExport(nextResource),
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
      const resource = findPdfResource(workspace, toolArgs.file_id);
      const result = await smartSplitPdfBytes(base64ToUint8Array(resource.payload.file.bytes_base64), {
        filename: resource.payload.file.name,
        goal: toolArgs.goal,
      });
      const ownerAgentId = currentAgentId(workspace);
      const createdEntries: SmartSplitEntry[] = [];
      const createdResources: AgentResourceRecord[] = [];

      for (const extracted of result.extractedFiles) {
        const file: LocalPdfFile = {
          id: crypto.randomUUID(),
          name: extracted.filename,
          kind: "pdf",
          extension: "pdf",
          byte_size: Math.ceil((extracted.fileDataBase64.length * 3) / 4),
          mime_type: extracted.mimeType,
          page_count: extracted.pageRange.pageCount,
          bytes_base64: extracted.fileDataBase64,
        };
        const nextResource = buildResourceFromFile(ownerAgentId, file);
        createdResources.push(nextResource);
        createdEntries.push({
          fileId: nextResource.id,
          name: file.name,
          title: extracted.title,
          startPage: extracted.pageRange.startPage,
          endPage: extracted.pageRange.endPage,
          pageCount: extracted.pageRange.pageCount,
        });
      }

      const indexFile: LocalOtherFile = {
        id: crypto.randomUUID(),
        name: result.archiveName.toLowerCase().endsWith(".zip")
          ? `${result.archiveName.slice(0, -4)}.md`
          : `${result.archiveName}.md`,
        kind: "other",
        extension: "md",
        mime_type: "text/markdown",
        text_content: result.indexMarkdown,
        byte_size: new TextEncoder().encode(result.indexMarkdown).length,
      };
      const archiveFile: LocalOtherFile = {
        id: crypto.randomUUID(),
        name: result.archiveName,
        kind: "other",
        extension: "zip",
        mime_type: "application/zip",
        bytes_base64: result.archiveBase64,
        byte_size: Math.ceil((result.archiveBase64.length * 3) / 4),
      };
      createdResources.push(buildResourceFromFile(ownerAgentId, indexFile));
      createdResources.push(buildResourceFromFile(ownerAgentId, archiveFile));

      workspace.updateAgentState(ownerAgentId, (state) => ({
        ...normalizeAgentShellState(state),
        resources: [
          ...sortUniqueResources(normalizeAgentShellState(state).resources, createdResources),
        ],
      }));

      const archiveResource = workspace.resolveResource(archiveFile.id);
      const indexResource = workspace.resolveResource(indexFile.id);
      return {
        payload: {
          created_files: createdResources.map((created) => summarizeSharedExport(created)),
          smart_split: {
            entries: createdEntries.map((entry) => ({
              title: entry.title,
              start_page: entry.startPage,
              end_page: entry.endPage,
              page_count: entry.pageCount,
              file_id: entry.fileId,
              file_name: entry.name,
            })),
            archive_file: archiveResource ? summarizeSharedExport(archiveResource) : summarizeSharedExport(createdResources[createdResources.length - 1]),
            index_file: indexResource ? summarizeSharedExport(indexResource) : summarizeSharedExport(createdResources[createdResources.length - 2]),
          },
        },
        effects: [
          {
            type: "pdf_smart_split_completed",
            sourceFileId: resource.id,
            sourceFileName: resource.title,
            archiveFileId: archiveFile.id,
            archiveFileName: archiveFile.name,
            indexFileId: indexFile.id,
            indexFileName: indexFile.name,
            entries: createdEntries,
            markdown: result.indexMarkdown,
          },
        ],
      };
    }
    case "list_reports": {
      void (args as ListReportsToolArgs);
      const reports = listReportsForAgent(workspace);
      return {
        payload: {
          reports: reports.map((report) => ({
            report_id: report.report_id,
            title: report.title,
            item_count: report.slides.length,
            slide_count: report.slides.length,
            updated_at: report.updated_at ?? null,
          })),
          current_report_id: workspace.getAgentState(currentAgentId(workspace)).current_report_id,
        },
        effects: [],
      };
    }
    case "get_report": {
      const report = getReport(workspace.getAgentState(currentAgentId(workspace)), (args as GetReportToolArgs).report_id);
      if (!report) {
        throw new Error(`Unknown report: ${(args as GetReportToolArgs).report_id}`);
      }
      return {
        payload: { report },
        effects: [],
      };
    }
    case "create_report": {
      const toolArgs = args as CreateReportToolArgs;
      const created = createReport(workspace.getAgentState(currentAgentId(workspace)), currentAgentId(workspace), {
        reportId: toolArgs.report_id,
        title: toolArgs.title,
      });
      workspace.updateAgentState(currentAgentId(workspace), () => created.state);
      return {
        payload: {
          report: created.report,
          reports: listReports(created.state).map((report) => ({
            report_id: report.report_id,
            title: report.title,
            item_count: report.slides.length,
            slide_count: report.slides.length,
            updated_at: report.updated_at ?? null,
          })),
          current_report_id: created.state.current_report_id,
        },
        effects: [],
      };
    }
    case "append_report_slide": {
      const toolArgs = args as AppendReportSlideToolArgs;
      const slide = buildReportSlideFromDraft(toolArgs);
      const nextState = appendReportSlides(
        workspace.getAgentState(currentAgentId(workspace)),
        currentAgentId(workspace),
        toolArgs.report_id,
        [slide],
      );
      workspace.updateAgentState(currentAgentId(workspace), () => nextState);
      return {
        payload: {
          report: getReport(nextState, toolArgs.report_id),
          current_report_id: nextState.current_report_id,
        },
        effects: [],
      };
    }
    case "remove_report_slide": {
      const toolArgs = args as RemoveReportSlideToolArgs;
      const nextState = removeReportSlide(
        workspace.getAgentState(currentAgentId(workspace)),
        currentAgentId(workspace),
        toolArgs.report_id,
        toolArgs.slide_id,
      );
      workspace.updateAgentState(currentAgentId(workspace), () => nextState);
      return {
        payload: {
          report: getReport(nextState, toolArgs.report_id),
          current_report_id: nextState.current_report_id,
        },
        effects: [],
      };
    }
  }

  throw new Error(`Unsupported client tool: ${toolName}`);
}

function sortUniqueResources(
  current: AgentResourceRecord[],
  additions: AgentResourceRecord[],
): AgentResourceRecord[] {
  const byId = new Map(current.map((resource) => [resource.id, resource]));
  for (const resource of additions) {
    byId.set(resource.id, resource);
  }
  return [...byId.values()].sort(
    (left, right) =>
      right.created_at.localeCompare(left.created_at) ||
      left.title.localeCompare(right.title),
  );
}
