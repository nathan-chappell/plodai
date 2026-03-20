import { buildToolProviderBundle } from "./shared/registry";
import type {
  ToolProviderBundle,
  ToolProviderClientTool,
  ToolProviderRuntimeModule,
  ToolRuntimeContext,
} from "./types";
import { chartAgentRuntimeModule } from "./chart-agent/runtime";
import { csvAgentRuntimeModule } from "./csv-agent/runtime";
import { dataAgentRuntimeModule } from "./data-agent/runtime";
import { feedbackAgentRuntimeModule } from "./feedback-agent/runtime";
import { pdfAgentRuntimeModule } from "./pdf-agent/runtime";
import { reportAgentRuntimeModule } from "./report-agent/runtime";
import { workspaceAgentRuntimeModule } from "./workspace-agent/runtime";

const runtimeToolProviderModules: ToolProviderRuntimeModule[] = [
  workspaceAgentRuntimeModule,
  reportAgentRuntimeModule,
  dataAgentRuntimeModule,
  csvAgentRuntimeModule,
  chartAgentRuntimeModule,
  pdfAgentRuntimeModule,
  feedbackAgentRuntimeModule,
];

function getRuntimeToolProviderModule(toolProviderId: string): ToolProviderRuntimeModule | null {
  return (
    runtimeToolProviderModules.find(
      (toolProviderModule) => toolProviderModule.definition.id === toolProviderId,
    ) ?? null
  );
}

export function buildToolProviderBundleForRoot(
  rootToolProviderId: string,
  workspace: ToolRuntimeContext,
): ToolProviderBundle {
  return buildToolProviderBundle(rootToolProviderId, runtimeToolProviderModules, workspace);
}

export function listToolProviderBundleToolNames(toolProviderBundle: ToolProviderBundle): string[] {
  const seen = new Set<string>();
  const toolNames: string[] = [];

  for (const toolProvider of toolProviderBundle.tool_providers) {
    for (const tool of toolProvider.client_tools) {
      if (seen.has(tool.name)) {
        continue;
      }
      seen.add(tool.name);
      toolNames.push(tool.name);
    }
  }

  return toolNames;
}

export function bindClientToolsForToolProviderBundle(
  toolProviderBundle: ToolProviderBundle,
  workspace: ToolRuntimeContext,
): ToolProviderClientTool[] {
  const seen = new Set<string>();
  const boundTools: ToolProviderClientTool[] = [];

  for (const toolProvider of toolProviderBundle.tool_providers) {
    const toolProviderModule = getRuntimeToolProviderModule(toolProvider.tool_provider_id);
    if (!toolProviderModule) {
      throw new Error(`Unknown tool provider module: ${toolProvider.tool_provider_id}`);
    }

    const nextTools = toolProviderModule.bindClientTools({
      ...workspace,
      toolProviderId: toolProviderModule.definition.id,
      toolProviderTitle: toolProviderModule.definition.title,
    });
    if (isPromiseLike(nextTools)) {
      throw new Error(
        `Async client tool binding is not supported for tool provider '${toolProvider.tool_provider_id}'.`,
      );
    }

    for (const tool of nextTools) {
      if (seen.has(tool.name)) {
        continue;
      }
      seen.add(tool.name);
      boundTools.push(tool);
    }
  }

  return boundTools;
}

function isPromiseLike(
  value: ToolProviderClientTool[] | Promise<ToolProviderClientTool[]>,
): value is Promise<ToolProviderClientTool[]> {
  return typeof (value as PromiseLike<ToolProviderClientTool[]> | null)?.then === "function";
}

export const buildCapabilityBundleForRoot = buildToolProviderBundleForRoot;
export const listCapabilityBundleToolNames = listToolProviderBundleToolNames;
export const bindClientToolsForBundle = bindClientToolsForToolProviderBundle;
