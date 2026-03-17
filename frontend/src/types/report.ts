import type { ClientChartSpec, DataRow } from "./analysis";

export type WorkspaceFileKind = "csv" | "json" | "pdf" | "other";

export type WorkspaceFileSummary = {
  id: string;
  name: string;
  kind: WorkspaceFileKind;
  extension: string;
  byte_size?: number;
  mime_type?: string;
};

export type TabularFileSummary = WorkspaceFileSummary & {
  kind: "csv" | "json";
  row_count: number;
  columns: string[];
  numeric_columns: string[];
  sample_rows: DataRow[];
};

export type DatasetSummary = WorkspaceFileSummary & {
  kind: "csv";
  row_count: number;
  columns: string[];
  numeric_columns: string[];
  sample_rows: DataRow[];
};

export type LocalDataset = DatasetSummary & {
  rows: DataRow[];
  preview_rows: DataRow[];
};

export type LocalJsonFile = TabularFileSummary & {
  kind: "json";
  rows: DataRow[];
  preview_rows: DataRow[];
  json_text: string;
};

export type LocalPdfFile = WorkspaceFileSummary & {
  kind: "pdf";
  page_count: number;
  bytes_base64: string;
};

export type LocalOtherFile = WorkspaceFileSummary & {
  kind: "other";
  text_content?: string;
  bytes_base64?: string;
};

export type LocalChartableFile = LocalDataset | LocalJsonFile;
export type LocalWorkspaceFile = LocalDataset | LocalJsonFile | LocalPdfFile | LocalOtherFile;

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
  file_id?: string | null;
  chart_plan_id?: string | null;
};

export type ToolEvent = {
  tool: string;
  detail: string;
};
