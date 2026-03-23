export const WORKSPACE_CONTRACT_VERSION = "v1" as const;

export const WORKSPACE_ARTIFACT_BUCKET_VALUES = [
  "uploaded",
  "data",
  "chart",
  "pdf",
] as const;

export const REPORT_ITEM_TYPE_VALUES = [
  "section",
  "chart",
  "pdf_split",
  "note",
  "tool_result",
] as const;
export const REPORT_SLIDE_LAYOUT_VALUES = ["1x1", "1x2", "2x2"] as const;
export const REPORT_SLIDE_PANEL_TYPE_VALUES = ["narrative", "chart", "image"] as const;

export type WorkspaceContractVersion = typeof WORKSPACE_CONTRACT_VERSION;
export type WorkspaceArtifactBucket = (typeof WORKSPACE_ARTIFACT_BUCKET_VALUES)[number];
export type ReportItemType = (typeof REPORT_ITEM_TYPE_VALUES)[number];
export type ReportSlideLayout = (typeof REPORT_SLIDE_LAYOUT_VALUES)[number];
export type ReportSlidePanelType = (typeof REPORT_SLIDE_PANEL_TYPE_VALUES)[number];

export type WorkspaceAppStateV1 = {
  version: WorkspaceContractVersion;
  app_id: string | null;
  active_workspace_tab: string | null;
  current_report_id: string | null;
  current_goal: string | null;
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
  dataset_id: string;
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

export type ReportNarrativePanelV1 = {
  id: string;
  type: "narrative";
  title: string;
  markdown: string;
};

export type ReportChartPanelV1 = {
  id: string;
  type: "chart";
  title: string;
  dataset_id: string;
  chart_plan_id: string;
  chart: Record<string, unknown>;
  image_data_url?: string | null;
};

export type ReportImagePanelV1 = {
  id: string;
  type: "image";
  title: string;
  file_id: string;
  image_data_url?: string | null;
  alt_text?: string | null;
};

export type ReportSlidePanelV1 =
  | ReportNarrativePanelV1
  | ReportChartPanelV1
  | ReportImagePanelV1;

export type ReportSlideV1 = {
  id: string;
  created_at: string;
  title: string;
  layout: ReportSlideLayout;
  panels: ReportSlidePanelV1[];
};

export type WorkspaceLegacyReportV1 = {
  version: WorkspaceContractVersion;
  report_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  items: ReportItemV1[];
};

export type WorkspaceReportV1 = {
  version: WorkspaceContractVersion;
  report_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  slides: ReportSlideV1[];
};

export type WorkspaceToolCatalogV1 = {
  version: WorkspaceContractVersion;
  agent_id: string | null;
  tool_names: string[];
};

export type WorkspaceIndexV1 = {
  version: WorkspaceContractVersion;
  report_ids: string[];
  current_report_id: string | null;
};

export type AgentsFileSummary = {
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
    app_id: defaults.app_id ?? null,
    active_workspace_tab: defaults.active_workspace_tab ?? null,
    current_report_id: defaults.current_report_id ?? null,
    current_goal: defaults.current_goal ?? null,
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
    report_ids: defaults.report_ids ?? [],
    current_report_id: defaults.current_report_id ?? null,
  };
}

export function buildDefaultWorkspaceToolCatalog(
  defaults: Partial<Omit<WorkspaceToolCatalogV1, "version">> = {},
): WorkspaceToolCatalogV1 {
  return {
    version: WORKSPACE_CONTRACT_VERSION,
    agent_id: defaults.agent_id ?? null,
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
    title: defaultWorkspaceReportTitle({
      reportId,
      title: options?.title,
    }),
    created_at: createdAt,
    updated_at: createdAt,
    slides: [],
  };
}

function defaultWorkspaceReportTitle(options: {
  reportId: string;
  title?: string;
}): string {
  const explicitTitle = options.title?.trim();
  if (explicitTitle) {
    return explicitTitle;
  }

  if (options.reportId === "report" || /^report-\d+$/.test(options.reportId)) {
    return "Workspace report";
  }

  return options.reportId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeReportId(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const normalized = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "report";
}

export function buildDefaultAgentsFileContent(options: {
  agentTitle: string;
  currentGoal: string;
}): string {
  return [
    "# Workspace Guide",
    "",
    `Workspace contract version: ${WORKSPACE_CONTRACT_VERSION}`,
    "Do not progress this workspace contract to v2 until the user explicitly says so.",
    `This workspace is shared across tools. Use the active tool together with the ${options.agentTitle} workflow.`,
    "",
    "## Current Objective",
    options.currentGoal.trim() || "No explicit objective has been recorded yet.",
    "",
    "## Notes",
    "- /AGENTS.md is represented as structured workspace metadata, not a visible artifact.",
    "- Reports, tool catalog state, and smart split registry are stored as structured workspace state.",
    "- Visible artifacts are grouped into logical buckets: uploaded, data, chart, and pdf.",
    "",
  ].join("\n");
}
