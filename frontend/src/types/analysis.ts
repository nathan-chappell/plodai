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
  }>;
  handoff_targets: CapabilityHandoffTargetMetadata[];
};

export type CapabilityBundleMetadata = {
  root_capability_id: string;
  capabilities: CapabilityAgentSpecMetadata[];
};

export type AppThreadMetadata = {
  title?: string;
  investigation_brief?: string;
  plan?: AgentPlan;
  chart_plan?: AgentPlan;
  chart_cache?: Record<string, string>;
  surface_key?: string;
  capability_bundle?: CapabilityBundleMetadata;
  openai_conversation_id?: string;
  openai_previous_response_id?: string;
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

export type GetPdfPageRangeToolArgs = {
  file_id: string;
  start_page: number;
  end_page: number;
};

export type ListWorkspaceFilesToolArgs = {
  includeSamples?: boolean;
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

export type ClientToolArgsMap = {
  list_workspace_files: ListWorkspaceFilesToolArgs;
  list_attached_csv_files: ListLoadedDatasetsToolArgs;
  run_aggregate_query: RunLocalQueryToolArgs;
  create_csv_file: CreateCsvFileToolArgs;
  create_json_file: CreateJsonFileToolArgs;
  list_chartable_files: ListWorkspaceFilesToolArgs;
  inspect_chartable_file_schema: InspectChartableFileSchemaToolArgs;
  render_chart_from_file: RenderChartFromFileToolArgs;
  inspect_pdf_file: InspectPdfFileToolArgs;
  get_pdf_page_range: GetPdfPageRangeToolArgs;
  smart_split_pdf: SmartSplitPdfToolArgs;
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

export type ClientEffect = ChartRenderedEffect | ReportSectionEffect | PdfSmartSplitEffect;
