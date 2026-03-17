import {
  createInspectChartableFileSchemaTool,
  createListChartableFilesTool,
  createRenderChartFromFileTool,
  inspectChartableFileSchemaToolDefinition,
  listChartableFilesToolDefinition,
  renderChartFromFileToolDefinition,
} from "../shared/client-tools";
import type {
  CapabilityClientTool,
  CapabilityWorkspaceContext,
  FunctionToolDefinition,
} from "../types";

export function buildChartAgentClientToolCatalog(): FunctionToolDefinition[] {
  return [
    listChartableFilesToolDefinition,
    inspectChartableFileSchemaToolDefinition,
    renderChartFromFileToolDefinition,
  ];
}

export function createChartAgentClientTools(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool[] {
  return [
    createListChartableFilesTool(workspace),
    createInspectChartableFileSchemaTool(workspace),
    createRenderChartFromFileTool(workspace),
  ];
}
