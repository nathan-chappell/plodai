import type { LocalDataset, LocalImageFile, LocalOtherFile, LocalPdfFile, LocalWorkspaceFile } from "./report";
import type { WorkspaceReportV1 } from "./workspace-contract";

export type SharedExportKind =
  | "dataset"
  | "chart"
  | "document"
  | "image"
  | "report"
  | "text"
  | "blob";

export type AgentResourceOrigin = "uploaded" | "generated";
export type SharedExportVisibility = "shared";

export type DatasetResourcePayload = {
  type: "dataset";
  file: LocalDataset;
};

export type ChartResourcePayload = {
  type: "chart";
  file: LocalOtherFile;
};

export type DocumentResourcePayload = {
  type: "document";
  file: LocalPdfFile | LocalOtherFile;
};

export type ImageResourcePayload = {
  type: "image";
  file: LocalImageFile;
};

export type ReportResourcePayload = {
  type: "report";
  report: WorkspaceReportV1;
};

export type TextResourcePayload = {
  type: "text";
  file: LocalOtherFile;
};

export type BlobResourcePayload = {
  type: "blob";
  file: LocalOtherFile;
};

export type AgentResourcePayload =
  | DatasetResourcePayload
  | ChartResourcePayload
  | DocumentResourcePayload
  | ImageResourcePayload
  | ReportResourcePayload
  | TextResourcePayload
  | BlobResourcePayload;

export type AgentResourceRecord = {
  id: string;
  owner_agent_id: string;
  origin: AgentResourceOrigin;
  kind: SharedExportKind;
  title: string;
  created_at: string;
  summary: string | null;
  visibility: SharedExportVisibility;
  payload: AgentResourcePayload;
};

export type AgentShellState = {
  version: "v1";
  goal: string | null;
  active_tab: string | null;
  current_report_id: string | null;
  resources: AgentResourceRecord[];
};

export type WorkspaceContextRecord = {
  id: string;
  name: string;
  selected_agent_id: string;
  states_by_agent_id: Record<string, AgentShellState>;
  created_at: string;
  updated_at: string;
};

export type AgentShellSummary = {
  agent_id: string;
  goal: string | null;
  resource_count: number;
  current_report_id: string | null;
};

export type SharedExportSummary = {
  id: string;
  owner_agent_id: string;
  origin: AgentResourceOrigin;
  kind: SharedExportKind;
  title: string;
  created_at: string;
  summary: string | null;
  payload_ref: string;
  extension?: string;
  mime_type?: string;
  byte_size?: number;
  row_count?: number;
  columns?: string[];
  numeric_columns?: string[];
  sample_rows?: Array<Record<string, unknown>>;
  page_count?: number;
  width?: number;
  height?: number;
  slide_count?: number;
};

export type ShellStateMetadata = {
  version: "v1";
  context_id: string;
  context_name: string;
  active_agent_id: string;
  agents: AgentShellSummary[];
  resources: SharedExportSummary[];
};

export type AgentPreviewKind =
  | "dataset_table"
  | "chart_image"
  | "document_pdf"
  | "image"
  | "report"
  | "markdown"
  | "json"
  | "download_only";

export type AgentPreviewItem = {
  id: string;
  resource_id: string;
  kind: AgentPreviewKind;
  title: string;
  summary: string | null;
  created_at: string;
};

export type AgentPreviewModel = {
  agent_id: string;
  title: string;
  items: AgentPreviewItem[];
};

export function isLocalWorkspaceFile(value: unknown): value is LocalWorkspaceFile {
  return Boolean(
    value &&
      typeof value === "object" &&
      "kind" in value &&
      "id" in value &&
      "name" in value,
  );
}
