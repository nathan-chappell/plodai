import { createChartAgentClientTools } from "../chart-agent/tools";
import { createCsvAgentClientTools } from "../csv-agent/tools";
import { createPdfAgentClientTools } from "../pdf-agent/tools";
import type {
  CapabilityClientTool,
  CapabilityWorkspaceContext,
  FunctionToolDefinition,
} from "../types";
import { buildChartAgentClientToolCatalog } from "../chart-agent/tools";
import { buildCsvAgentClientToolCatalog } from "../csv-agent/tools";
import { buildPdfAgentClientToolCatalog } from "../pdf-agent/tools";

export function buildReportAgentClientToolCatalog(): FunctionToolDefinition[] {
  return buildUniqueDefinitions([
    ...buildCsvAgentClientToolCatalog(),
    ...buildChartAgentClientToolCatalog(),
    ...buildPdfAgentClientToolCatalog(),
  ]);
}

export function createReportAgentClientTools(
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool[] {
  return buildUniqueTools([
    ...createCsvAgentClientTools(workspace),
    ...createChartAgentClientTools(workspace),
    ...createPdfAgentClientTools(workspace),
  ]);
}

function buildUniqueTools(tools: CapabilityClientTool[]): CapabilityClientTool[] {
  const seen = new Set<string>();
  return tools.filter((tool) => {
    if (seen.has(tool.name)) {
      return false;
    }
    seen.add(tool.name);
    return true;
  });
}

function buildUniqueDefinitions(tools: FunctionToolDefinition[]): FunctionToolDefinition[] {
  const seen = new Set<string>();
  return tools.filter((tool) => {
    if (seen.has(tool.name)) {
      return false;
    }
    seen.add(tool.name);
    return true;
  });
}
