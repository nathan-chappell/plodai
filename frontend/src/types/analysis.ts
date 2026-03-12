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
export type ChartStylePreset = "editorial" | "sunrise" | "ocean" | "forest" | "mono";

export type ClientChartSpec = {
  type: ChartIntent;
  title: string;
  description?: string;
  label_key: string;
  series: ChartSeriesSpec[];
  style_preset?: ChartStylePreset;
  show_legend?: boolean;
  stacked?: boolean;
  smooth?: boolean;
  interactive?: boolean;
};

export type AppThreadMetadata = {
  title?: string;
  investigation_brief?: string;
  chart_cache?: Record<string, string>;
  openai_conversation_id?: string;
  openai_previous_response_id?: string;
};

export type UpdateThreadMetadataPayload = Partial<AppThreadMetadata>;

export type RenderChartToolArgs = {
  query_id: string;
  query_plan: QueryPlan;
  chart_plan: ClientChartSpec;
};

export type RunLocalQueryToolArgs = {
  query_plan: QueryPlan;
};

export type ListLoadedDatasetsToolArgs = {
  includeSamples?: boolean;
};

export type ClientToolArgsMap = {
  request_chart_render: RenderChartToolArgs;
  run_aggregate_query: RunLocalQueryToolArgs;
  list_attached_csv_files: ListLoadedDatasetsToolArgs;
};

export type ClientToolName = keyof ClientToolArgsMap;

export type ClientToolCall<Name extends ClientToolName = ClientToolName> = {
  name: Name;
  arguments: ClientToolArgsMap[Name];
};

export type ChartRenderedEffect = {
  type: "chart_rendered";
  queryId: string;
  chart: ClientChartSpec;
  imageDataUrl?: string;
  rows: DataRow[];
};

export type ReportSectionEffect = {
  type: "report_section_appended";
  title: string;
  markdown: string;
};

export type ClientEffect = ChartRenderedEffect | ReportSectionEffect;
