import chartAgentModule from "./chart-agent";
import csvAgentModule from "./csv-agent";
import feedbackAgentModule from "./feedback-agent";
import pdfAgentModule from "./pdf-agent";
import reportAgentModule from "./report-agent";
import workspaceAgentModule from "./workspace-agent";
import { buildCapabilityBundle } from "./shared/registry";
import type {
  CapabilityBundle,
  CapabilityClientTool,
  CapabilityModule,
  CapabilityWorkspaceContext,
} from "./types";

export const capabilityModules: CapabilityModule[] = [
  workspaceAgentModule,
  reportAgentModule,
  csvAgentModule,
  chartAgentModule,
  pdfAgentModule,
  feedbackAgentModule,
];

export function buildCapabilityBundleForRoot(
  rootCapabilityId: string,
  workspace: CapabilityWorkspaceContext,
): CapabilityBundle {
  return buildCapabilityBundle(rootCapabilityId, capabilityModules, workspace);
}

export function getCapabilityModule(capabilityId: string): CapabilityModule | null {
  return (
    capabilityModules.find(
      (capabilityModule) => capabilityModule.definition.id === capabilityId,
    ) ?? null
  );
}

export function listCapabilityBundleToolNames(capabilityBundle: CapabilityBundle): string[] {
  const seen = new Set<string>();
  const toolNames: string[] = [];

  for (const capability of capabilityBundle.capabilities) {
    for (const tool of capability.client_tools) {
      if (seen.has(tool.name)) {
        continue;
      }
      seen.add(tool.name);
      toolNames.push(tool.name);
    }
  }

  return toolNames;
}

export function bindClientToolsForBundle(
  capabilityBundle: CapabilityBundle,
  workspace: CapabilityWorkspaceContext,
): CapabilityClientTool[] {
  const seen = new Set<string>();
  const boundTools: CapabilityClientTool[] = [];

  for (const capability of capabilityBundle.capabilities) {
    const capabilityModule = getCapabilityModule(capability.capability_id);
    if (!capabilityModule) {
      throw new Error(`Unknown capability module: ${capability.capability_id}`);
    }

    const nextTools = capabilityModule.bindClientTools({
      ...workspace,
      capabilityId: capabilityModule.definition.id,
      capabilityTitle: capabilityModule.definition.title,
    });
    if (isPromiseLike(nextTools)) {
      throw new Error(
        `Async client tool binding is not supported for capability '${capability.capability_id}'.`,
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
  value: CapabilityClientTool[] | Promise<CapabilityClientTool[]>,
): value is Promise<CapabilityClientTool[]> {
  return typeof (value as PromiseLike<CapabilityClientTool[]> | null)?.then === "function";
}
