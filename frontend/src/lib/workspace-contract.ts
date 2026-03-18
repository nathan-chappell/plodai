import type { ClientEffect } from "../types/analysis";
import type { LocalOtherFile, LocalWorkspaceFile } from "../types/report";
import type {
  WorkspaceBootstrapMetadata,
  WorkspaceIndexV1,
  WorkspaceAppStateV1,
  WorkspaceReportIndexV1,
  WorkspaceReportV1,
  WorkspaceToolCatalogV1,
  ReportItemV1,
} from "../types/workspace-contract";
import {
  buildDefaultAgentsFileContent,
  buildDefaultReportIndex,
  buildDefaultWorkspaceAppState,
  buildDefaultWorkspaceIndex,
  buildDefaultWorkspaceReport,
  buildDefaultWorkspaceToolCatalog,
  buildReportPath,
  RESERVED_WORKSPACE_DIRECTORIES,
  WORKSPACE_AGENTS_PATH,
  WORKSPACE_APP_STATE_PATH,
  WORKSPACE_CHART_ARTIFACTS_DIR,
  WORKSPACE_CONTRACT_VERSION,
  WORKSPACE_DATA_ARTIFACTS_DIR,
  WORKSPACE_INDEX_PATH,
  WORKSPACE_PDF_ARTIFACTS_DIR,
  WORKSPACE_REPORT_INDEX_PATH,
  WORKSPACE_TOOL_CATALOG_PATH,
  type AgentsFileSummary,
} from "../types/workspace-contract";
import {
  ensureDirectoryPath,
  getDirectoryByPath,
  normalizeAbsolutePath,
  resolveWorkspacePath,
} from "./workspace-fs";
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
  const normalizedPath = normalizeAbsolutePath(path);
  return (
    filesystem.items.find(
      (item): item is WorkspaceFileNode =>
        item.kind === "file" && item.path === normalizedPath,
    ) ?? null
  );
}

function listAllFileNodes(filesystem: WorkspaceFilesystem): WorkspaceFileNode[] {
  return filesystem.items.filter((item): item is WorkspaceFileNode => item.kind === "file");
}

function upsertTextFile(
  filesystem: WorkspaceFilesystem,
  path: string,
  text: string,
  source: WorkspaceFileNode["source"],
): WorkspaceFilesystem {
  const normalizedPath = normalizeAbsolutePath(path);
  const parts = normalizedPath.split("/").filter(Boolean);
  const filename = parts.at(-1) ?? "untitled";
  const parentPath = parts.length > 1 ? `/${parts.slice(0, -1).join("/")}` : "/";
  const withDirectory = ensureDirectoryPath(filesystem, parentPath).filesystem;
  const parentDirectory = getDirectoryByPath(withDirectory, parentPath);
  const existing = findFileNodeByPath(withDirectory, normalizedPath);
  if (
    existing?.file.kind === "other" &&
    existing.file.text_content === text &&
    existing.file.name === filename
  ) {
    return withDirectory;
  }
  const nextItems = withDirectory.items.filter((item) => item.id !== existing?.id);
  const baseFile = buildTextFile(normalizedPath, text);
  const nextFile: LocalWorkspaceFile = {
    ...baseFile,
    id: existing?.file.id ?? baseFile.id,
    name: filename,
  };

  nextItems.push({
    id: existing?.id ?? nextFile.id,
    kind: "file",
    name: filename,
    path: normalizedPath,
    parent_id: parentDirectory.id,
    created_at: existing?.created_at ?? nowIso(),
    source: existing?.source ?? source,
    file: nextFile,
  });

  return {
    ...withDirectory,
    items: nextItems,
  };
}

function removeFileByPath(
  filesystem: WorkspaceFilesystem,
  path: string,
): WorkspaceFilesystem {
  const normalizedPath = normalizeAbsolutePath(path);
  return {
    ...filesystem,
    items: filesystem.items.filter(
      (item) => !(item.kind === "file" && item.path === normalizedPath),
    ),
  };
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
  return parseJsonDocument<WorkspaceReportV1>(
    filesystem,
    buildReportPath(reportId),
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

export function ensureWorkspaceContractFilesystem(
  filesystem: WorkspaceFilesystem,
  options: {
    capabilityId: string;
    capabilityTitle: string;
    defaultGoal: string;
    activeWorkspaceTab: string;
    executionMode: "interactive" | "batch";
    toolNames?: string[];
    cwdPathBySurface?: Record<string, string>;
  },
): WorkspaceFilesystem {
  let nextFilesystem = filesystem;

  for (const directoryPath of RESERVED_WORKSPACE_DIRECTORIES) {
    nextFilesystem = ensureDirectoryPath(nextFilesystem, directoryPath).filesystem;
  }

  let appState =
    readWorkspaceAppState(nextFilesystem) ??
    buildDefaultWorkspaceAppState({
      active_capability_id: options.capabilityId,
      active_workspace_tab: options.activeWorkspaceTab,
      execution_mode: options.executionMode,
      current_goal: options.defaultGoal,
      current_cwd_by_surface: options.cwdPathBySurface ?? {},
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
    current_cwd_by_surface: {
      ...(appState.current_cwd_by_surface ?? {}),
      ...(options.cwdPathBySurface ?? {}),
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
      current_cwd_by_surface: {
        ...current.current_cwd_by_surface,
        ...(patch.current_cwd_by_surface ?? {}),
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

export function replaceWorkspaceReportItems(
  filesystem: WorkspaceFilesystem,
  reportId: string,
  items: ReportItemV1[],
): WorkspaceFilesystem {
  const current =
    readWorkspaceReport(filesystem, reportId) ??
    buildDefaultWorkspaceReport({ reportId });
  return writeWorkspaceReport(
    filesystem,
    {
      ...current,
      items,
      updated_at: nowIso(),
    },
    "derived",
  );
}

export function appendWorkspaceReportItems(
  filesystem: WorkspaceFilesystem,
  reportId: string,
  items: ReportItemV1[],
): WorkspaceFilesystem {
  if (!items.length) {
    return filesystem;
  }
  const current =
    readWorkspaceReport(filesystem, reportId) ??
    buildDefaultWorkspaceReport({ reportId });
  return writeWorkspaceReport(
    filesystem,
    {
      ...current,
      items: [...current.items, ...items],
      updated_at: nowIso(),
    },
    "derived",
  );
}

export function effectsToReportItems(effects: ClientEffect[]): ReportItemV1[] {
  return effects.map((effect, index) => {
    const createdAt = nowIso();
    if (effect.type === "report_section_appended") {
      return {
        id: `section-${index}-${createdAt}`,
        type: "section",
        created_at: createdAt,
        title: effect.title,
        markdown: effect.markdown,
      };
    }
    if (effect.type === "chart_rendered") {
      return {
        id: `chart-${effect.chartPlanId}-${createdAt}`,
        type: "chart",
        created_at: createdAt,
        title: effect.chart.title,
        file_id: effect.fileId,
        chart_plan_id: effect.chartPlanId,
        chart: effect.chart as Record<string, unknown>,
        image_data_url: effect.imageDataUrl ?? null,
      };
    }
    return {
      id: `pdf-${effect.archiveFileId}-${createdAt}`,
      type: "pdf_split",
      created_at: createdAt,
      source_file_id: effect.sourceFileId,
      source_file_name: effect.sourceFileName,
      archive_file_id: effect.archiveFileId,
      archive_file_name: effect.archiveFileName,
      index_file_id: effect.indexFileId,
      index_file_name: effect.indexFileName,
      entries: effect.entries.map((entry) => ({
        file_id: entry.fileId,
        name: entry.name,
        title: entry.title,
        start_page: entry.startPage,
        end_page: entry.endPage,
        page_count: entry.pageCount,
      })),
      markdown: effect.markdown,
    };
  });
}

export function reportItemsToEffects(items: ReportItemV1[]): ClientEffect[] {
  return items.reduce<ClientEffect[]>((effects, item) => {
    if (item.type === "section") {
      effects.push({
        type: "report_section_appended",
        title: item.title,
        markdown: item.markdown,
      });
      return effects;
    }
    if (item.type === "chart") {
      effects.push({
        type: "chart_rendered",
        fileId: item.file_id,
        chartPlanId: item.chart_plan_id,
        chart: item.chart as never,
        imageDataUrl: item.image_data_url ?? undefined,
        rows: [],
      });
      return effects;
    }
    if (item.type === "pdf_split") {
      effects.push({
        type: "pdf_smart_split_completed",
        sourceFileId: item.source_file_id,
        sourceFileName: item.source_file_name,
        archiveFileId: item.archive_file_id,
        archiveFileName: item.archive_file_name,
        indexFileId: item.index_file_id,
        indexFileName: item.index_file_name,
        entries: item.entries.map((entry) => ({
          fileId: entry.file_id,
          name: entry.name,
          title: entry.title,
          startPage: entry.start_page,
          endPage: entry.end_page,
          pageCount: entry.page_count,
        })),
        markdown: item.markdown,
      });
      return effects;
    }
    return effects;
  }, []);
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
  return removeFileByPath(filesystem, path);
}
