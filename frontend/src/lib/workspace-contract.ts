import type { WorkspaceState, WorkspaceStateFileSummary } from "../types/analysis";
import type { PdfSmartSplitBundleView, PdfSmartSplitEntryView } from "../tools/types";
import type { LocalOtherFile, LocalWorkspaceFile } from "../types/report";
import type {
  AgentsFileSummary,
  ReportItemV1,
  ReportSlidePanelV1,
  ReportSlideV1,
  WorkspaceAppStateV1,
  WorkspaceBootstrapMetadata,
  WorkspaceIndexV1,
  WorkspacePdfSmartSplitRegistryV1,
  WorkspaceReportIndexV1,
  WorkspaceReportV1,
  WorkspaceToolCatalogV1,
} from "../types/workspace-contract";
import {
  buildDefaultAgentsFileContent,
  buildDefaultReportIndex,
  buildDefaultWorkspaceAppState,
  buildDefaultWorkspaceIndex,
  buildDefaultWorkspaceReport,
  buildDefaultWorkspaceToolCatalog,
  normalizeReportId,
  WORKSPACE_CONTRACT_VERSION,
  type WorkspaceArtifactBucket,
} from "../types/workspace-contract";
import {
  addWorkspaceArtifactsWithResult,
  findWorkspaceFileNodeById,
  getWorkspaceContext,
  listAllWorkspaceFileNodes,
} from "./workspace-fs";
import { summarizeWorkspaceFiles } from "./workspace-files";
import type { WorkspaceFileNode, WorkspaceFilesystem } from "../types/workspace";

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizePdfSmartSplitEntry(
  value: unknown,
): PdfSmartSplitEntryView | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const fileId = asString(record.fileId);
  const name = asString(record.name);
  const title = asString(record.title);
  const startPage =
    typeof record.startPage === "number" ? record.startPage : null;
  const endPage = typeof record.endPage === "number" ? record.endPage : null;
  const pageCount =
    typeof record.pageCount === "number" ? record.pageCount : null;
  return fileId &&
    name &&
    title &&
    startPage !== null &&
    endPage !== null &&
    pageCount !== null
    ? {
        fileId,
        name,
        title,
        startPage,
        endPage,
        pageCount,
      }
    : null;
}

function normalizePdfSmartSplitBundle(
  value: unknown,
): PdfSmartSplitBundleView | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = asString(record.id);
  const createdAt = asString(record.createdAt);
  const sourceFileId = asString(record.sourceFileId);
  const sourceFileName = asString(record.sourceFileName);
  const entries = Array.isArray(record.entries)
    ? record.entries
        .map((entry) => normalizePdfSmartSplitEntry(entry))
        .filter(
          (entry): entry is PdfSmartSplitEntryView => entry !== null,
        )
    : [];
  return id && createdAt && sourceFileId && sourceFileName
    ? {
        id,
        createdAt,
        sourceFileId,
        sourceFileName,
        archiveFileId: asString(record.archiveFileId) ?? undefined,
        archiveFileName: asString(record.archiveFileName) ?? undefined,
        indexFileId: asString(record.indexFileId) ?? undefined,
        indexFileName: asString(record.indexFileName) ?? undefined,
        entries,
      }
    : null;
}

function normalizePdfSmartSplitRegistry(
  value: unknown,
): WorkspacePdfSmartSplitRegistryV1 | null {
  const record = asRecord(value);
  if (!record || record.version !== WORKSPACE_CONTRACT_VERSION) {
    return null;
  }
  const bundles = Array.isArray(record.bundles)
    ? record.bundles
        .map((bundle) => normalizePdfSmartSplitBundle(bundle))
        .filter(
          (bundle): bundle is PdfSmartSplitBundleView => bundle !== null,
        )
    : [];
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    bundles: sortPdfSmartSplitBundles(bundles),
  };
}

function sortPdfSmartSplitBundles(
  bundles: PdfSmartSplitBundleView[],
): PdfSmartSplitBundleView[] {
  return [...bundles].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt),
  );
}

function prunePdfSmartSplitBundlesForFilesystem(
  filesystem: WorkspaceFilesystem,
  bundles: PdfSmartSplitBundleView[],
): PdfSmartSplitBundleView[] {
  const fileIds = new Set(
    listAllWorkspaceFileNodes(filesystem).map((fileNode) => fileNode.file.id),
  );

  return sortPdfSmartSplitBundles(
    bundles
      .map((bundle) => {
        if (!fileIds.has(bundle.sourceFileId)) {
          return null;
        }
        const entries = bundle.entries.filter((entry) =>
          fileIds.has(entry.fileId),
        );
        if (!entries.length) {
          return null;
        }
        const nextBundle: PdfSmartSplitBundleView = {
          id: bundle.id,
          createdAt: bundle.createdAt,
          sourceFileId: bundle.sourceFileId,
          sourceFileName: bundle.sourceFileName,
          entries,
        };
        if (bundle.archiveFileId && fileIds.has(bundle.archiveFileId)) {
          nextBundle.archiveFileId = bundle.archiveFileId;
          nextBundle.archiveFileName = bundle.archiveFileName;
        }
        if (bundle.indexFileId && fileIds.has(bundle.indexFileId)) {
          nextBundle.indexFileId = bundle.indexFileId;
          nextBundle.indexFileName = bundle.indexFileName;
        }
        return nextBundle;
      })
      .filter((bundle): bundle is PdfSmartSplitBundleView => bundle !== null),
  );
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

function withFilesystemPatch(
  filesystem: WorkspaceFilesystem,
  patch: Partial<WorkspaceFilesystem>,
): WorkspaceFilesystem {
  return {
    ...filesystem,
    ...patch,
  };
}

function bucketForTextArtifact(bucket?: WorkspaceArtifactBucket): WorkspaceArtifactBucket {
  return bucket ?? "data";
}

export function readWorkspaceAppState(
  filesystem: WorkspaceFilesystem,
): WorkspaceAppStateV1 | null {
  return filesystem.app_state;
}

export function readWorkspaceReportIndex(
  filesystem: WorkspaceFilesystem,
): WorkspaceReportIndexV1 | null {
  return filesystem.report_index;
}

export function readWorkspaceToolCatalog(
  filesystem: WorkspaceFilesystem,
): WorkspaceToolCatalogV1 | null {
  return filesystem.tool_catalog;
}

export function readWorkspaceIndex(
  filesystem: WorkspaceFilesystem,
): WorkspaceIndexV1 | null {
  return filesystem.workspace_index;
}

export function readWorkspacePdfSmartSplitBundles(
  filesystem: WorkspaceFilesystem,
): PdfSmartSplitBundleView[] {
  const registry = normalizePdfSmartSplitRegistry(filesystem.pdf_smart_splits);
  if (!registry) {
    return [];
  }
  return prunePdfSmartSplitBundlesForFilesystem(filesystem, registry.bundles);
}

export function readWorkspaceReport(
  filesystem: WorkspaceFilesystem,
  reportId: string,
): WorkspaceReportV1 | null {
  return normalizeWorkspaceReport(
    filesystem.reports_by_id[normalizeReportId(reportId)] ?? null,
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
): WorkspaceFilesystem {
  return withFilesystemPatch(filesystem, { app_state: state });
}

export function writeWorkspaceReportIndex(
  filesystem: WorkspaceFilesystem,
  index: WorkspaceReportIndexV1,
): WorkspaceFilesystem {
  return withFilesystemPatch(filesystem, { report_index: index });
}

export function writeWorkspaceToolCatalog(
  filesystem: WorkspaceFilesystem,
  catalog: WorkspaceToolCatalogV1,
): WorkspaceFilesystem {
  return withFilesystemPatch(filesystem, { tool_catalog: catalog });
}

export function writeWorkspaceIndex(
  filesystem: WorkspaceFilesystem,
  index: WorkspaceIndexV1,
): WorkspaceFilesystem {
  return withFilesystemPatch(filesystem, { workspace_index: index });
}

export function writeWorkspacePdfSmartSplitBundles(
  filesystem: WorkspaceFilesystem,
  bundles: PdfSmartSplitBundleView[],
): WorkspaceFilesystem {
  return withFilesystemPatch(filesystem, {
    pdf_smart_splits: {
      version: WORKSPACE_CONTRACT_VERSION,
      bundles: sortPdfSmartSplitBundles(bundles),
    },
  });
}

export function upsertWorkspacePdfSmartSplitBundle(
  filesystem: WorkspaceFilesystem,
  bundle: PdfSmartSplitBundleView,
): WorkspaceFilesystem {
  const currentBundles = readWorkspacePdfSmartSplitBundles(filesystem);
  return writeWorkspacePdfSmartSplitBundles(
    filesystem,
    [
      bundle,
      ...currentBundles.filter((currentBundle) => currentBundle.id !== bundle.id),
    ],
  );
}

export function pruneWorkspacePdfSmartSplitBundles(
  filesystem: WorkspaceFilesystem,
): WorkspaceFilesystem {
  const registry = normalizePdfSmartSplitRegistry(filesystem.pdf_smart_splits);
  if (!registry) {
    return filesystem;
  }
  const prunedBundles = prunePdfSmartSplitBundlesForFilesystem(
    filesystem,
    registry.bundles,
  );
  const currentSerialized = JSON.stringify(sortPdfSmartSplitBundles(registry.bundles));
  const nextSerialized = JSON.stringify(sortPdfSmartSplitBundles(prunedBundles));
  if (currentSerialized === nextSerialized) {
    return filesystem;
  }
  return writeWorkspacePdfSmartSplitBundles(filesystem, prunedBundles);
}

export function writeWorkspaceReport(
  filesystem: WorkspaceFilesystem,
  report: WorkspaceReportV1,
): WorkspaceFilesystem {
  return withFilesystemPatch(filesystem, {
    reports_by_id: {
      ...filesystem.reports_by_id,
      [normalizeReportId(report.report_id)]: report,
    },
  });
}

function syncWorkspaceReportState(
  filesystem: WorkspaceFilesystem,
  reportIndex: WorkspaceReportIndexV1,
): WorkspaceFilesystem {
  let nextFilesystem = writeWorkspaceReportIndex(filesystem, reportIndex);
  const appState = readWorkspaceAppState(nextFilesystem) ?? buildDefaultWorkspaceAppState();
  nextFilesystem = writeWorkspaceAppState(
    nextFilesystem,
    {
      ...appState,
      version: WORKSPACE_CONTRACT_VERSION,
      current_report_id: reportIndex.current_report_id,
    },
  );
  nextFilesystem = writeWorkspaceIndex(
    nextFilesystem,
    buildDefaultWorkspaceIndex({
      report_ids: reportIndex.report_ids,
      current_report_id: reportIndex.current_report_id,
    }),
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
  let nextFilesystem = writeWorkspaceReport(filesystem, report);
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

export function setWorkspaceCurrentReport(
  filesystem: WorkspaceFilesystem,
  reportId: string,
): WorkspaceFilesystem {
  const normalizedReportId = normalizeReportId(reportId);
  const reportIndex = readWorkspaceReportIndex(filesystem) ?? buildDefaultReportIndex();
  const reportExists =
    reportIndex.report_ids.includes(normalizedReportId) ||
    readWorkspaceReport(filesystem, normalizedReportId) !== null;
  if (!reportExists) {
    return filesystem;
  }
  return ensureTrackedReport(filesystem, normalizedReportId);
}

export function writeAgentsFile(
  filesystem: WorkspaceFilesystem,
  markdown: string,
): WorkspaceFilesystem {
  return withFilesystemPatch(filesystem, { agents_markdown: markdown });
}

export function writeWorkspaceTextFile(
  filesystem: WorkspaceFilesystem,
  filename: string,
  text: string,
  source: WorkspaceFileNode["source"] = "derived",
  options: {
    bucket?: WorkspaceArtifactBucket;
    producer_key?: string;
    producer_label?: string;
  } = {},
): WorkspaceFilesystem {
  const trimmedName = filename.trim() || "note.txt";
  const nextFile: LocalOtherFile = {
    id: crypto.randomUUID(),
    name: trimmedName,
    kind: "other",
    extension: trimmedName.includes(".") ? trimmedName.split(".").at(-1) ?? "" : "",
    mime_type: trimmedName.endsWith(".json") ? "application/json" : "text/plain",
    byte_size: new TextEncoder().encode(text).length,
    text_content: text,
  };
  return addWorkspaceArtifactsWithResult(filesystem, [
    {
      file: nextFile,
      source,
      bucket: bucketForTextArtifact(options.bucket),
      producer_key: options.producer_key,
      producer_label: options.producer_label,
    },
  ]).filesystem;
}

export function buildWorkspaceBootstrapMetadata(
  filesystem: WorkspaceFilesystem,
): WorkspaceBootstrapMetadata {
  const appState = readWorkspaceAppState(filesystem);
  const reportIndex = readWorkspaceReportIndex(filesystem);
  const agentsFile: AgentsFileSummary = {
    present: Boolean(filesystem.agents_markdown),
    text: filesystem.agents_markdown,
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

export function buildWorkspaceStateMetadata(
  filesystem: WorkspaceFilesystem,
  workspaceId: string,
): WorkspaceState {
  const appState = readWorkspaceAppState(filesystem);
  const reportIndex = readWorkspaceReportIndex(filesystem);
  const visibleFileNodes = listAllWorkspaceFileNodes(filesystem);

  return {
    version: WORKSPACE_CONTRACT_VERSION,
    context: getWorkspaceContext(filesystem, workspaceId),
    files: visibleFileNodes.map((fileNode) => {
      const summary = summarizeWorkspaceFiles([fileNode.file], { includeSamples: true })[0];
      return {
        id: String(summary.id),
        name: String(summary.name),
        bucket: fileNode.bucket,
        producer_key: fileNode.producer_key,
        producer_label: fileNode.producer_label,
        source: fileNode.source,
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
          ? (summary.numeric_columns as WorkspaceStateFileSummary["numeric_columns"])
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
    agents_markdown: filesystem.agents_markdown ?? null,
  };
}

export function ensureWorkspaceContractFilesystem(
  filesystem: WorkspaceFilesystem,
  options: {
    toolProviderId?: string;
    toolProviderTitle?: string;
    capabilityId?: string;
    capabilityTitle?: string;
    defaultGoal: string;
    activeWorkspaceTab: string;
    toolNames?: string[];
  },
): WorkspaceFilesystem {
  const toolProviderId = options.toolProviderId ?? options.capabilityId;
  const toolProviderTitle =
    options.toolProviderTitle ?? options.capabilityTitle;
  if (!toolProviderId || !toolProviderTitle) {
    throw new Error(
      "ensureWorkspaceContractFilesystem requires a toolProviderId and toolProviderTitle.",
    );
  }
  let nextFilesystem = filesystem;

  let appState =
    readWorkspaceAppState(nextFilesystem) ??
    buildDefaultWorkspaceAppState({
      active_tool_provider_id: toolProviderId,
      active_workspace_tab: options.activeWorkspaceTab,
      current_goal: options.defaultGoal,
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
    nextFilesystem = writeWorkspaceReport(nextFilesystem, defaultReport);
  }

  const currentReportId = reportIndex.current_report_id;
  if (currentReportId && !readWorkspaceReport(nextFilesystem, currentReportId)) {
    nextFilesystem = writeWorkspaceReport(
      nextFilesystem,
      buildDefaultWorkspaceReport({ reportId: currentReportId }),
    );
  }

  appState = {
    ...appState,
    version: WORKSPACE_CONTRACT_VERSION,
    active_tool_provider_id: toolProviderId,
    active_workspace_tab:
      appState.active_workspace_tab ?? options.activeWorkspaceTab,
    current_goal: appState.current_goal ?? options.defaultGoal,
    current_report_id: appState.current_report_id ?? reportIndex.current_report_id,
  };

  nextFilesystem = writeWorkspaceAppState(nextFilesystem, appState);
  nextFilesystem = writeWorkspaceReportIndex(nextFilesystem, reportIndex);
  nextFilesystem = writeWorkspaceIndex(
    nextFilesystem,
    buildDefaultWorkspaceIndex({
      report_ids: reportIndex.report_ids,
      current_report_id: reportIndex.current_report_id,
    }),
  );
  nextFilesystem = writeWorkspaceToolCatalog(
    nextFilesystem,
    buildDefaultWorkspaceToolCatalog({
      tool_provider_id: toolProviderId,
      tool_names: options.toolNames ?? [],
    }),
  );

  if (!nextFilesystem.agents_markdown) {
    nextFilesystem = writeAgentsFile(
      nextFilesystem,
      buildDefaultAgentsFileContent({
        toolProviderTitle,
        currentGoal: appState.current_goal ?? options.defaultGoal,
      }),
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
    },
  );
}

export function updateWorkspaceCurrentGoal(
  filesystem: WorkspaceFilesystem,
  goal: string,
): WorkspaceFilesystem {
  const nextFilesystem = updateWorkspaceAppState(filesystem, {
    current_goal: goal.trim() || null,
  });
  const existingAgents = nextFilesystem.agents_markdown;
  if (!existingAgents) {
    return nextFilesystem;
  }
  return writeAgentsFile(
    nextFilesystem,
    updateAgentsObjectiveText(existingAgents, goal),
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
  );
}

export function syncWorkspaceToolCatalog(
  filesystem: WorkspaceFilesystem,
  toolProviderId: string,
  toolNames: string[],
): WorkspaceFilesystem {
  return writeWorkspaceToolCatalog(
    filesystem,
    buildDefaultWorkspaceToolCatalog({
      tool_provider_id: toolProviderId,
      tool_names: toolNames,
    }),
  );
}

export function listGlobalWorkspaceFiles(filesystem: WorkspaceFilesystem): LocalWorkspaceFile[] {
  return listAllWorkspaceFileNodes(filesystem).map((node) => node.file);
}

export function listGlobalWorkspaceFileNodes(
  filesystem: WorkspaceFilesystem,
): WorkspaceFileNode[] {
  return listAllWorkspaceFileNodes(filesystem);
}

export function buildArtifactFilename(
  filename: string,
  fallback: string,
): string {
  const trimmed = filename.trim();
  return trimmed || fallback;
}

export function buildCreatedFileSummaryById(
  filesystem: WorkspaceFilesystem,
  fileId: string,
): Record<string, unknown> {
  const node = findWorkspaceFileNodeById(filesystem, fileId);
  if (!node) {
    throw new Error(`Expected workspace artifact for file ${fileId}.`);
  }
  return {
    ...summarizeWorkspaceFiles([node.file], { includeSamples: true })[0],
    bucket: node.bucket,
    producer_key: node.producer_key,
    producer_label: node.producer_label,
    source: node.source,
  };
}
