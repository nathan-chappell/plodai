import type { JsonSchema } from "../types/json-schema";

const primitiveValueSchema: JsonSchema = {
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
};

const rowExprSchema: JsonSchema = { anyOf: [] };

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

const unaryExprSchema: JsonSchema = {
  type: "object",
  properties: {
    kind: { enum: ["unary"] },
    op: { enum: ["not", "negate"] },
    value: rowExprSchema,
  },
  required: ["kind", "op", "value"],
  additionalProperties: false,
};

const binaryExprSchema: JsonSchema = {
  type: "object",
  properties: {
    kind: { enum: ["binary"] },
    op: {
      enum: ["add", "sub", "mul", "div", "mod", "eq", "neq", "gt", "gte", "lt", "lte", "and", "or"],
    },
    left: rowExprSchema,
    right: rowExprSchema,
  },
  required: ["kind", "op", "left", "right"],
  additionalProperties: false,
};

const callExprSchema: JsonSchema = {
  type: "object",
  properties: {
    kind: { enum: ["call"] },
    fn: { enum: ["lower", "upper", "trim", "abs", "round", "floor", "ceil", "coalesce"] },
    args: {
      type: "array",
      items: rowExprSchema,
    },
  },
  required: ["kind", "fn", "args"],
  additionalProperties: false,
};

(rowExprSchema as { anyOf: JsonSchema[] }).anyOf = [
  literalExprSchema,
  columnExprSchema,
  unaryExprSchema,
  binaryExprSchema,
  callExprSchema,
];

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
    description: { type: "string" },
    label_key: { type: "string" },
    series: {
      type: "array",
      items: chartSeriesSchema,
    },
    style_preset: { enum: ["editorial", "sunrise", "ocean", "forest", "mono"] },
    show_legend: { type: "boolean" },
    stacked: { type: "boolean" },
    smooth: { type: "boolean" },
    interactive: { type: "boolean" },
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

export const runAggregateQueryToolSchema: JsonSchema = {
  type: "object",
  properties: {
    query_plan: queryPlanSchema,
  },
  required: ["query_plan"],
  additionalProperties: false,
};

export const requestChartRenderToolSchema: JsonSchema = {
  type: "object",
  properties: {
    query_id: { type: "string" },
    query_plan: queryPlanSchema,
    chart_plan: clientChartSpecSchema,
  },
  required: ["query_id", "query_plan", "chart_plan"],
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
