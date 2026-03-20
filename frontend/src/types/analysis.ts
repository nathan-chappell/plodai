export type PrimitiveValue = string | number | boolean | null;
export type DataRow = Record<string, PrimitiveValue>;

export type RowExpr =
  | { kind: "literal"; value: PrimitiveValue }
  | { kind: "column"; column: string }
  | { kind: "unary"; op: "not" | "negate"; value: RowExpr }
  | {
      kind: "binary";
      op:
        | "add"
        | "sub"
        | "mul"
        | "div"
        | "mod"
        | "eq"
        | "neq"
        | "gt"
        | "gte"
        | "lt"
        | "lte"
        | "and"
        | "or";
      left: RowExpr;
      right: RowExpr;
    }
  | {
      kind: "call";
      fn: "lower" | "upper" | "trim" | "abs" | "round" | "floor" | "ceil" | "coalesce";
      args: RowExpr[];
    };

export type ProjectField = {
  as: string;
  expr: RowExpr;
};

export type GroupKey = {
  as: string;
  expr: RowExpr;
};

export type AggregateSpec =
  | { op: "count"; as: string }
  | { op: "null_count"; as: string; expr: RowExpr }
  | { op: "count_distinct"; as: string; expr: RowExpr }
  | {
      op: "sum" | "avg" | "min" | "max" | "first" | "last" | "median" | "variance" | "stddev";
      as: string;
      expr: RowExpr;
    }
  | { op: "describe_numeric"; column: string; prefix?: string };

export type QueryPlan = {
  dataset_id: string;
  where?: RowExpr;
  project?: ProjectField[];
  group_by?: GroupKey[];
  aggregates?: AggregateSpec[];
  sort?: {
    field: string;
    direction: "asc" | "desc";
  }[];
  limit?: number;
};

export type ChartSeriesSpec = {
  label: string;
  data_key: string;
  color?: string;
};

export type ChartIntent = "bar" | "line" | "pie" | "doughnut" | "scatter";
export type ChartStylePreset =
  | "editorial"
  | "sunrise"
  | "ocean"
  | "forest"
  | "mono"
  | "ledger"
  | "amber"
  | "cobalt"
  | "terracotta"
  | "midnight";

export type ChartLegendPosition = "top" | "bottom" | "left" | "right";
export type ChartOrientation = "vertical" | "horizontal";
export type ChartValueFormat =
  | "number"
  | "integer"
  | "currency"
  | "percent"
  | "compact"
  | "string";

export type ClientChartSpec = {
  type: ChartIntent;
  title: string;
  subtitle?: string;
  description?: string;
  label_key: string;
  series: ChartSeriesSpec[];
  style_preset?: ChartStylePreset;
  x_axis_label?: string;
  y_axis_label?: string;
  legend_position?: ChartLegendPosition;
  orientation?: ChartOrientation;
  value_format?: ChartValueFormat;
  show_legend?: boolean;
  stacked?: boolean;
  smooth?: boolean;
  interactive?: boolean;
  show_grid?: boolean;
  show_data_labels?: boolean;
  fill_area?: boolean;
};

export type AgentPlan = {
  id: string;
  focus: string;
  planned_steps: string[];
  success_criteria?: string[];
  follow_on_tool_hints?: string[];
  created_at?: string;
};

export type CapabilityHandoffTargetMetadata = {
  capability_id: string;
  tool_name: string;
  description: string;
};

export type CapabilityAgentSpecMetadata = {
  capability_id: string;
  agent_name: string;
  instructions: string;
  client_tools: Array<{
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
    display?: {
      label?: string;
      prominent_args?: string[];
      omit_args?: string[];
      arg_labels?: Record<string, string>;
    };
  }>;
  handoff_targets: CapabilityHandoffTargetMetadata[];
};

export type CapabilityBundleMetadata = {
  root_capability_id: string;
  capabilities: CapabilityAgentSpecMetadata[];
};

export type FeedbackOrigin = "interactive" | "ui_integration_test";

export type AppThreadMetadata = {
  title?: string;
  investigation_brief?: string;
  plan?: AgentPlan;
  chart_plan?: AgentPlan;
  chart_cache?: Record<string, string>;
  surface_key?: string;
  capability_bundle?: CapabilityBundleMetadata;
  workspace_state?: WorkspaceState;
  openai_conversation_id?: string;
  openai_previous_response_id?: string;
  origin?: FeedbackOrigin;
};

export type UpdateThreadMetadataPayload = Partial<AppThreadMetadata>;

export type RunLocalQueryToolArgs = {
  query_plan: QueryPlan;
};

export type CreateCsvFileToolArgs = {
  filename: string;
  query_plan: QueryPlan;
};

export type CreateJsonFileToolArgs = {
  filename: string;
  query_plan: QueryPlan;
};

export type ListWorkspaceFilesToolArgs = {
  includeSamples?: boolean;
};

export type GetPdfPageRangeToolArgs = {
  file_id: string;
  start_page: number;
  end_page: number;
};

export type ListLoadedDatasetsToolArgs = {
  includeSamples?: boolean;
};

export type InspectChartableFileSchemaToolArgs = {
  file_id: string;
};

export type RenderChartFromFileToolArgs = {
  file_id: string;
  chart_plan_id: string;
  chart_plan: ClientChartSpec;
  x_key: string;
  y_key?: string;
  series_key?: string;
};

export type InspectPdfFileToolArgs = {
  file_id: string;
  max_pages?: number;
};

export type SmartSplitPdfToolArgs = {
  file_id: string;
  goal?: string;
};

export type ListReportsToolArgs = Record<string, never>;

export type GetReportToolArgs = {
  report_id: string;
};

export type CreateReportToolArgs = {
  title: string;
  report_id?: string;
};

export type ReportSlidePanelDraft =
  | {
      type: "narrative";
      title: string;
      markdown: string;
    }
  | {
      type: "chart";
      title: string;
      file_id: string;
      chart_plan_id: string;
      chart: ClientChartSpec;
      image_data_url?: string | null;
    };

export type ReportSlideDraft = {
  title: string;
  layout: "1x1" | "1x2" | "2x2";
  panels: ReportSlidePanelDraft[];
};

export type AppendReportSlideToolArgs = {
  report_id: string;
  slide: ReportSlideDraft;
};

export type RemoveReportSlideToolArgs = {
  report_id: string;
  slide_id: string;
};

export type ClientToolArgsMap = {
  list_csv_files: ListLoadedDatasetsToolArgs;
  run_aggregate_query: RunLocalQueryToolArgs;
  create_csv_file: CreateCsvFileToolArgs;
  create_json_file: CreateJsonFileToolArgs;
  list_chartable_files: ListWorkspaceFilesToolArgs;
  list_pdf_files: ListWorkspaceFilesToolArgs;
  inspect_chartable_file_schema: InspectChartableFileSchemaToolArgs;
  render_chart_from_file: RenderChartFromFileToolArgs;
  inspect_pdf_file: InspectPdfFileToolArgs;
  get_pdf_page_range: GetPdfPageRangeToolArgs;
  smart_split_pdf: SmartSplitPdfToolArgs;
  list_reports: ListReportsToolArgs;
  get_report: GetReportToolArgs;
  create_report: CreateReportToolArgs;
  append_report_slide: AppendReportSlideToolArgs;
  remove_report_slide: RemoveReportSlideToolArgs;
};

export type ClientToolName = keyof ClientToolArgsMap;

export type ClientToolCall<Name extends ClientToolName = ClientToolName> = {
  name: Name;
  arguments: ClientToolArgsMap[Name];
};

export type ChartRenderedEffect = {
  type: "chart_rendered";
  fileId: string;
  chartPlanId: string;
  chart: ClientChartSpec;
  imageDataUrl?: string;
  rows: DataRow[];
};

export type ReportSectionEffect = {
  type: "report_section_appended";
  title: string;
  markdown: string;
};

export type SmartSplitEntry = {
  fileId: string;
  name: string;
  title: string;
  startPage: number;
  endPage: number;
  pageCount: number;
};

export type WorkspaceThreadContext = {
  workspace_id: string;
  referenced_item_ids: string[];
};

export type WorkspaceStateFileSummary = {
  id: string;
  name: string;
  bucket: "uploaded" | "data" | "chart" | "pdf";
  producer_key: string;
  producer_label: string;
  source: "uploaded" | "derived" | "demo";
  kind: "csv" | "json" | "pdf" | "other";
  extension: string;
  mime_type?: string;
  byte_size?: number;
  row_count?: number;
  columns?: string[];
  numeric_columns?: string[];
  sample_rows?: DataRow[];
  page_count?: number;
};

export type WorkspaceStateReportSummary = {
  report_id: string;
  title: string;
  item_count: number;
  slide_count: number;
  updated_at: string | null;
};

export type WorkspaceState = {
  version: "v1";
  context: WorkspaceThreadContext;
  files: WorkspaceStateFileSummary[];
  reports: WorkspaceStateReportSummary[];
  current_report_id: string | null;
  current_goal: string | null;
  agents_markdown?: string | null;
};

export type PdfSmartSplitEffect = {
  type: "pdf_smart_split_completed";
  sourceFileId: string;
  sourceFileName: string;
  archiveFileId: string;
  archiveFileName: string;
  indexFileId: string;
  indexFileName: string;
  entries: SmartSplitEntry[];
  markdown: string;
};

export type ClientEffect =
  | ChartRenderedEffect
  | ReportSectionEffect
  | PdfSmartSplitEffect;
