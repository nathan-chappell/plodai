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
      "Read the saved farm record with crops, issues, projects, and current work for this workspace.",
      getFarmStateToolSchema,
      {
        label: "Get Farm State",
      },
    ),
    buildToolDefinition(
      "save_farm_state",
      "Create or replace the saved farm record for this workspace after merging any updates the user asked for.",
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
