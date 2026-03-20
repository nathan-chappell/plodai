import type { WorkspaceState, WorkspaceStateFileSummary } from "../types/analysis";
import type { LocalOtherFile, LocalWorkspaceFile } from "../types/report";
import type {
  WorkspaceBootstrapMetadata,
  WorkspaceIndexV1,
  WorkspaceAppStateV1,
  WorkspaceReportIndexV1,
  WorkspaceReportV1,
  WorkspaceToolCatalogV1,
  ReportItemV1,
  ReportSlideV1,
  ReportSlidePanelV1,
} from "../types/workspace-contract";
import {
  buildDefaultAgentsFileContent,
  buildDefaultReportIndex,
  buildDefaultWorkspaceAppState,
  buildDefaultWorkspaceIndex,
  buildDefaultWorkspaceReport,
  buildDefaultWorkspaceToolCatalog,
  buildReportPath,
  normalizeReportId,
  WORKSPACE_AGENTS_PATH,
  WORKSPACE_APP_STATE_PATH,
  WORKSPACE_CHART_ARTIFACTS_DIR,
  WORKSPACE_CONTRACT_VERSION,
  WORKSPACE_DATA_ARTIFACTS_DIR,
  WORKSPACE_INDEX_PATH,
  WORKSPACE_PDF_ARTIFACTS_DIR,
  WORKSPACE_REPORTS_DIR,
  WORKSPACE_REPORT_INDEX_PATH,
  WORKSPACE_SYSTEM_DIR,
  WORKSPACE_TOOL_CATALOG_PATH,
  type AgentsFileSummary,
} from "../types/workspace-contract";
import {
  addWorkspaceFilesAtPathsWithResult,
  findWorkspaceFileNodeByPath,
  getWorkspaceContext,
  listAllWorkspaceFileNodes,
  normalizeAbsolutePath,
  removeWorkspaceFileByPath,
  removeWorkspacePrefix,
  resolveWorkspacePath,
} from "./workspace-fs";
import { summarizeWorkspaceFiles } from "./workspace-files";
import type { WorkspaceFileNode, WorkspaceFilesystem } from "../types/workspace";

type WorkspaceStructuredDoc =
  | WorkspaceAppStateV1
  | WorkspaceReportIndexV1
  | WorkspaceReportV1
  | WorkspaceToolCatalogV1
  | WorkspaceIndexV1;

function nowIso(): string {
  return new Date().toISOString();
}

function buildTextFile(path: string, text: string): LocalOtherFile {
  const name = path.split("/").filter(Boolean).at(-1) ?? "untitled.txt";
  return {
    id: crypto.randomUUID(),
    name,
    kind: "other",
    extension: name.includes(".") ? name.split(".").at(-1) ?? "" : "",
    mime_type: name.endsWith(".json") ? "application/json" : "text/markdown",
    byte_size: new TextEncoder().encode(text).length,
    text_content: text,
  };
}

function findFileNodeByPath(
  filesystem: WorkspaceFilesystem,
  path: string,
): WorkspaceFileNode | null {
  return findWorkspaceFileNodeByPath(filesystem, path);
}

function listAllFileNodes(filesystem: WorkspaceFilesystem): WorkspaceFileNode[] {
  return listAllWorkspaceFileNodes(filesystem);
}

function upsertTextFile(
  filesystem: WorkspaceFilesystem,
  path: string,
  text: string,
  source: WorkspaceFileNode["source"],
): WorkspaceFilesystem {
  const normalizedPath = normalizeAbsolutePath(path);
  const filename = normalizedPath.split("/").filter(Boolean).at(-1) ?? "untitled";
  const existing = findFileNodeByPath(filesystem, normalizedPath);
  if (
    existing?.file.kind === "other" &&
    existing.file.text_content === text &&
    existing.file.name === filename
  ) {
    return filesystem;
  }
  const baseFile = buildTextFile(normalizedPath, text);
  const nextFile: LocalWorkspaceFile = {
    ...baseFile,
    id: existing?.file.id ?? baseFile.id,
    name: filename,
  };
  return addWorkspaceFilesAtPathsWithResult(
    filesystem,
    [
      {
        path: normalizedPath,
        file: nextFile,
        source: existing?.source ?? source,
        createdAt: existing?.created_at ?? nowIso(),
      },
    ],
  ).filesystem;
}

function removeFileByPath(
  filesystem: WorkspaceFilesystem,
  path: string,
): WorkspaceFilesystem {
  return removeWorkspaceFileByPath(filesystem, path);
}

function readTextFile(filesystem: WorkspaceFilesystem, path: string): string | null {
  const node = findFileNodeByPath(filesystem, path);
  if (!node) {
    return null;
  }
  return node.file.kind === "other" && typeof node.file.text_content === "string"
    ? node.file.text_content
    : null;
}

function parseRawJsonDocument(
  filesystem: WorkspaceFilesystem,
  path: string,
): unknown | null {
  const text = readTextFile(filesystem, path);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseJsonDocument<T extends WorkspaceStructuredDoc>(
  filesystem: WorkspaceFilesystem,
  path: string,
): T | null {
  const text = readTextFile(filesystem, path);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function writeJsonDocument(
  filesystem: WorkspaceFilesystem,
  path: string,
  value: WorkspaceStructuredDoc,
  source: WorkspaceFileNode["source"] = "derived",
): WorkspaceFilesystem {
  return upsertTextFile(filesystem, path, JSON.stringify(value, null, 2), source);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeLegacyReportItem(value: unknown): ReportItemV1 | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = asString(record.id);
  const type = asString(record.type);
  const createdAt = asString(record.created_at);
  if (!id || !type || !createdAt) {
    return null;
  }

  if (type === "section") {
    const title = asString(record.title);
    const markdown = asString(record.markdown);
    return title && markdown
      ? { id, type, created_at: createdAt, title, markdown }
      : null;
  }

  if (type === "note") {
    const title = asString(record.title);
    const text = asString(record.text);
    return title && text
      ? { id, type, created_at: createdAt, title, text }
      : null;
  }

  if (type === "chart") {
    const title = asString(record.title);
    const fileId = asString(record.file_id);
    const chartPlanId = asString(record.chart_plan_id);
    const chart = asRecord(record.chart);
    return title && fileId && chartPlanId && chart
      ? {
          id,
          type,
          created_at: createdAt,
          title,
          file_id: fileId,
          chart_plan_id: chartPlanId,
          chart,
          image_data_url:
            typeof record.image_data_url === "string" || record.image_data_url === null
              ? (record.image_data_url as string | null | undefined)
              : undefined,
        }
      : null;
  }

  if (type === "pdf_split") {
    const sourceFileId = asString(record.source_file_id);
    const sourceFileName = asString(record.source_file_name);
    const archiveFileId = asString(record.archive_file_id);
    const archiveFileName = asString(record.archive_file_name);
    const indexFileId = asString(record.index_file_id);
    const indexFileName = asString(record.index_file_name);
    const markdown = asString(record.markdown);
    const entries = Array.isArray(record.entries)
      ? record.entries
          .map((entry) => {
            const entryRecord = asRecord(entry);
            if (!entryRecord) {
              return null;
            }
            const fileId = asString(entryRecord.file_id);
            const name = asString(entryRecord.name);
            const title = asString(entryRecord.title);
            const startPage = typeof entryRecord.start_page === "number" ? entryRecord.start_page : null;
            const endPage = typeof entryRecord.end_page === "number" ? entryRecord.end_page : null;
            const pageCount = typeof entryRecord.page_count === "number" ? entryRecord.page_count : null;
            return fileId && name && title && startPage !== null && endPage !== null && pageCount !== null
              ? {
                  file_id: fileId,
                  name,
                  title,
                  start_page: startPage,
                  end_page: endPage,
                  page_count: pageCount,
                }
              : null;
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [];
    return sourceFileId &&
      sourceFileName &&
      archiveFileId &&
      archiveFileName &&
      indexFileId &&
      indexFileName &&
      markdown
      ? {
          id,
          type,
          created_at: createdAt,
          source_file_id: sourceFileId,
          source_file_name: sourceFileName,
          archive_file_id: archiveFileId,
          archive_file_name: archiveFileName,
          index_file_id: indexFileId,
          index_file_name: indexFileName,
          entries,
          markdown,
        }
      : null;
  }

  if (type === "tool_result") {
    const toolName = asString(record.tool_name);
    const title = asString(record.title);
    const payload = asRecord(record.payload);
    return toolName && title && payload
      ? { id, type, created_at: createdAt, tool_name: toolName, title, payload }
      : null;
  }

  return null;
}

function legacyReportItemToSlide(item: ReportItemV1, index: number): ReportSlideV1 {
  if (item.type === "chart") {
    return {
      id: `legacy-slide-${index}-${item.id}`,
      created_at: item.created_at,
      title: item.title,
      layout: "1x1",
      panels: [
        {
          id: item.id,
          type: "chart",
          title: item.title,
          file_id: item.file_id,
          chart_plan_id: item.chart_plan_id,
          chart: item.chart,
          image_data_url: item.image_data_url ?? null,
        },
      ],
    };
  }

  const title =
    item.type === "pdf_split"
      ? `Smart split: ${item.source_file_name}`
      : item.title;
  const markdown =
    item.type === "section"
      ? item.markdown
      : item.type === "note"
        ? item.text
        : item.type === "pdf_split"
          ? item.markdown
          : `\`\`\`json\n${JSON.stringify(item.payload, null, 2)}\n\`\`\``;

  return {
    id: `legacy-slide-${index}-${item.id}`,
    created_at: item.created_at,
    title,
    layout: "1x1",
    panels: [
      {
        id: item.id,
        type: "narrative",
        title,
        markdown,
      },
    ],
  };
}

function normalizeReportSlidePanel(value: unknown): ReportSlidePanelV1 | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = asString(record.id);
  const type = asString(record.type);
  const title = asString(record.title);
  if (!id || !type || !title) {
    return null;
  }
  if (type === "narrative") {
    const markdown = asString(record.markdown);
    return markdown ? { id, type, title, markdown } : null;
  }
  if (type === "chart") {
    const fileId = asString(record.file_id);
    const chartPlanId = asString(record.chart_plan_id);
    const chart = asRecord(record.chart);
    return fileId && chartPlanId && chart
      ? {
          id,
          type,
          title,
          file_id: fileId,
          chart_plan_id: chartPlanId,
          chart,
          image_data_url:
            typeof record.image_data_url === "string" || record.image_data_url === null
              ? (record.image_data_url as string | null | undefined)
              : undefined,
        }
      : null;
  }
  return null;
}

function normalizeReportSlide(value: unknown): ReportSlideV1 | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = asString(record.id);
  const createdAt = asString(record.created_at);
  const title = asString(record.title);
  const layout = asString(record.layout);
  const panels = Array.isArray(record.panels)
    ? record.panels
        .map((panel) => normalizeReportSlidePanel(panel))
        .filter((panel): panel is ReportSlidePanelV1 => panel !== null)
    : [];
  if (!id || !createdAt || !title || !layout) {
    return null;
  }
  if (layout !== "1x1" && layout !== "1x2" && layout !== "2x2") {
    return null;
  }
  const validPanelCount =
    (layout === "1x1" && panels.length === 1) ||
    (layout === "1x2" && panels.length === 2) ||
    (layout === "2x2" && panels.length >= 3 && panels.length <= 4);
  return validPanelCount
    ? {
        id,
        created_at: createdAt,
        title,
        layout,
        panels,
      }
    : null;
}

function normalizeWorkspaceReport(value: unknown): WorkspaceReportV1 | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const version = asString(record.version);
  const reportId = asString(record.report_id);
  const title = asString(record.title);
  const createdAt = asString(record.created_at);
  const updatedAt = asString(record.updated_at);
  if (!version || !reportId || !title || !createdAt || !updatedAt) {
    return null;
  }

  if (Array.isArray(record.slides)) {
    const slides = record.slides
      .map((slide) => normalizeReportSlide(slide))
      .filter((slide): slide is ReportSlideV1 => slide !== null);
    return {
      version: WORKSPACE_CONTRACT_VERSION,
      report_id: reportId,
      title,
      created_at: createdAt,
      updated_at: updatedAt,
      slides,
    };
  }

  if (Array.isArray(record.items)) {
    const items = record.items
      .map((item) => normalizeLegacyReportItem(item))
      .filter((item): item is ReportItemV1 => item !== null);
    return {
      version: WORKSPACE_CONTRACT_VERSION,
      report_id: reportId,
      title,
      created_at: createdAt,
      updated_at: updatedAt,
      slides: items.map((item, index) => legacyReportItemToSlide(item, index)),
    };
  }

  return {
    version: WORKSPACE_CONTRACT_VERSION,
    report_id: reportId,
    title,
    created_at: createdAt,
    updated_at: updatedAt,
    slides: [],
  };
}

function updateAgentsObjectiveText(markdown: string, nextGoal: string): string {
  const heading = "## Current Objective";
  const safeGoal = nextGoal.trim() || "No explicit objective has been recorded yet.";
  const index = markdown.indexOf(heading);
  if (index < 0) {
    return [markdown.trimEnd(), "", heading, safeGoal, ""].join("\n");
  }
  const before = markdown.slice(0, index + heading.length);
  const remainder = markdown.slice(index + heading.length);
  const nextSectionIndex = remainder.search(/\n##\s+/);
  if (nextSectionIndex < 0) {
    return `${before}\n${safeGoal}\n`;
  }
  const after = remainder.slice(nextSectionIndex);
  return `${before}\n${safeGoal}${after}`;
}

export function readWorkspaceAppState(
  filesystem: WorkspaceFilesystem,
): WorkspaceAppStateV1 | null {
  return parseJsonDocument<WorkspaceAppStateV1>(filesystem, WORKSPACE_APP_STATE_PATH);
}

export function readWorkspaceReportIndex(
  filesystem: WorkspaceFilesystem,
): WorkspaceReportIndexV1 | null {
  return parseJsonDocument<WorkspaceReportIndexV1>(
    filesystem,
    WORKSPACE_REPORT_INDEX_PATH,
  );
}

export function readWorkspaceToolCatalog(
  filesystem: WorkspaceFilesystem,
): WorkspaceToolCatalogV1 | null {
  return parseJsonDocument<WorkspaceToolCatalogV1>(
    filesystem,
    WORKSPACE_TOOL_CATALOG_PATH,
  );
}

export function readWorkspaceIndex(
  filesystem: WorkspaceFilesystem,
): WorkspaceIndexV1 | null {
  return parseJsonDocument<WorkspaceIndexV1>(filesystem, WORKSPACE_INDEX_PATH);
}

export function readWorkspaceReport(
  filesystem: WorkspaceFilesystem,
  reportId: string,
): WorkspaceReportV1 | null {
  return normalizeWorkspaceReport(
    parseRawJsonDocument(filesystem, buildReportPath(reportId)),
  );
}

export function listWorkspaceReports(
  filesystem: WorkspaceFilesystem,
): WorkspaceReportV1[] {
  const index = readWorkspaceReportIndex(filesystem);
  const reportIds = index?.report_ids ?? [];
  return reportIds
    .map((reportId) => readWorkspaceReport(filesystem, reportId))
    .filter((report): report is WorkspaceReportV1 => report !== null);
}

export function writeWorkspaceAppState(
  filesystem: WorkspaceFilesystem,
  state: WorkspaceAppStateV1,
  source: WorkspaceFileNode["source"] = "derived",
): WorkspaceFilesystem {
  return writeJsonDocument(filesystem, WORKSPACE_APP_STATE_PATH, state, source);
}

export function writeWorkspaceReportIndex(
  filesystem: WorkspaceFilesystem,
  index: WorkspaceReportIndexV1,
  source: WorkspaceFileNode["source"] = "derived",
): WorkspaceFilesystem {
  return writeJsonDocument(filesystem, WORKSPACE_REPORT_INDEX_PATH, index, source);
}

export function writeWorkspaceToolCatalog(
  filesystem: WorkspaceFilesystem,
  catalog: WorkspaceToolCatalogV1,
  source: WorkspaceFileNode["source"] = "derived",
): WorkspaceFilesystem {
  return writeJsonDocument(filesystem, WORKSPACE_TOOL_CATALOG_PATH, catalog, source);
}

export function writeWorkspaceIndex(
  filesystem: WorkspaceFilesystem,
  index: WorkspaceIndexV1,
  source: WorkspaceFileNode["source"] = "derived",
): WorkspaceFilesystem {
  return writeJsonDocument(filesystem, WORKSPACE_INDEX_PATH, index, source);
}

export function writeWorkspaceReport(
  filesystem: WorkspaceFilesystem,
  report: WorkspaceReportV1,
  source: WorkspaceFileNode["source"] = "derived",
): WorkspaceFilesystem {
  return writeJsonDocument(filesystem, buildReportPath(report.report_id), report, source);
}

function syncWorkspaceReportState(
  filesystem: WorkspaceFilesystem,
  reportIndex: WorkspaceReportIndexV1,
): WorkspaceFilesystem {
  let nextFilesystem = writeWorkspaceReportIndex(filesystem, reportIndex, "derived");
  const appState = readWorkspaceAppState(nextFilesystem) ?? buildDefaultWorkspaceAppState();
  nextFilesystem = writeWorkspaceAppState(
    nextFilesystem,
    {
      ...appState,
      version: WORKSPACE_CONTRACT_VERSION,
      current_report_id: reportIndex.current_report_id,
    },
    "derived",
  );
  nextFilesystem = writeWorkspaceIndex(
    nextFilesystem,
    buildDefaultWorkspaceIndex({
      report_ids: reportIndex.report_ids,
      current_report_id: reportIndex.current_report_id,
    }),
    "derived",
  );
  return nextFilesystem;
}

function buildUniqueReportId(
  reportIds: string[],
  requestedReportId?: string,
  title?: string,
): string {
  const usedIds = new Set(reportIds.map((reportId) => normalizeReportId(reportId)));
  const baseId = normalizeReportId(requestedReportId ?? title ?? "report");
  if (!usedIds.has(baseId)) {
    return baseId;
  }
  let counter = 2;
  while (usedIds.has(`${baseId}-${counter}`)) {
    counter += 1;
  }
  return `${baseId}-${counter}`;
}

function ensureTrackedReport(
  filesystem: WorkspaceFilesystem,
  reportId: string,
): WorkspaceFilesystem {
  let nextFilesystem = filesystem;
  const normalizedReportId = normalizeReportId(reportId);
  const reportIndex = readWorkspaceReportIndex(nextFilesystem) ?? buildDefaultReportIndex();
  const nextReportIndex: WorkspaceReportIndexV1 = {
    ...reportIndex,
    report_ids: reportIndex.report_ids.includes(normalizedReportId)
      ? reportIndex.report_ids
      : [...reportIndex.report_ids, normalizedReportId],
    current_report_id: normalizedReportId,
  };
  if (!readWorkspaceReport(nextFilesystem, normalizedReportId)) {
    nextFilesystem = writeWorkspaceReport(
      nextFilesystem,
      buildDefaultWorkspaceReport({ reportId: normalizedReportId }),
      "derived",
    );
  }
  return syncWorkspaceReportState(nextFilesystem, nextReportIndex);
}

export function createWorkspaceReport(
  filesystem: WorkspaceFilesystem,
  options: {
    title: string;
    reportId?: string;
  },
): { filesystem: WorkspaceFilesystem; report: WorkspaceReportV1 } {
  const reportIndex = readWorkspaceReportIndex(filesystem) ?? buildDefaultReportIndex();
  const nextReportId = buildUniqueReportId(
    reportIndex.report_ids,
    options.reportId,
    options.title,
  );
  const report = buildDefaultWorkspaceReport({
    reportId: nextReportId,
    title: options.title.trim() || "Untitled report",
  });
  let nextFilesystem = writeWorkspaceReport(filesystem, report, "derived");
  nextFilesystem = syncWorkspaceReportState(nextFilesystem, {
    ...reportIndex,
    report_ids: [...reportIndex.report_ids, nextReportId],
    current_report_id: nextReportId,
  });
  return {
    filesystem: nextFilesystem,
    report,
  };
}

export function writeAgentsFile(
  filesystem: WorkspaceFilesystem,
  markdown: string,
  source: WorkspaceFileNode["source"] = "derived",
): WorkspaceFilesystem {
  return upsertTextFile(filesystem, WORKSPACE_AGENTS_PATH, markdown, source);
}

export function writeWorkspaceTextFile(
  filesystem: WorkspaceFilesystem,
  path: string,
  text: string,
  source: WorkspaceFileNode["source"] = "derived",
): WorkspaceFilesystem {
  return upsertTextFile(filesystem, path, text, source);
}

export function buildWorkspaceBootstrapMetadata(
  filesystem: WorkspaceFilesystem,
): WorkspaceBootstrapMetadata {
  const appState = readWorkspaceAppState(filesystem);
  const reportIndex = readWorkspaceReportIndex(filesystem);
  const agentsText = readTextFile(filesystem, WORKSPACE_AGENTS_PATH);
  const agentsFile: AgentsFileSummary = {
    path: WORKSPACE_AGENTS_PATH,
    present: Boolean(agentsText),
    text: agentsText,
  };
  return {
    contract_version: WORKSPACE_CONTRACT_VERSION,
    agents_file: agentsFile,
    current_goal: appState?.current_goal ?? null,
    current_report_id:
      appState?.current_report_id ?? reportIndex?.current_report_id ?? null,
    report_ids: reportIndex?.report_ids ?? [],
  };
}

export function isVisibleWorkspaceStatePath(path: string): boolean {
  if (path === WORKSPACE_AGENTS_PATH) {
    return false;
  }
  if (path.startsWith(`${WORKSPACE_SYSTEM_DIR}/`)) {
    return false;
  }
  if (path.startsWith(`${WORKSPACE_REPORTS_DIR}/`)) {
    return false;
  }
  return true;
}

export function buildWorkspaceStateMetadata(
  filesystem: WorkspaceFilesystem,
  pathPrefix: string,
): WorkspaceState {
  const appState = readWorkspaceAppState(filesystem);
  const reportIndex = readWorkspaceReportIndex(filesystem);
  const agentsText = readTextFile(filesystem, WORKSPACE_AGENTS_PATH);
  const visibleFileNodes = listAllFileNodes(filesystem).filter((fileNode) =>
    isVisibleWorkspaceStatePath(fileNode.path),
  );

  return {
    version: WORKSPACE_CONTRACT_VERSION,
    context: getWorkspaceContext(filesystem, pathPrefix),
    files: visibleFileNodes.map((fileNode) => {
      const summary = summarizeWorkspaceFiles([fileNode.file], { includeSamples: true })[0];
      return {
        id: String(summary.id),
        name: String(summary.name),
        path: fileNode.path,
        kind: summary.kind as WorkspaceStateFileSummary["kind"],
        extension: String(summary.extension),
        mime_type:
          typeof summary.mime_type === "string" ? summary.mime_type : undefined,
        byte_size:
          typeof summary.byte_size === "number" ? summary.byte_size : undefined,
        row_count:
          typeof summary.row_count === "number" ? summary.row_count : undefined,
        columns: Array.isArray(summary.columns)
          ? (summary.columns as string[])
          : undefined,
        numeric_columns: Array.isArray(summary.numeric_columns)
          ? (summary.numeric_columns as string[])
          : undefined,
        sample_rows: Array.isArray(summary.sample_rows)
          ? (summary.sample_rows as WorkspaceStateFileSummary["sample_rows"])
          : undefined,
        page_count:
          typeof summary.page_count === "number" ? summary.page_count : undefined,
      } satisfies WorkspaceStateFileSummary;
    }),
    reports: listWorkspaceReports(filesystem).map((report) => ({
      report_id: report.report_id,
      title: report.title,
      item_count: report.slides.length,
      slide_count: report.slides.length,
      updated_at: report.updated_at ?? null,
    })),
    current_report_id:
      appState?.current_report_id ?? reportIndex?.current_report_id ?? null,
    current_goal: appState?.current_goal ?? null,
    agents_markdown: agentsText ?? null,
  };
}

export function ensureWorkspaceContractFilesystem(
  filesystem: WorkspaceFilesystem,
  options: {
    capabilityId: string;
    capabilityTitle: string;
    defaultGoal: string;
    activeWorkspaceTab: string;
    executionMode: "interactive" | "batch";
    toolNames?: string[];
    prefixBySurface?: Record<string, string>;
  },
): WorkspaceFilesystem {
  let nextFilesystem = filesystem;

  let appState =
    readWorkspaceAppState(nextFilesystem) ??
    buildDefaultWorkspaceAppState({
      active_capability_id: options.capabilityId,
      active_workspace_tab: options.activeWorkspaceTab,
      execution_mode: options.executionMode,
      current_goal: options.defaultGoal,
      current_prefix_by_surface: options.prefixBySurface ?? {},
    });

  let reportIndex = readWorkspaceReportIndex(nextFilesystem) ?? buildDefaultReportIndex();
  if (!reportIndex.current_report_id && reportIndex.report_ids.length) {
    reportIndex = {
      ...reportIndex,
      current_report_id: reportIndex.report_ids[0],
    };
  }
  if (!reportIndex.current_report_id) {
    const defaultReport = buildDefaultWorkspaceReport();
    reportIndex = {
      ...reportIndex,
      report_ids: [defaultReport.report_id],
      current_report_id: defaultReport.report_id,
    };
    nextFilesystem = writeWorkspaceReport(nextFilesystem, defaultReport, "derived");
  }

  const currentReportId = reportIndex.current_report_id;
  if (currentReportId && !readWorkspaceReport(nextFilesystem, currentReportId)) {
    nextFilesystem = writeWorkspaceReport(
      nextFilesystem,
      buildDefaultWorkspaceReport({ reportId: currentReportId }),
      "derived",
    );
  }

  appState = {
    ...appState,
    version: WORKSPACE_CONTRACT_VERSION,
    active_capability_id: options.capabilityId,
    active_workspace_tab:
      appState.active_workspace_tab ?? options.activeWorkspaceTab,
    execution_mode: appState.execution_mode ?? options.executionMode,
    current_goal: appState.current_goal ?? options.defaultGoal,
    current_report_id: appState.current_report_id ?? reportIndex.current_report_id,
    current_prefix_by_surface: {
      ...(appState.current_prefix_by_surface ?? {}),
      ...(options.prefixBySurface ?? {}),
    },
  };

  nextFilesystem = writeWorkspaceAppState(nextFilesystem, appState, "derived");
  nextFilesystem = writeWorkspaceReportIndex(nextFilesystem, reportIndex, "derived");
  nextFilesystem = writeWorkspaceIndex(
    nextFilesystem,
    buildDefaultWorkspaceIndex({
      report_ids: reportIndex.report_ids,
      current_report_id: reportIndex.current_report_id,
    }),
    "derived",
  );
  nextFilesystem = writeWorkspaceToolCatalog(
    nextFilesystem,
    buildDefaultWorkspaceToolCatalog({
      capability_id: options.capabilityId,
      tool_names: options.toolNames ?? [],
    }),
    "derived",
  );

  if (!readTextFile(nextFilesystem, WORKSPACE_AGENTS_PATH)) {
    nextFilesystem = writeAgentsFile(
      nextFilesystem,
      buildDefaultAgentsFileContent({
        capabilityTitle: options.capabilityTitle,
        currentGoal: appState.current_goal ?? options.defaultGoal,
      }),
      "derived",
    );
  }

  return nextFilesystem;
}

export function updateWorkspaceAppState(
  filesystem: WorkspaceFilesystem,
  patch: Partial<Omit<WorkspaceAppStateV1, "version">>,
): WorkspaceFilesystem {
  const current = readWorkspaceAppState(filesystem) ?? buildDefaultWorkspaceAppState();
  return writeWorkspaceAppState(
    filesystem,
    {
      ...current,
      ...patch,
      version: WORKSPACE_CONTRACT_VERSION,
      current_prefix_by_surface: {
        ...current.current_prefix_by_surface,
        ...(patch.current_prefix_by_surface ?? {}),
      },
    },
    "derived",
  );
}

export function updateWorkspaceCurrentGoal(
  filesystem: WorkspaceFilesystem,
  goal: string,
): WorkspaceFilesystem {
  const nextFilesystem = updateWorkspaceAppState(filesystem, {
    current_goal: goal.trim() || null,
  });
  const existingAgents = readTextFile(nextFilesystem, WORKSPACE_AGENTS_PATH);
  if (!existingAgents) {
    return nextFilesystem;
  }
  return writeAgentsFile(
    nextFilesystem,
    updateAgentsObjectiveText(existingAgents, goal),
    "derived",
  );
}

export function replaceWorkspaceReportSlides(
  filesystem: WorkspaceFilesystem,
  reportId: string,
  slides: ReportSlideV1[],
): WorkspaceFilesystem {
  const normalizedReportId = normalizeReportId(reportId);
  const trackedFilesystem = ensureTrackedReport(filesystem, normalizedReportId);
  const current =
    readWorkspaceReport(trackedFilesystem, normalizedReportId) ??
    buildDefaultWorkspaceReport({ reportId: normalizedReportId });
  return writeWorkspaceReport(
    trackedFilesystem,
    {
      ...current,
      slides,
      updated_at: nowIso(),
    },
    "derived",
  );
}

export function appendWorkspaceReportSlides(
  filesystem: WorkspaceFilesystem,
  reportId: string,
  slides: ReportSlideV1[],
): WorkspaceFilesystem {
  if (!slides.length) {
    return filesystem;
  }
  const normalizedReportId = normalizeReportId(reportId);
  const trackedFilesystem = ensureTrackedReport(filesystem, normalizedReportId);
  const current =
    readWorkspaceReport(trackedFilesystem, normalizedReportId) ??
    buildDefaultWorkspaceReport({ reportId: normalizedReportId });
  return writeWorkspaceReport(
    trackedFilesystem,
    {
      ...current,
      slides: [...current.slides, ...slides],
      updated_at: nowIso(),
    },
    "derived",
  );
}

export function removeWorkspaceReportSlide(
  filesystem: WorkspaceFilesystem,
  reportId: string,
  slideId: string,
): WorkspaceFilesystem {
  const normalizedReportId = normalizeReportId(reportId);
  const trackedFilesystem = ensureTrackedReport(filesystem, normalizedReportId);
  const current =
    readWorkspaceReport(trackedFilesystem, normalizedReportId) ??
    buildDefaultWorkspaceReport({ reportId: normalizedReportId });
  return writeWorkspaceReport(
    trackedFilesystem,
    {
      ...current,
      slides: current.slides.filter((slide) => slide.id !== slideId),
      updated_at: nowIso(),
    },
    "derived",
  );
}

export function syncWorkspaceToolCatalog(
  filesystem: WorkspaceFilesystem,
  capabilityId: string,
  toolNames: string[],
): WorkspaceFilesystem {
  return writeWorkspaceToolCatalog(
    filesystem,
    buildDefaultWorkspaceToolCatalog({
      capability_id: capabilityId,
      tool_names: toolNames,
    }),
    "derived",
  );
}

export function buildArtifactTargetPath(
  artifactKind: "data" | "chart" | "pdf",
  filename: string,
): string {
  const baseDir =
    artifactKind === "data"
      ? WORKSPACE_DATA_ARTIFACTS_DIR
      : artifactKind === "chart"
        ? WORKSPACE_CHART_ARTIFACTS_DIR
        : WORKSPACE_PDF_ARTIFACTS_DIR;
  return resolveWorkspacePath(filename, baseDir);
}

export function listGlobalWorkspaceFiles(filesystem: WorkspaceFilesystem): LocalWorkspaceFile[] {
  return listAllFileNodes(filesystem).map((node) => node.file);
}

export function listGlobalWorkspaceFileNodes(
  filesystem: WorkspaceFilesystem,
): WorkspaceFileNode[] {
  return listAllFileNodes(filesystem);
}

export function removeWorkspacePath(
  filesystem: WorkspaceFilesystem,
  path: string,
): WorkspaceFilesystem {
  const normalizedPath = normalizeAbsolutePath(path);
  const hasExactFile = Boolean(findFileNodeByPath(filesystem, normalizedPath));
  if (hasExactFile) {
    return removeFileByPath(filesystem, normalizedPath);
  }
  return removeWorkspacePrefix(filesystem, `${normalizedPath}/`);
}
