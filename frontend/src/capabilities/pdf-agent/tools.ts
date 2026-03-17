import {
  createGetPdfPageRangeTool,
  createInspectPdfFileTool,
  createListWorkspaceFilesTool,
  createSmartSplitPdfTool,
  getPdfPageRangeToolDefinition,
  inspectPdfFileToolDefinition,
  listWorkspaceFilesToolDefinition,
  smartSplitPdfToolDefinition,
} from "../shared/client-tools";
import type {
  CapabilityClientTool,
  CapabilityWorkspaceContext,
  FunctionToolDefinition,
} from "../types";

export function buildPdfAgentClientToolCatalog(): FunctionToolDefinition[] {
  return [
    listWorkspaceFilesToolDefinition,
    inspectPdfFileToolDefinition,
    getPdfPageRangeToolDefinition,
    smartSplitPdfToolDefinition,
  ];
}

export function createPdfAgentClientTools(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool[] {
  return [
    createListWorkspaceFilesTool(workspace),
    createInspectPdfFileTool(workspace),
    createGetPdfPageRangeTool(workspace),
    createSmartSplitPdfTool(workspace),
  ];
}
