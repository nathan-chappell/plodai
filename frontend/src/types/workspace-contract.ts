export const WORKSPACE_CONTRACT_VERSION = "v1" as const;

export const WORKSPACE_AGENTS_PATH = "/AGENTS.md" as const;
export const WORKSPACE_SYSTEM_DIR = "/.system" as const;
export const WORKSPACE_SYSTEM_VERSION_DIR = "/.system/v1" as const;
export const WORKSPACE_APP_STATE_PATH = "/.system/v1/app-state.json" as const;
export const WORKSPACE_TOOL_CATALOG_PATH = "/.system/v1/tool-catalog.json" as const;
export const WORKSPACE_INDEX_PATH = "/.system/v1/workspace-index.json" as const;
export const WORKSPACE_REPORTS_DIR = "/reports" as const;
export const WORKSPACE_REPORT_INDEX_PATH = "/reports/index.json" as const;
export const WORKSPACE_ARTIFACTS_DIR = "/artifacts" as const;
export const WORKSPACE_DATA_ARTIFACTS_DIR = "/artifacts/data" as const;
export const WORKSPACE_CHART_ARTIFACTS_DIR = "/artifacts/charts" as const;
export const WORKSPACE_PDF_ARTIFACTS_DIR = "/artifacts/pdf" as const;

export const RESERVED_WORKSPACE_DIRECTORIES = [
  WORKSPACE_SYSTEM_DIR,
  WORKSPACE_SYSTEM_VERSION_DIR,
  WORKSPACE_REPORTS_DIR,
  WORKSPACE_ARTIFACTS_DIR,
  WORKSPACE_DATA_ARTIFACTS_DIR,
  WORKSPACE_CHART_ARTIFACTS_DIR,
  WORKSPACE_PDF_ARTIFACTS_DIR,
] as const;

export const REPORT_ITEM_TYPE_VALUES = [
  "section",
  "chart",
  "pdf_split",
  "note",
  "tool_result",
] as const;

export type WorkspaceContractVersion = typeof WORKSPACE_CONTRACT_VERSION;
export type ReportItemType = (typeof REPORT_ITEM_TYPE_VALUES)[number];

export type WorkspaceAppStateV1 = {
  version: WorkspaceContractVersion;
  active_capability_id: string | null;
  active_workspace_tab: string | null;
  execution_mode: "interactive" | "batch";
  current_report_id: string | null;
  current_goal: string | null;
  current_prefix_by_surface: Record<string, string>;
};

export type WorkspaceReportIndexV1 = {
  version: WorkspaceContractVersion;
  report_ids: string[];
  current_report_id: string | null;
};

export type ReportSectionItemV1 = {
  id: string;
  type: "section";
  created_at: string;
  title: string;
  markdown: string;
};

export type ReportChartItemV1 = {
  id: string;
  type: "chart";
  created_at: string;
  title: string;
  file_id: string;
  chart_plan_id: string;
  chart: Record<string, unknown>;
  image_data_url?: string | null;
};

export type ReportPdfSplitEntryV1 = {
  file_id: string;
  name: string;
  title: string;
  start_page: number;
  end_page: number;
  page_count: number;
};

export type ReportPdfSplitItemV1 = {
  id: string;
  type: "pdf_split";
  created_at: string;
  source_file_id: string;
  source_file_name: string;
  archive_file_id: string;
  archive_file_name: string;
  index_file_id: string;
  index_file_name: string;
  entries: ReportPdfSplitEntryV1[];
  markdown: string;
};

export type ReportNoteItemV1 = {
  id: string;
  type: "note";
  created_at: string;
  title: string;
  text: string;
};

export type ReportToolResultItemV1 = {
  id: string;
  type: "tool_result";
  created_at: string;
  tool_name: string;
  title: string;
  payload: Record<string, unknown>;
};

export type ReportItemV1 =
  | ReportSectionItemV1
  | ReportChartItemV1
  | ReportPdfSplitItemV1
  | ReportNoteItemV1
  | ReportToolResultItemV1;

export type WorkspaceReportV1 = {
  version: WorkspaceContractVersion;
  report_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  items: ReportItemV1[];
};

export type WorkspaceToolCatalogV1 = {
  version: WorkspaceContractVersion;
  capability_id: string | null;
  tool_names: string[];
};

export type WorkspaceIndexV1 = {
  version: WorkspaceContractVersion;
  reserved_paths: string[];
  report_ids: string[];
  current_report_id: string | null;
};

export type AgentsFileSummary = {
  path: string;
  present: boolean;
  text: string | null;
};

export type WorkspaceBootstrapMetadata = {
  contract_version: WorkspaceContractVersion;
  agents_file: AgentsFileSummary;
  current_goal: string | null;
  current_report_id: string | null;
  report_ids: string[];
};

export function buildDefaultWorkspaceAppState(
  defaults: Partial<Omit<WorkspaceAppStateV1, "version">> = {},
): WorkspaceAppStateV1 {
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    active_capability_id: defaults.active_capability_id ?? null,
    active_workspace_tab: defaults.active_workspace_tab ?? null,
    execution_mode: defaults.execution_mode ?? "interactive",
    current_report_id: defaults.current_report_id ?? null,
    current_goal: defaults.current_goal ?? null,
    current_prefix_by_surface: defaults.current_prefix_by_surface ?? {},
  };
}

export function buildDefaultReportIndex(
  defaults: Partial<Omit<WorkspaceReportIndexV1, "version">> = {},
): WorkspaceReportIndexV1 {
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    report_ids: defaults.report_ids ?? [],
    current_report_id: defaults.current_report_id ?? null,
  };
}

export function buildDefaultWorkspaceIndex(
  defaults: Partial<Omit<WorkspaceIndexV1, "version">> = {},
): WorkspaceIndexV1 {
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    reserved_paths: defaults.reserved_paths ?? [
      WORKSPACE_AGENTS_PATH,
      WORKSPACE_APP_STATE_PATH,
      WORKSPACE_TOOL_CATALOG_PATH,
      WORKSPACE_INDEX_PATH,
      WORKSPACE_REPORT_INDEX_PATH,
      WORKSPACE_DATA_ARTIFACTS_DIR,
      WORKSPACE_CHART_ARTIFACTS_DIR,
      WORKSPACE_PDF_ARTIFACTS_DIR,
    ],
    report_ids: defaults.report_ids ?? [],
    current_report_id: defaults.current_report_id ?? null,
  };
}

export function buildDefaultWorkspaceToolCatalog(
  defaults: Partial<Omit<WorkspaceToolCatalogV1, "version">> = {},
): WorkspaceToolCatalogV1 {
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    capability_id: defaults.capability_id ?? null,
    tool_names: defaults.tool_names ?? [],
  };
}

export function buildDefaultWorkspaceReport(options?: {
  reportId?: string;
  title?: string;
  createdAt?: string;
}): WorkspaceReportV1 {
  const reportId = normalizeReportId(options?.reportId ?? "report-1");
  const createdAt = options?.createdAt ?? new Date().toISOString();
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    report_id: reportId,
    title: options?.title ?? "Current report",
    created_at: createdAt,
    updated_at: createdAt,
    items: [],
  };
}

export function normalizeReportId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "report-1";
}

export function buildReportPath(reportId: string): string {
  return `${WORKSPACE_REPORTS_DIR}/${normalizeReportId(reportId)}.json`;
}

export function extractReportIdFromPath(path: string): string | null {
  if (!path.startsWith(`${WORKSPACE_REPORTS_DIR}/`) || !path.endsWith(".json")) {
    return null;
  }
  const basename = path.slice(`${WORKSPACE_REPORTS_DIR}/`.length, -".json".length).trim();
  return basename ? basename : null;
}

export function buildDefaultAgentsFileContent(options: {
  capabilityTitle: string;
  currentGoal: string;
}): string {
  return [
    "# AGENTS.md",
    "",
    `Workspace contract version: ${WORKSPACE_CONTRACT_VERSION}`,
    "",
    "Do not progress this workspace contract to v2 until the user explicitly says so.",
    "",
    "Reserved conventions:",
    "- /AGENTS.md is the primary guidance artifact.",
    "- /.system/v1/app-state.json stores durable app state relevant to tools and agents.",
    "- /reports/index.json tracks report ids and the current report.",
    "- /reports/{report_id}.json stores structured report items.",
    "- /artifacts/* stores derived capability outputs.",
    "",
    `Current capability: ${options.capabilityTitle}`,
    "",
    "## Current Objective",
    options.currentGoal.trim() || "No explicit objective has been recorded yet.",
    "",
  ].join("\n");
}
