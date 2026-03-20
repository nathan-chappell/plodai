import {
  includeSamplesSchema,
  inspectChartableFileSchemaToolSchema,
  renderChartFromFileToolSchema,
} from "../../lib/tool-schemas";
import type { JsonSchema } from "../../types/json-schema";
import {
  buildToolDefinition,
  cloneSchema,
  createBrokeredCapabilityTool,
  isObjectSchema,
} from "../shared/tool-helpers";
import type {
  CapabilityClientTool,
  CapabilityWorkspaceContext,
  FunctionToolDefinition,
} from "../types";

function chartableFileIds(workspace: CapabilityWorkspaceContext): string[] {
  return workspace.files
    .filter((file) => file.kind === "csv" || file.kind === "json")
    .map((file) => file.id);
}

function withChartableFileIdEnum(
  schema: JsonSchema,
  workspace: CapabilityWorkspaceContext,
): JsonSchema {
  const fileIds = chartableFileIds(workspace);
  const cloned = cloneSchema(schema);
  if (!fileIds.length || !isObjectSchema(cloned)) {
    return cloned;
  }
  cloned.properties = {
    ...cloned.properties,
    file_id: {
      ...(cloned.properties.file_id as JsonSchema),
      enum: fileIds,
    },
  };
  return cloned;
}

export function buildChartAgentClientToolCatalog(
  workspace: CapabilityWorkspaceContext,
): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_chartable_files",
      "List chartable CSV and JSON artifacts from the shared workspace, including schema hints and tiny samples when requested.",
      includeSamplesSchema,
      {
        label: "List Chartable Files",
        omit_args: ["includeSamples"],
      },
    ),
    buildToolDefinition(
      "inspect_chartable_file_schema",
      "Inspect a CSV or JSON chartable artifact before building a chart plan.",
      withChartableFileIdEnum(inspectChartableFileSchemaToolSchema, workspace),
      {
        label: "Inspect Chartable File Schema",
        prominent_args: ["file_id"],
        arg_labels: { file_id: "file" },
      },
    ),
    buildToolDefinition(
      "render_chart_from_file",
      "Render a chart from a chartable CSV or JSON artifact after the chart has been planned.",
      withChartableFileIdEnum(renderChartFromFileToolSchema, workspace),
      {
        label: "Render Chart From File",
        prominent_args: ["chart_plan.title", "file_id"],
        arg_labels: { "chart_plan.title": "chart", file_id: "file" },
      },
    ),
  ];
}

export function createChartAgentClientTools(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool[] {
  return buildChartAgentClientToolCatalog(workspace).map((definition) =>
    createBrokeredCapabilityTool(
      workspace,
      definition,
      definition.name as
        | "list_chartable_files"
        | "inspect_chartable_file_schema"
        | "render_chart_from_file",
    ),
  );
}
