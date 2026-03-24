import {
  getFarmStateToolSchema,
  saveFarmStateToolSchema,
} from "../../lib/tool-schemas";
import {
  buildToolDefinition,
  createBrokeredAgentTool,
} from "../shared/tool-helpers";
import type {
  AgentClientTool,
  AgentRuntimeContext,
  FunctionToolDefinition,
} from "../types";

export function buildPlodaiAgentFarmToolCatalog(): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "get_farm_state",
      "Read the saved farm record for this workspace. Treat it as durable notes before adding new crop findings, observations, seasonal guidance, or orders.",
      getFarmStateToolSchema,
      {
        label: "Get Farm State",
      },
    ),
    buildToolDefinition(
      "save_farm_state",
      "Create or update the saved farm record for this workspace after merging new findings into the existing farm state. Use this as durable note-taking for important crop facts, observations, uncertainty, and orders. Keep expected_yield to the estimate only, and keep notes terse, actionable, and durable.",
      saveFarmStateToolSchema,
      {
        label: "Save Farm State",
        prominent_args: ["farm_name"],
        arg_labels: { farm_name: "farm" },
      },
    ),
  ];
}

export function createPlodaiAgentFarmTools(
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return buildPlodaiAgentFarmToolCatalog().map((definition) =>
    createBrokeredAgentTool(
      workspace,
      definition,
      definition.name as "get_farm_state" | "save_farm_state",
    ),
  );
}
