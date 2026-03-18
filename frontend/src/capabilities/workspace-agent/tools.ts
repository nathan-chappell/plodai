import {
  createChangeWorkspaceDirectoryTool,
  createCreateWorkspaceDirectoryTool,
  createGetWorkspaceContextTool,
  changeWorkspaceDirectoryToolDefinition,
  createWorkspaceDirectoryToolDefinition,
  getWorkspaceContextToolDefinition,
} from "../shared/client-tools";
import type {
  CapabilityClientTool,
  CapabilityWorkspaceContext,
  FunctionToolDefinition,
} from "../types";

export function buildWorkspaceAgentClientToolCatalog(): FunctionToolDefinition[] {
  return [
    getWorkspaceContextToolDefinition,
    createWorkspaceDirectoryToolDefinition,
    changeWorkspaceDirectoryToolDefinition,
  ];
}

export function createWorkspaceAgentClientTools(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool[] {
  return [
    createGetWorkspaceContextTool(workspace),
    createCreateWorkspaceDirectoryTool(workspace),
    createChangeWorkspaceDirectoryTool(workspace),
  ];
}

