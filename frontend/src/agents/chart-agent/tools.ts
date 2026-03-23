import {
  includeSamplesSchema,
  inspectDatasetSchemaToolSchema,
  renderChartFromDatasetToolSchema,
} from "../../lib/tool-schemas";
import type { JsonSchema } from "../../types/json-schema";
import {
  buildToolDefinition,
  cloneSchema,
  createBrokeredAgentTool,
  isObjectSchema,
} from "../shared/tool-helpers";
import type {
  AgentClientTool,
  AgentRuntimeContext,
  FunctionToolDefinition,
} from "../types";

function datasetIds(workspace: AgentRuntimeContext): string[] {
  return workspace
    .listFiles()
    .filter((file) => file.kind === "csv" || file.kind === "json")
    .map((file) => file.id);
}

function withDatasetIdEnum(
  schema: JsonSchema,
  workspace: AgentRuntimeContext,
): JsonSchema {
  const ids = datasetIds(workspace);
  const cloned = cloneSchema(schema);
  if (!ids.length || !isObjectSchema(cloned)) {
    return cloned;
  }
  cloned.properties = {
    ...cloned.properties,
    dataset_id: {
      ...(cloned.properties.dataset_id as JsonSchema),
      enum: ids,
    },
  };
  return cloned;
}

export function buildChartAgentClientToolCatalog(
  workspace: AgentRuntimeContext,
): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_datasets",
      "List chart-ready datasets from the current workspace, including schema hints and tiny samples when requested.",
      includeSamplesSchema,
      {
        label: "List Datasets",
        omit_args: ["includeSamples"],
      },
    ),
    buildToolDefinition(
      "inspect_dataset_schema",
      "Inspect a tabular dataset before building a chart plan.",
      withDatasetIdEnum(inspectDatasetSchemaToolSchema, workspace),
      {
        label: "Inspect Dataset Schema",
        prominent_args: ["dataset_id"],
        arg_labels: { dataset_id: "dataset" },
      },
    ),
    buildToolDefinition(
      "render_chart_from_dataset",
      "Render a chart from a tabular dataset after the chart has been planned, then persist it as a typed chart artifact plus a local JSON projection file.",
      withDatasetIdEnum(renderChartFromDatasetToolSchema, workspace),
      {
        label: "Render Chart From Dataset",
        prominent_args: ["chart_plan.title", "dataset_id"],
        arg_labels: { "chart_plan.title": "chart", dataset_id: "dataset" },
      },
    ),
  ];
}

export function createChartAgentClientTools(
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return buildChartAgentClientToolCatalog(workspace).map((definition) =>
    createBrokeredAgentTool(
      workspace,
      definition,
      definition.name as
        | "list_datasets"
        | "inspect_dataset_schema"
        | "render_chart_from_dataset",
    ),
  );
}
