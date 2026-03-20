import type {
  ToolProviderRuntimeModule,
  ToolProviderBundle,
  ToolProviderSpec,
  ToolRuntimeContext,
} from "../types";

export function buildToolProviderBundle(
  rootToolProviderId: string,
  toolProviderModules: ToolProviderRuntimeModule[],
  workspace: ToolRuntimeContext,
): ToolProviderBundle {
  const moduleByCapabilityId = new Map(
    toolProviderModules.map((toolProviderModule) => [
      toolProviderModule.definition.id,
      toolProviderModule,
    ]),
  );
  const visited = new Set<string>();
  const orderedToolProviderSpecs: ToolProviderSpec[] = [];

  function visit(toolProviderId: string) {
    if (visited.has(toolProviderId)) {
      return;
    }
    visited.add(toolProviderId);
    const toolProviderModule = moduleByCapabilityId.get(toolProviderId);
    if (!toolProviderModule) {
      throw new Error(`Unknown tool provider dependency: ${toolProviderId}`);
    }
    const toolProviderSpec = toolProviderModule.buildAgentSpec(workspace);
    orderedToolProviderSpecs.push(toolProviderSpec);
    for (const delegationTarget of toolProviderSpec.delegation_targets) {
      visit(delegationTarget.tool_provider_id);
    }
  }

  visit(rootToolProviderId);

  return {
    root_tool_provider_id: rootToolProviderId,
    tool_providers: orderedToolProviderSpecs,
  };
}

export const buildCapabilityBundle = buildToolProviderBundle;
