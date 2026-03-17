import {
  createCsvFileToolDefinition,
  createJsonFileToolDefinition,
  createCreateCsvFileTool,
  createCreateJsonFileTool,
  createListAttachedCsvFilesTool,
  createListWorkspaceFilesTool,
  createRunAggregateQueryTool,
  listAttachedCsvFilesToolDefinition,
  listWorkspaceFilesToolDefinition,
  runAggregateQueryToolDefinition,
} from "../shared/client-tools";
import type {
  CapabilityClientTool,
  CapabilityWorkspaceContext,
  FunctionToolDefinition,
} from "../types";

export function buildCsvAgentClientToolCatalog(): FunctionToolDefinition[] {
  return [
    listWorkspaceFilesToolDefinition,
    listAttachedCsvFilesToolDefinition,
    runAggregateQueryToolDefinition,
    createCsvFileToolDefinition,
    createJsonFileToolDefinition,
  ];
}

export function createCsvAgentClientTools(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool[] {
  return [
    createListWorkspaceFilesTool(workspace),
    createListAttachedCsvFilesTool(workspace),
    createRunAggregateQueryTool(workspace),
    createCreateCsvFileTool(workspace),
    createCreateJsonFileTool(workspace),
  ];
}
