import type {
  AgentClientTool,
  AgentRuntimeContext,
  FunctionToolDefinition,
} from "../types";

export function buildFeedbackAgentClientToolCatalog(): FunctionToolDefinition[] {
  return [];
}

export function createFeedbackAgentClientTools(
  _workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return [];
}
