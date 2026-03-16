import type { ClientChartSpec } from "./analysis";

export type WorkspaceFileKind = "csv" | "pdf" | "other";

export type WorkspaceFileSummary = {
  id: string;
  name: string;
  kind: WorkspaceFileKind;
  extension: string;
  byte_size?: number;
  mime_type?: string;
};

export type DatasetSummary = WorkspaceFileSummary & {
  kind: "csv";
  row_count: number;
  columns: string[];
  numeric_columns: string[];
  sample_rows: Record<string, string>[];
};

export type LocalDataset = DatasetSummary & {
  rows: Record<string, string>[];
  preview_rows: Record<string, string>[];
};

export type LocalPdfFile = WorkspaceFileSummary & {
  kind: "pdf";
  page_count: number;
  bytes_base64: string;
};

export type LocalOtherFile = WorkspaceFileSummary & {
  kind: "other";
};

export type LocalWorkspaceFile = LocalDataset | LocalPdfFile | LocalOtherFile;

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
  query_id?: string | null;
};

export type ToolEvent = {
  tool: string;
  detail: string;
};
