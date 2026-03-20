import { buildCapabilityBundle } from "./shared/registry";
import type {
  CapabilityBundle,
  CapabilityClientTool,
  CapabilityRuntimeModule,
  CapabilityWorkspaceContext,
} from "./types";
import { chartAgentRuntimeModule } from "./chart-agent/runtime";
import { csvAgentRuntimeModule } from "./csv-agent/runtime";
import { feedbackAgentRuntimeModule } from "./feedback-agent/runtime";
import { pdfAgentRuntimeModule } from "./pdf-agent/runtime";
import { reportAgentRuntimeModule } from "./report-agent/runtime";
import { workspaceAgentRuntimeModule } from "./workspace-agent/runtime";

const runtimeCapabilityModules: CapabilityRuntimeModule[] = [
  workspaceAgentRuntimeModule,
  reportAgentRuntimeModule,
  csvAgentRuntimeModule,
  chartAgentRuntimeModule,
  pdfAgentRuntimeModule,
  feedbackAgentRuntimeModule,
];

function getRuntimeCapabilityModule(capabilityId: string): CapabilityRuntimeModule | null {
  return (
    runtimeCapabilityModules.find(
      (capabilityModule) => capabilityModule.definition.id === capabilityId,
    ) ?? null
  );
}

export function buildCapabilityBundleForRoot(
  rootCapabilityId: string,
  workspace: CapabilityWorkspaceContext,
): CapabilityBundle {
  return buildCapabilityBundle(rootCapabilityId, runtimeCapabilityModules, workspace);
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
    const capabilityModule = getRuntimeCapabilityModule(capability.capability_id);
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
