import type { WorkspaceState } from "./workspace";

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
      fn:
        | "lower"
        | "upper"
        | "trim"
        | "abs"
        | "round"
        | "floor"
        | "ceil"
        | "coalesce";
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
      op:
        | "sum"
        | "avg"
        | "min"
        | "max"
        | "first"
        | "last"
        | "median"
        | "variance"
        | "stddev";
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
  execution_hints?: AgentPlanExecutionHint[];
  created_at?: string;
};

export type AgentPlanExecutionHint = {
  done_when?: string;
  preferred_tool_names?: string[];
  preferred_handoff_tool_names?: string[];
};

export type PlanExecution = {
  plan_id: string;
  status: "active" | "completed" | "cancelled";
  workflow_item_id: string;
  current_step_index: number;
  attempts_by_step: number[];
  step_notes: Array<string | null>;
  step_started_after_item_id?: string;
};

export type AgentDelegationTargetMetadata = {
  agent_id: string;
  tool_name: string;
  description: string;
};

export type AgentSpecMetadata = {
  agent_id: string;
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
  delegation_targets: AgentDelegationTargetMetadata[];
};

export type AgentBundleMetadata = {
  root_agent_id: string;
  agents: AgentSpecMetadata[];
};

export type FeedbackOrigin = "interactive" | "ui_integration_test";

export type AppChatMetadata = {
  title?: string;
  investigation_brief?: string;
  plan?: AgentPlan;
  plan_execution?: PlanExecution;
  chart_plan?: AgentPlan;
  chart_cache?: Record<string, string>;
  surface_key?: string;
  agent_bundle?: AgentBundleMetadata;
  workspace_state?: WorkspaceState;
  openai_conversation_id?: string;
  openai_previous_response_id?: string;
  origin?: FeedbackOrigin;
};

export type UpdateChatMetadataPayload = Partial<AppChatMetadata>;

export type RunAggregateQueryToolArgs = {
  query_plan: QueryPlan;
};

export type CreateDatasetToolArgs = {
  filename: string;
  format: "csv" | "json";
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

export type ListDatasetsToolArgs = {
  includeSamples?: boolean;
};

export type ListImageFilesToolArgs = Record<string, never>;

export type InspectDatasetSchemaToolArgs = {
  dataset_id: string;
};

export type RenderChartFromDatasetToolArgs = {
  dataset_id: string;
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

export type ListDocumentFilesToolArgs = Record<string, never>;

export type InspectDocumentFileToolArgs = {
  file_id: string;
  max_pages?: number;
};

export type ReplaceDocumentTextToolArgs = {
  file_id: string;
  locator_id: string;
  replacement_text: string;
};

export type DocumentFieldValueInput = {
  locator_id: string;
  value: string;
};

export type FillDocumentFormToolArgs = {
  file_id: string;
  field_values: DocumentFieldValueInput[];
};

export type AppendDocumentAppendixFromDatasetToolArgs = {
  file_id: string;
  dataset_file_id: string;
  title: string;
  render_as?: "table" | "chart";
};

export type SmartSplitDocumentToolArgs = {
  file_id: string;
  goal?: string;
};

export type DeleteDocumentFileToolArgs = {
  file_id: string;
};

export type InspectImageFileToolArgs = {
  file_id: string;
  max_dimension?: number;
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
      dataset_id: string;
      chart_plan_id: string;
      chart: ClientChartSpec;
      image_data_url?: string | null;
    }
  | {
      type: "image";
      title: string;
      file_id: string;
      image_data_url?: string | null;
      alt_text?: string;
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

export type GetFarmStateToolArgs = Record<string, never>;

export type FarmCropDraft = {
  id: string;
  name: string;
  area: string;
  expected_yield?: string | null;
  notes?: string | null;
};

export type FarmIssueDraft = {
  id: string;
  title: string;
  status: "open" | "watching" | "resolved";
  notes?: string | null;
};

export type FarmProjectDraft = {
  id: string;
  title: string;
  status: "planned" | "active" | "done";
  notes?: string | null;
};

export type SaveFarmStateToolArgs = {
  farm_name: string;
  location?: string | null;
  crops: FarmCropDraft[];
  issues: FarmIssueDraft[];
  projects: FarmProjectDraft[];
  current_work: string[];
  notes?: string | null;
};

export type ClientToolArgsMap = {
  list_datasets: ListDatasetsToolArgs;
  list_image_files: ListImageFilesToolArgs;
  run_aggregate_query: RunAggregateQueryToolArgs;
  create_dataset: CreateDatasetToolArgs;
  list_pdf_files: ListWorkspaceFilesToolArgs;
  inspect_dataset_schema: InspectDatasetSchemaToolArgs;
  render_chart_from_dataset: RenderChartFromDatasetToolArgs;
  inspect_pdf_file: InspectPdfFileToolArgs;
  inspect_image_file: InspectImageFileToolArgs;
  get_pdf_page_range: GetPdfPageRangeToolArgs;
  smart_split_pdf: SmartSplitPdfToolArgs;
  list_document_files: ListDocumentFilesToolArgs;
  inspect_document_file: InspectDocumentFileToolArgs;
  replace_document_text: ReplaceDocumentTextToolArgs;
  fill_document_form: FillDocumentFormToolArgs;
  append_document_appendix_from_dataset: AppendDocumentAppendixFromDatasetToolArgs;
  smart_split_document: SmartSplitDocumentToolArgs;
  delete_document_file: DeleteDocumentFileToolArgs;
  list_reports: ListReportsToolArgs;
  get_report: GetReportToolArgs;
  create_report: CreateReportToolArgs;
  append_report_slide: AppendReportSlideToolArgs;
  remove_report_slide: RemoveReportSlideToolArgs;
  get_farm_state: GetFarmStateToolArgs;
  save_farm_state: SaveFarmStateToolArgs;
};

export type ClientToolName = keyof ClientToolArgsMap;

export type ClientToolCall<Name extends ClientToolName = ClientToolName> = {
  name: Name;
  arguments: ClientToolArgsMap[Name];
};

export type ChartRenderedEffect = {
  type: "chart_rendered";
  datasetId: string;
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

export type ClientEffect =
  | ChartRenderedEffect
  | ReportSectionEffect
  | PdfSmartSplitEffect;
