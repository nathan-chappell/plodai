import type { ClientChartSpec } from "./analysis";

export type DatasetSummary = {
  id: string;
  name: string;
  row_count: number;
  columns: string[];
  numeric_columns: string[];
  sample_rows: Record<string, string>[];
};

export type LocalDataset = DatasetSummary & {
  rows: Record<string, string>[];
  preview_rows: Record<string, string>[];
};

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
