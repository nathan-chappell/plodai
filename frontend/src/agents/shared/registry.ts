import type {
  AgentBundle,
  AgentRuntimeContext,
  AgentRuntimeModule,
  AgentSpec,
} from "../types";

export function buildAgentBundle(
  rootAgentId: string,
  agentModules: AgentRuntimeModule[],
  workspace: AgentRuntimeContext,
): AgentBundle {
  const moduleByAgentId = new Map(
    agentModules.map((agentModule) => [agentModule.definition.id, agentModule]),
  );
  const visited = new Set<string>();
  const orderedAgentSpecs: AgentSpec[] = [];

  function visit(agentId: string) {
    if (visited.has(agentId)) {
      return;
    }
    visited.add(agentId);
    const agentModule = moduleByAgentId.get(agentId);
    if (!agentModule) {
      throw new Error(`Unknown agent dependency: ${agentId}`);
    }
    const agentSpec = agentModule.buildAgentSpec({
      ...workspace,
      agentId: agentModule.definition.id,
      agentTitle: agentModule.definition.title,
    });
    orderedAgentSpecs.push(agentSpec);
    for (const delegationTarget of agentSpec.delegation_targets) {
      visit(delegationTarget.agent_id);
    }
  }

  visit(rootAgentId);

  return {
    root_agent_id: rootAgentId,
    agents: orderedAgentSpecs,
  };
}
