export type PrimitiveValue = string | number | boolean | null;
export type DataRow = Record<string, PrimitiveValue>;

export type LiteralExpr = {
  kind: "literal";
  value: PrimitiveValue;
};

export type FieldExpr = {
  kind: "field";
  field: string;
};

export type UnaryExpr = {
  kind: "unary";
  op: "negate" | "not";
  value: DataExpression;
};

export type BinaryExpr = {
  kind: "binary";
  op:
    | "add"
    | "subtract"
    | "multiply"
    | "divide"
    | "mod"
    | "eq"
    | "neq"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "and"
    | "or";
  left: DataExpression;
  right: DataExpression;
};

export type DataExpression = LiteralExpr | FieldExpr | UnaryExpr | BinaryExpr;

export type ReducerOp = "count" | "sum" | "avg" | "min" | "max" | "first";

export type MeasureSpec = {
  as: string;
  op: ReducerOp;
  expr?: DataExpression;
};

export type GroupingSpec = {
  as: string;
  expr: DataExpression;
};

export type AnalysisPlan = {
  sourceDatasetId: string;
  filter?: DataExpression;
  groupBy?: GroupingSpec[];
  measures: MeasureSpec[];
  sort?: {
    field: string;
    direction: "asc" | "desc";
  }[];
  limit?: number;
};

export type ChartSeriesSpec = {
  label: string;
  dataKey: string;
  color?: string;
};

export type ChartIntent = "bar" | "line" | "pie" | "doughnut" | "scatter";

export type ClientChartSpec = {
  type: ChartIntent;
  title: string;
  description?: string;
  labelKey: string;
  series: ChartSeriesSpec[];
};

export type RenderChartToolArgs = {
  datasetId: string;
  analysis: AnalysisPlan;
  chart: ClientChartSpec;
  queryId: string;
};

export type RunLocalQueryToolArgs = {
  datasetId: string;
  analysis: AnalysisPlan;
};

export type ListLoadedDatasetsToolArgs = {
  includeSamples?: boolean;
};

export type ClientToolArgsMap = {
  render_chart: RenderChartToolArgs;
  run_local_query: RunLocalQueryToolArgs;
  list_loaded_datasets: ListLoadedDatasetsToolArgs;
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
