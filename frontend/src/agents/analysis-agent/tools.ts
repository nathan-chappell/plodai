import {
  compactAggregateQueryPlanSchema,
  compactCreateDatasetToolSchema,
  compactRunAggregateQueryToolSchema,
  includeSamplesSchema,
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

function buildQueryPlanSchemaForWorkspace(
  workspace: AgentRuntimeContext,
): JsonSchema {
  const schema = cloneSchema(compactAggregateQueryPlanSchema);
  const datasetIds = workspace
    .listFiles()
    .filter((file) => file.kind === "csv" || file.kind === "json")
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

export function buildAnalysisAgentClientToolCatalog(
  workspace: AgentRuntimeContext,
): FunctionToolDefinition[] {
  const workspaceQueryPlanSchema = buildQueryPlanSchemaForWorkspace(workspace);
  const runAggregateSchema = cloneSchema(compactRunAggregateQueryToolSchema);
  if (isObjectSchema(runAggregateSchema)) {
    runAggregateSchema.properties = {
      ...runAggregateSchema.properties,
      query_plan: workspaceQueryPlanSchema,
    };
  }
  const createDatasetSchema = cloneSchema(compactCreateDatasetToolSchema);
  if (isObjectSchema(createDatasetSchema)) {
    createDatasetSchema.properties = {
      ...createDatasetSchema.properties,
      query_plan: workspaceQueryPlanSchema,
    };
  }
  return [
    buildToolDefinition(
      "list_datasets",
      "List tabular datasets from the current workspace, including safe schema details, row counts, numeric columns, and tiny familiarization samples when requested.",
      includeSamplesSchema,
      {
        label: "List Datasets",
        omit_args: ["includeSamples"],
      },
    ),
    buildToolDefinition(
      "run_aggregate_query",
      "Execute a validated aggregate query plan against the client-side dataset rows and return grouped or summary results.",
      runAggregateSchema,
      {
        label: "Run Aggregate Query",
        prominent_args: ["query_plan.dataset_id"],
        arg_labels: { "query_plan.dataset_id": "dataset" },
      },
    ),
    buildToolDefinition(
      "create_dataset",
      "Run a validated query plan locally and materialize the result rows as a CSV or JSON dataset export with the requested filename.",
      createDatasetSchema,
      {
        label: "Create Dataset",
        prominent_args: ["filename", "format", "query_plan.dataset_id"],
        arg_labels: {
          filename: "file",
          format: "format",
          "query_plan.dataset_id": "dataset",
        },
      },
    ),
  ];
}

export function createAnalysisAgentClientTools(
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return buildAnalysisAgentClientToolCatalog(workspace).map((definition) =>
    createBrokeredAgentTool(
      workspace,
      definition,
      definition.name as
        | "list_datasets"
        | "run_aggregate_query"
        | "create_dataset",
    ),
  );
}
