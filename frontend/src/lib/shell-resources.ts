import { parseSavedChartArtifact, savedChartArtifactLabel } from "./chart-artifacts";
import { formatByteSize } from "./workspace-artifacts";
import { getFileExtension } from "./workspace-files";
import type { LocalOtherFile, LocalWorkspaceFile } from "../types/report";
import type {
  AgentResourcePayload,
  AgentResourceRecord,
  AgentResourceOrigin,
  AgentShellState,
  AgentShellSummary,
  AgentPreviewItem,
  AgentPreviewKind,
  AgentPreviewModel,
  BlobResourcePayload,
  ChartResourcePayload,
  DatasetResourcePayload,
  DocumentResourcePayload,
  ImageResourcePayload,
  ReportResourcePayload,
  SharedExportKind,
  SharedExportSummary,
  TextResourcePayload,
} from "../types/shell";

function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyAgentShellState(): AgentShellState {
  return {
    version: "v1",
    goal: null,
    active_tab: null,
    current_report_id: null,
    resources: [],
  };
}

export function normalizeAgentShellState(
  value: AgentShellState | null | undefined,
): AgentShellState {
  if (!value) {
    return createEmptyAgentShellState();
  }
  return {
    version: "v1",
    goal: typeof value.goal === "string" && value.goal.trim() ? value.goal : null,
    active_tab:
      typeof value.active_tab === "string" && value.active_tab.trim()
        ? value.active_tab
        : null,
    current_report_id:
      typeof value.current_report_id === "string" && value.current_report_id.trim()
        ? value.current_report_id
        : null,
    resources: [...value.resources].sort(compareResources),
  };
}

export function compareResources(
  left: AgentResourceRecord,
  right: AgentResourceRecord,
): number {
  return (
    right.created_at.localeCompare(left.created_at) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

export function sortResources(
  resources: AgentResourceRecord[],
): AgentResourceRecord[] {
  return [...resources].sort(compareResources);
}

export function replaceAgentResources(
  state: AgentShellState,
  resources: AgentResourceRecord[],
): AgentShellState {
  return {
    ...normalizeAgentShellState(state),
    resources: sortResources(resources),
    current_report_id: deriveCurrentReportId(resources, state.current_report_id),
  };
}

export function upsertAgentResource(
  state: AgentShellState,
  resource: AgentResourceRecord,
): AgentShellState {
  const normalized = normalizeAgentShellState(state);
  const nextResources = [
    resource,
    ...normalized.resources.filter((current) => current.id !== resource.id),
  ];
  return {
    ...normalized,
    resources: sortResources(nextResources),
    current_report_id: deriveCurrentReportId(nextResources, normalized.current_report_id),
  };
}

export function removeAgentResource(
  state: AgentShellState,
  resourceId: string,
): AgentShellState {
  const normalized = normalizeAgentShellState(state);
  const nextResources = normalized.resources.filter((resource) => resource.id !== resourceId);
  return {
    ...normalized,
    resources: nextResources,
    current_report_id: deriveCurrentReportId(nextResources, normalized.current_report_id),
  };
}

function deriveCurrentReportId(
  resources: AgentResourceRecord[],
  preferredReportId: string | null | undefined,
): string | null {
  const reportIds = resources
    .filter((resource): resource is AgentResourceRecord & { payload: ReportResourcePayload } => resource.kind === "report")
    .map((resource) => resource.payload.report.report_id);
  if (preferredReportId && reportIds.includes(preferredReportId)) {
    return preferredReportId;
  }
  return reportIds[0] ?? null;
}

export function listAgentReports(state: AgentShellState): Array<ReportResourcePayload["report"]> {
  return normalizeAgentShellState(state).resources
    .filter((resource): resource is AgentResourceRecord & { payload: ReportResourcePayload } => resource.kind === "report")
    .map((resource) => resource.payload.report)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function findAgentResource(
  state: AgentShellState,
  resourceId: string,
): AgentResourceRecord | null {
  return normalizeAgentShellState(state).resources.find((resource) => resource.id === resourceId) ?? null;
}

export function summarizeAgentShellState(
  agentId: string,
  state: AgentShellState,
): AgentShellSummary {
  const normalized = normalizeAgentShellState(state);
  return {
    agent_id: agentId,
    goal: normalized.goal,
    resource_count: normalized.resources.length,
    current_report_id: normalized.current_report_id,
  };
}

export function resourceFile(
  resource: AgentResourceRecord,
): LocalWorkspaceFile | null {
  switch (resource.payload.type) {
    case "dataset":
    case "chart":
    case "document":
    case "image":
    case "text":
    case "blob":
      return resource.payload.file;
    case "report":
      return null;
  }
}

export function buildResourceFromFile(
  ownerAgentId: string,
  file: LocalWorkspaceFile,
  options: {
    origin?: AgentResourceOrigin;
  } = {},
): AgentResourceRecord {
  const kind = resourceKindForFile(file);
  const title = kind === "chart" ? savedChartArtifactLabel(file) ?? file.name : file.name;
  return {
    id: file.id,
    owner_agent_id: ownerAgentId,
    origin: options.origin ?? "generated",
    kind,
    title,
    created_at: nowIso(),
    summary: summarizeFileForResource(file),
    visibility: "shared",
    payload: buildPayloadFromFile(kind, file),
  };
}

function buildPayloadFromFile(
  kind: SharedExportKind,
  file: LocalWorkspaceFile,
): AgentResourcePayload {
  if (kind === "dataset" && (file.kind === "csv" || file.kind === "json")) {
    return { type: "dataset", file } satisfies DatasetResourcePayload;
  }
  if (kind === "chart" && file.kind === "other") {
    return { type: "chart", file } satisfies ChartResourcePayload;
  }
  if (kind === "document" && (file.kind === "pdf" || file.kind === "other")) {
    return { type: "document", file } satisfies DocumentResourcePayload;
  }
  if (kind === "image" && file.kind === "image") {
    return { type: "image", file } satisfies ImageResourcePayload;
  }
  if (kind === "text" && file.kind === "other") {
    return { type: "text", file } satisfies TextResourcePayload;
  }
  return { type: "blob", file: file as LocalOtherFile } satisfies BlobResourcePayload;
}

export function buildReportResource(
  ownerAgentId: string,
  report: ReportResourcePayload["report"],
): AgentResourceRecord {
  return {
    id: report.report_id,
    owner_agent_id: ownerAgentId,
    origin: "generated",
    kind: "report",
    title: report.title,
    created_at: report.updated_at,
    summary:
      report.slides.length === 1
        ? "1 slide"
        : `${report.slides.length} slides`,
    visibility: "shared",
    payload: {
      type: "report",
      report,
    },
  };
}

export function resourceKindForFile(file: LocalWorkspaceFile): SharedExportKind {
  if (file.kind === "csv" || file.kind === "json") {
    return "dataset";
  }
  if (file.kind === "pdf") {
    return "document";
  }
  if (file.kind === "image") {
    return "image";
  }
  if (parseSavedChartArtifact(file)) {
    return "chart";
  }
  if (file.kind === "other" && (file.text_content != null || file.extension === "md")) {
    return "text";
  }
  return "blob";
}

export function summarizeFileForResource(file: LocalWorkspaceFile): string | null {
  if (file.kind === "csv" || file.kind === "json") {
    return `${file.row_count} rows · ${file.columns.length} columns`;
  }
  if (file.kind === "pdf") {
    return file.page_count === 1 ? "1 page" : `${file.page_count} pages`;
  }
  if (file.kind === "image") {
    return `${file.width} x ${file.height}`;
  }
  if (file.kind === "other") {
    if (parseSavedChartArtifact(file)) {
      return "Saved chart";
    }
    if (file.text_content != null) {
      return `${Math.min(file.text_content.length, 4000)} chars`;
    }
  }
  return typeof file.byte_size === "number" ? formatByteSize(file.byte_size) : null;
}

export function summarizeSharedExport(
  resource: AgentResourceRecord,
): SharedExportSummary {
  const file = resourceFile(resource);
  return {
    id: resource.id,
    owner_agent_id: resource.owner_agent_id,
    origin: resource.origin,
    kind: resource.kind,
    title: resource.title,
    created_at: resource.created_at,
    summary: resource.summary,
    payload_ref: resource.id,
    ...(file
      ? {
          extension: file.extension,
          mime_type: file.mime_type,
          byte_size: file.byte_size,
        }
      : {}),
    ...(resource.payload.type === "dataset"
      ? {
          row_count: resource.payload.file.row_count,
          columns: resource.payload.file.columns,
          numeric_columns: resource.payload.file.numeric_columns,
          sample_rows: resource.payload.file.sample_rows,
        }
      : {}),
    ...(resource.payload.type === "document" && resource.payload.file.kind === "pdf"
      ? {
          page_count: resource.payload.file.page_count,
        }
      : {}),
    ...(resource.payload.type === "image"
      ? {
          width: resource.payload.file.width,
          height: resource.payload.file.height,
        }
      : {}),
    ...(resource.payload.type === "report"
      ? {
          slide_count: resource.payload.report.slides.length,
        }
      : {}),
  };
}

export function buildAgentPreviewModel(args: {
  agentId: string;
  title: string;
  resources: AgentResourceRecord[];
}): AgentPreviewModel {
  return {
    agent_id: args.agentId,
    title: args.title,
    items: sortResources(args.resources).map((resource) => ({
      id: resource.id,
      resource_id: resource.id,
      kind: previewKindForResource(resource),
      title: resource.title,
      summary: resource.summary,
      created_at: resource.created_at,
    })),
  };
}

function previewKindForResource(resource: AgentResourceRecord): AgentPreviewKind {
  const file = resourceFile(resource);

  switch (resource.kind) {
    case "dataset":
      return "dataset_table";
    case "chart":
      return "chart_image";
    case "document":
      return file?.kind === "pdf" ? "document_pdf" : "download_only";
    case "image":
      return "image";
    case "report":
      return "report";
    case "text":
      return file?.kind === "other" && file.extension === "json" ? "json" : "markdown";
    case "blob":
      return "download_only";
  }
}

export function listFileResources(
  resources: AgentResourceRecord[],
): LocalWorkspaceFile[] {
  return sortResources(resources)
    .map((resource) => resourceFile(resource))
    .filter((file): file is LocalWorkspaceFile => file !== null);
}

export function isUploadedResource(resource: AgentResourceRecord): boolean {
  return resource.origin === "uploaded";
}

export function isGeneratedResource(resource: AgentResourceRecord): boolean {
  return resource.origin === "generated";
}

export function coerceResourceTitle(
  resource: AgentResourceRecord,
): string {
  const file = resourceFile(resource);
  if (!file) {
    return resource.title;
  }
  if (resource.kind === "chart") {
    return savedChartArtifactLabel(file) ?? resource.title;
  }
  return resource.title || file.name;
}

export function renameResourceFile(
  resource: AgentResourceRecord,
  name: string,
): AgentResourceRecord {
  const file = resourceFile(resource);
  if (!file) {
    return resource;
  }
  const renamedFile = {
    ...file,
    name,
    extension: getFileExtension(name),
  } as LocalWorkspaceFile;
  return {
    ...resource,
    title: name,
    payload: buildPayloadFromFile(resource.kind, renamedFile),
  };
}
