import type { JsonSchema } from "../types/json-schema";

const MAX_ROW_EXPR_SCHEMA_DEPTH = 4;

const primitiveValueSchema: JsonSchema = {
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
};

const literalExprSchema: JsonSchema = {
  type: "object",
  properties: {
    kind: { enum: ["literal"] },
    value: primitiveValueSchema,
  },
  required: ["kind", "value"],
  additionalProperties: false,
};

const columnExprSchema: JsonSchema = {
  type: "object",
  properties: {
    kind: { enum: ["column"] },
    column: { type: "string" },
  },
  required: ["kind", "column"],
  additionalProperties: false,
};

const rowExprSchema = buildRowExprSchema(MAX_ROW_EXPR_SCHEMA_DEPTH);

const projectFieldSchema: JsonSchema = {
  type: "object",
  properties: {
    as: { type: "string" },
    expr: rowExprSchema,
  },
  required: ["as", "expr"],
  additionalProperties: false,
};

const groupKeySchema: JsonSchema = {
  type: "object",
  properties: {
    as: { type: "string" },
    expr: rowExprSchema,
  },
  required: ["as", "expr"],
  additionalProperties: false,
};

const sortSpecSchema: JsonSchema = {
  type: "object",
  properties: {
    field: { type: "string" },
    direction: { enum: ["asc", "desc"] },
  },
  required: ["field", "direction"],
  additionalProperties: false,
};

const aggregateSpecSchema: JsonSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        op: { enum: ["count"] },
        as: { type: "string" },
      },
      required: ["op", "as"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { enum: ["null_count"] },
        as: { type: "string" },
        expr: rowExprSchema,
      },
      required: ["op", "as", "expr"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { enum: ["count_distinct"] },
        as: { type: "string" },
        expr: rowExprSchema,
      },
      required: ["op", "as", "expr"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { enum: ["sum", "avg", "min", "max", "first", "last", "median", "variance", "stddev"] },
        as: { type: "string" },
        expr: rowExprSchema,
      },
      required: ["op", "as", "expr"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { enum: ["describe_numeric"] },
        column: { type: "string" },
        prefix: { type: "string" },
      },
      required: ["op", "column"],
      additionalProperties: false,
    },
  ],
};

export const queryPlanSchema: JsonSchema = {
  type: "object",
  properties: {
    dataset_id: { type: "string" },
    where: rowExprSchema,
    project: {
      type: "array",
      items: projectFieldSchema,
    },
    group_by: {
      type: "array",
      items: groupKeySchema,
    },
    aggregates: {
      type: "array",
      items: aggregateSpecSchema,
    },
    sort: {
      type: "array",
      items: sortSpecSchema,
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 500,
    },
  },
  required: ["dataset_id"],
  additionalProperties: false,
};

const compactGroupKeySchema: JsonSchema = {
  type: "object",
  properties: {
    as: { type: "string" },
    expr: columnExprSchema,
  },
  required: ["as", "expr"],
  additionalProperties: false,
};

const compactAggregateSpecSchema: JsonSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        op: { enum: ["count"] },
        as: { type: "string" },
      },
      required: ["op", "as"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { enum: ["sum", "avg", "min", "max"] },
        as: { type: "string" },
        expr: columnExprSchema,
      },
      required: ["op", "as", "expr"],
      additionalProperties: false,
    },
  ],
};

export const compactAggregateQueryPlanSchema: JsonSchema = {
  type: "object",
  properties: {
    dataset_id: { type: "string" },
    group_by: {
      type: "array",
      items: compactGroupKeySchema,
    },
    aggregates: {
      type: "array",
      items: compactAggregateSpecSchema,
    },
    sort: {
      type: "array",
      items: sortSpecSchema,
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 500,
    },
  },
  required: ["dataset_id"],
  additionalProperties: false,
};

const chartSeriesSchema: JsonSchema = {
  type: "object",
  properties: {
    label: { type: "string" },
    data_key: { type: "string" },
    color: { type: "string" },
  },
  required: ["label", "data_key"],
  additionalProperties: false,
};

export const clientChartSpecSchema: JsonSchema = {
  type: "object",
  properties: {
    type: { enum: ["bar", "line", "pie", "doughnut", "scatter"] },
    title: { type: "string" },
    subtitle: { type: "string" },
    description: { type: "string" },
    label_key: { type: "string" },
    series: {
      type: "array",
      items: chartSeriesSchema,
    },
    style_preset: {
      enum: ["editorial", "sunrise", "ocean", "forest", "mono", "ledger", "amber", "cobalt", "terracotta", "midnight"],
    },
    x_axis_label: { type: "string" },
    y_axis_label: { type: "string" },
    legend_position: { enum: ["top", "bottom", "left", "right"] },
    orientation: { enum: ["vertical", "horizontal"] },
    value_format: { enum: ["number", "integer", "currency", "percent", "compact", "string"] },
    show_legend: { type: "boolean" },
    stacked: { type: "boolean" },
    smooth: { type: "boolean" },
    interactive: { type: "boolean" },
    show_grid: { type: "boolean" },
    show_data_labels: { type: "boolean" },
    fill_area: { type: "boolean" },
  },
  required: ["type", "title", "label_key", "series"],
  additionalProperties: false,
};

export const includeSamplesSchema: JsonSchema = {
  type: "object",
  properties: {
    includeSamples: {
      type: "boolean",
      description: "Whether to include tiny familiarization samples.",
    },
  },
  additionalProperties: false,
};

export const inspectChartableFileSchemaToolSchema: JsonSchema = {
  type: "object",
  properties: {
    file_id: { type: "string" },
  },
  required: ["file_id"],
  additionalProperties: false,
};

export const runAggregateQueryToolSchema: JsonSchema = {
  type: "object",
  properties: {
    query_plan: queryPlanSchema,
  },
  required: ["query_plan"],
  additionalProperties: false,
};

export const compactRunAggregateQueryToolSchema: JsonSchema = {
  type: "object",
  properties: {
    query_plan: compactAggregateQueryPlanSchema,
  },
  required: ["query_plan"],
  additionalProperties: false,
};

export const createCsvFileToolSchema: JsonSchema = {
  type: "object",
  properties: {
    filename: { type: "string" },
    query_plan: queryPlanSchema,
  },
  required: ["filename", "query_plan"],
  additionalProperties: false,
};

export const compactCreateCsvFileToolSchema: JsonSchema = {
  type: "object",
  properties: {
    filename: { type: "string" },
    query_plan: compactAggregateQueryPlanSchema,
  },
  required: ["filename", "query_plan"],
  additionalProperties: false,
};

export const createJsonFileToolSchema: JsonSchema = {
  type: "object",
  properties: {
    filename: { type: "string" },
    query_plan: queryPlanSchema,
  },
  required: ["filename", "query_plan"],
  additionalProperties: false,
};

export const compactCreateJsonFileToolSchema: JsonSchema = {
  type: "object",
  properties: {
    filename: { type: "string" },
    query_plan: compactAggregateQueryPlanSchema,
  },
  required: ["filename", "query_plan"],
  additionalProperties: false,
};

export const renderChartFromFileToolSchema: JsonSchema = {
  type: "object",
  properties: {
    file_id: { type: "string" },
    chart_plan_id: { type: "string" },
    chart_plan: clientChartSpecSchema,
    x_key: { type: "string" },
    y_key: { type: "string" },
    series_key: { type: "string" },
  },
  required: ["file_id", "chart_plan_id", "chart_plan", "x_key"],
  additionalProperties: false,
};

export const inspectPdfFileToolSchema: JsonSchema = {
  type: "object",
  properties: {
    file_id: { type: "string" },
    max_pages: { type: "integer", minimum: 1, maximum: 30 },
  },
  required: ["file_id"],
  additionalProperties: false,
};

export const getPdfPageRangeToolSchema: JsonSchema = {
  type: "object",
  properties: {
    file_id: { type: "string" },
    start_page: { type: "integer", minimum: 1 },
    end_page: { type: "integer", minimum: 1 },
  },
  required: ["file_id", "start_page", "end_page"],
  additionalProperties: false,
};

export const smartSplitPdfToolSchema: JsonSchema = {
  type: "object",
  properties: {
    file_id: { type: "string" },
    goal: { type: "string" },
  },
  required: ["file_id"],
  additionalProperties: false,
};

export const listReportsToolSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const getReportToolSchema: JsonSchema = {
  type: "object",
  properties: {
    report_id: { type: "string" },
  },
  required: ["report_id"],
  additionalProperties: false,
};

export const createReportToolSchema: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    report_id: { type: "string" },
  },
  required: ["title"],
  additionalProperties: false,
};

const reportNarrativePanelDraftSchema: JsonSchema = {
  type: "object",
  properties: {
    type: { enum: ["narrative"] },
    title: { type: "string" },
    markdown: { type: "string" },
  },
  required: ["type", "title", "markdown"],
  additionalProperties: false,
};

const reportChartPanelDraftSchema: JsonSchema = {
  type: "object",
  properties: {
    type: { enum: ["chart"] },
    title: { type: "string" },
    file_id: { type: "string" },
    chart_plan_id: { type: "string" },
    chart: clientChartSpecSchema,
    image_data_url: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
  required: ["type", "title", "file_id", "chart_plan_id", "chart"],
  additionalProperties: false,
};

const reportSlidePanelDraftSchema: JsonSchema = {
  anyOf: [reportNarrativePanelDraftSchema, reportChartPanelDraftSchema],
};

function reportSlideDraftForLayout(
  layout: "1x1" | "1x2" | "2x2",
  minItems: number,
  maxItems: number,
): JsonSchema {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      layout: { enum: [layout] },
      panels: {
        type: "array",
        items: reportSlidePanelDraftSchema,
        minItems,
        maxItems,
      },
    },
    required: ["title", "layout", "panels"],
    additionalProperties: false,
  };
}

export const appendReportSlideToolSchema: JsonSchema = {
  type: "object",
  properties: {
    report_id: { type: "string" },
    slide: {
      anyOf: [
        reportSlideDraftForLayout("1x1", 1, 1),
        reportSlideDraftForLayout("1x2", 2, 2),
        reportSlideDraftForLayout("2x2", 3, 4),
      ],
    },
  },
  required: ["report_id", "slide"],
  additionalProperties: false,
};

export const removeReportSlideToolSchema: JsonSchema = {
  type: "object",
  properties: {
    report_id: { type: "string" },
    slide_id: { type: "string" },
  },
  required: ["report_id", "slide_id"],
  additionalProperties: false,
};

function buildRowExprSchema(depth: number): JsonSchema {
  if (depth <= 0) {
    return {
      anyOf: [literalExprSchema, columnExprSchema],
    };
  }

  return {
    anyOf: [
      literalExprSchema,
      columnExprSchema,
      buildUnaryExprSchema(depth - 1),
      buildBinaryExprSchema(depth - 1),
      buildCallExprSchema(depth - 1),
    ],
  };
}

function buildUnaryExprSchema(childDepth: number): JsonSchema {
  return {
    type: "object",
    properties: {
      kind: { enum: ["unary"] },
      op: { enum: ["not", "negate"] },
      value: buildRowExprSchema(childDepth),
    },
    required: ["kind", "op", "value"],
    additionalProperties: false,
  };
}

function buildBinaryExprSchema(childDepth: number): JsonSchema {
  return {
    type: "object",
    properties: {
      kind: { enum: ["binary"] },
      op: {
        enum: ["add", "sub", "mul", "div", "mod", "eq", "neq", "gt", "gte", "lt", "lte", "and", "or"],
      },
      left: buildRowExprSchema(childDepth),
      right: buildRowExprSchema(childDepth),
    },
    required: ["kind", "op", "left", "right"],
    additionalProperties: false,
  };
}

function buildCallExprSchema(childDepth: number): JsonSchema {
  return {
    type: "object",
    properties: {
      kind: { enum: ["call"] },
      fn: { enum: ["lower", "upper", "trim", "abs", "round", "floor", "ceil", "coalesce"] },
      args: {
        type: "array",
        items: buildRowExprSchema(childDepth),
      },
    },
    required: ["kind", "fn", "args"],
    additionalProperties: false,
  };
}
