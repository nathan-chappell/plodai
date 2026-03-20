import dataAgentModule from "./data-agent";
import chartAgentModule from "./chart-agent";
import csvAgentModule from "./csv-agent";
import feedbackAgentModule from "./feedback-agent";
import pdfAgentModule from "./pdf-agent";
import reportAgentModule from "./report-agent";
import workspaceAgentModule from "./workspace-agent";
import { buildToolProviderBundle } from "./shared/registry";
import type {
  ToolProviderBundle,
  ToolProviderClientTool,
  ToolProviderModule,
  ToolRuntimeContext,
} from "./types";

export const toolProviderModules: ToolProviderModule[] = [
  workspaceAgentModule,
  reportAgentModule,
  dataAgentModule,
  csvAgentModule,
  chartAgentModule,
  pdfAgentModule,
  feedbackAgentModule,
];

export function buildToolProviderBundleForRoot(
  rootToolProviderId: string,
  workspace: ToolRuntimeContext,
): ToolProviderBundle {
  return buildToolProviderBundle(rootToolProviderId, toolProviderModules, workspace);
}

export function getToolProviderModule(toolProviderId: string): ToolProviderModule | null {
  return (
    toolProviderModules.find(
      (toolProviderModule) => toolProviderModule.definition.id === toolProviderId,
    ) ?? null
  );
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
    const toolProviderModule = getToolProviderModule(toolProvider.tool_provider_id);
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

export const capabilityModules = toolProviderModules;
export const buildCapabilityBundleForRoot = buildToolProviderBundleForRoot;
export const getCapabilityModule = getToolProviderModule;
export const listCapabilityBundleToolNames = listToolProviderBundleToolNames;
export const bindClientToolsForBundle = bindClientToolsForToolProviderBundle;
