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

export function buildAgricultureAgentFarmToolCatalog(): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "get_farm_state",
      "Read the saved farm record for this workspace. Treat it as durable notes before adding new crop findings, issues, seasonal work, or orders.",
      getFarmStateToolSchema,
      {
        label: "Get Farm State",
      },
    ),
    buildToolDefinition(
      "save_farm_state",
      "Create or update the saved farm record for this workspace after merging new findings into the existing farm state. Use this as durable note-taking for important crop facts, issues, seasonal work, uncertainty, and orders.",
      saveFarmStateToolSchema,
      {
        label: "Save Farm State",
        prominent_args: ["farm_name"],
        arg_labels: { farm_name: "farm" },
      },
    ),
  ];
}

export function createAgricultureAgentFarmTools(
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return buildAgricultureAgentFarmToolCatalog().map((definition) =>
    createBrokeredAgentTool(
      workspace,
      definition,
      definition.name as "get_farm_state" | "save_farm_state",
    ),
  );
}
