import {
  compactAggregateQueryPlanSchema,
  compactCreateCsvFileToolSchema,
  compactCreateJsonFileToolSchema,
  compactRunAggregateQueryToolSchema,
  includeSamplesSchema,
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

function buildQueryPlanSchemaForWorkspace(
  workspace: CapabilityWorkspaceContext,
): JsonSchema {
  const schema = cloneSchema(compactAggregateQueryPlanSchema);
  const datasetIds = workspace.files
    .filter((file) => file.kind === "csv")
    .map((file) => file.id);
  if (!datasetIds.length || !isObjectSchema(schema)) {
    return schema;
  }
  schema.properties = {
    ...schema.properties,
    dataset_id: {
      ...(schema.properties.dataset_id as JsonSchema),
      enum: datasetIds,
    },
  };
  return schema;
}

export function buildCsvAgentClientToolCatalog(
  workspace: CapabilityWorkspaceContext,
): FunctionToolDefinition[] {
  const workspaceQueryPlanSchema = buildQueryPlanSchemaForWorkspace(workspace);
  const runAggregateSchema = cloneSchema(compactRunAggregateQueryToolSchema);
  if (isObjectSchema(runAggregateSchema)) {
    runAggregateSchema.properties = {
      ...runAggregateSchema.properties,
      query_plan: workspaceQueryPlanSchema,
    };
  }
  const createCsvSchema = cloneSchema(compactCreateCsvFileToolSchema);
  if (isObjectSchema(createCsvSchema)) {
    createCsvSchema.properties = {
      ...createCsvSchema.properties,
      query_plan: workspaceQueryPlanSchema,
    };
  }
  const createJsonSchema = cloneSchema(compactCreateJsonFileToolSchema);
  if (isObjectSchema(createJsonSchema)) {
    createJsonSchema.properties = {
      ...createJsonSchema.properties,
      query_plan: workspaceQueryPlanSchema,
    };
  }
  return [
    buildToolDefinition(
      "list_csv_files",
      "List CSV files from the shared workspace, including safe schema details, row counts, numeric columns, and tiny familiarization samples when requested.",
      includeSamplesSchema,
      {
        label: "List CSV Files",
        omit_args: ["includeSamples"],
      },
    ),
    buildToolDefinition(
      "run_aggregate_query",
      "Execute a validated aggregate query plan against the client-side CSV rows and return grouped or summary results.",
      runAggregateSchema,
      {
        label: "Run Aggregate Query",
        prominent_args: ["query_plan.dataset_id"],
        arg_labels: { "query_plan.dataset_id": "dataset" },
      },
    ),
    buildToolDefinition(
      "create_csv_file",
      "Run a validated query plan locally and materialize the result rows as a CSV artifact with the requested filename.",
      createCsvSchema,
      {
        label: "Create CSV File",
        prominent_args: ["filename", "query_plan.dataset_id"],
        arg_labels: { filename: "file", "query_plan.dataset_id": "dataset" },
      },
    ),
    buildToolDefinition(
      "create_json_file",
      "Run a validated query plan locally and materialize the result rows as a JSON artifact with the requested filename.",
      createJsonSchema,
      {
        label: "Create JSON File",
        prominent_args: ["filename", "query_plan.dataset_id"],
        arg_labels: { filename: "file", "query_plan.dataset_id": "dataset" },
      },
    ),
  ];
}

export function createCsvAgentClientTools(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool[] {
  return buildCsvAgentClientToolCatalog(workspace).map((definition) =>
    createBrokeredCapabilityTool(
      workspace,
      definition,
      definition.name as
        | "list_csv_files"
        | "run_aggregate_query"
        | "create_csv_file"
        | "create_json_file",
    ),
  );
}
