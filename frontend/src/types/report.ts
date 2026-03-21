import type { ClientChartSpec, DataRow } from "./analysis";

export type WorkspaceFileKind = "csv" | "json" | "pdf" | "image" | "other";
export type DatasetKind = "csv" | "json";

export type WorkspaceFileSummary = {
  id: string;
  name: string;
  kind: WorkspaceFileKind;
  extension: string;
  byte_size?: number;
  mime_type?: string;
};

export type DatasetSummary = WorkspaceFileSummary & {
  kind: DatasetKind;
  row_count: number;
  columns: string[];
  numeric_columns: string[];
  sample_rows: DataRow[];
};

export type LocalDataset = DatasetSummary & {
  rows: DataRow[];
  preview_rows: DataRow[];
  json_text?: string;
};

export type LocalPdfFile = WorkspaceFileSummary & {
  kind: "pdf";
  page_count: number;
  bytes_base64: string;
};

export type LocalImageFile = WorkspaceFileSummary & {
  kind: "image";
  width: number;
  height: number;
  bytes_base64: string;
};

export type LocalOtherFile = WorkspaceFileSummary & {
  kind: "other";
  text_content?: string;
  bytes_base64?: string;
};

export type LocalWorkspaceFile =
  | LocalDataset
  | LocalPdfFile
  | LocalImageFile
  | LocalOtherFile;

export type ReportSection = {
  id: string;
  title: string;
  markdown: string;
};

export type ReportChart = {
  id: string;
  title: string;
  chart_type: string;
  spec: ClientChartSpec | Record<string, unknown>;
  image_data_url?: string | null;
  dataset_id?: string | null;
  chart_plan_id?: string | null;
};

export type ToolEvent = {
  tool: string;
  detail: string;
};
