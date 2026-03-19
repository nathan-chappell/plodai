import type {
  CapabilityAgentSpec,
  CapabilityBundle,
  CapabilityModule,
  CapabilityWorkspaceContext,
} from "../types";

export function buildCapabilityBundle(
  rootCapabilityId: string,
  capabilityModules: CapabilityModule[],
  workspace: CapabilityWorkspaceContext,
): CapabilityBundle {
  const moduleByCapabilityId = new Map(
    capabilityModules.map((capabilityModule) => [
      capabilityModule.definition.id,
      capabilityModule,
    ]),
  );
  const visited = new Set<string>();
  const orderedCapabilitySpecs: CapabilityAgentSpec[] = [];

  function visit(capabilityId: string) {
    if (visited.has(capabilityId)) {
      return;
    }
    visited.add(capabilityId);
    const capabilityModule = moduleByCapabilityId.get(capabilityId);
    if (!capabilityModule) {
      throw new Error(`Unknown capability dependency: ${capabilityId}`);
    }
    const capabilityAgentSpec = capabilityModule.buildAgentSpec(workspace);
    orderedCapabilitySpecs.push(capabilityAgentSpec);
    for (const handoffTarget of capabilityAgentSpec.handoff_targets) {
      visit(handoffTarget.capability_id);
    }
  }

  visit(rootCapabilityId);

  return {
    root_capability_id: rootCapabilityId,
    capabilities: orderedCapabilitySpecs,
  };
}
