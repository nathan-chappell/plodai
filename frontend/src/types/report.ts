import type { ClientChartSpec, DataRow } from "./analysis";

export type LocalAttachmentKind = "csv" | "json" | "pdf" | "image" | "other";
export type DatasetKind = "csv" | "json";

export type LocalAttachmentSummary = {
  id: string;
  name: string;
  kind: LocalAttachmentKind;
  extension: string;
  byte_size?: number;
  mime_type?: string;
};

export type DatasetSummary = LocalAttachmentSummary & {
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

export type LocalPdfAttachment = LocalAttachmentSummary & {
  kind: "pdf";
  page_count: number;
  bytes_base64: string;
};

export type LocalImageAttachment = LocalAttachmentSummary & {
  kind: "image";
  width: number;
  height: number;
  bytes_base64: string;
};

export type LocalOtherAttachment = LocalAttachmentSummary & {
  kind: "other";
  text_content?: string;
  bytes_base64?: string;
};

export type LocalAttachment =
  | LocalDataset
  | LocalPdfAttachment
  | LocalImageAttachment
  | LocalOtherAttachment;

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
