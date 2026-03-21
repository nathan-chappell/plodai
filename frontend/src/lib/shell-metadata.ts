import { normalizeAgentShellState, summarizeAgentShellState, summarizeSharedExport } from "./shell-resources";
import type { AgentShellState, ShellStateMetadata, SharedExportSummary } from "../types/shell";

export function buildSharedExportsIndex(
  statesByAgentId: Record<string, AgentShellState>,
): SharedExportSummary[] {
  return Object.entries(statesByAgentId)
    .flatMap(([agentId, state]) =>
      normalizeAgentShellState(state).resources
        .filter((resource) => resource.visibility === "shared" && resource.owner_agent_id === agentId)
        .map((resource) => summarizeSharedExport(resource)),
    )
    .sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    );
}

export function buildShellStateMetadata(args: {
  activeAgentId: string;
  statesByAgentId: Record<string, AgentShellState>;
}): ShellStateMetadata {
  const agents = Object.entries(args.statesByAgentId)
    .map(([agentId, state]) => summarizeAgentShellState(agentId, state))
    .sort((left, right) => left.agent_id.localeCompare(right.agent_id));

  return {
    version: "v1",
    active_agent_id: args.activeAgentId,
    agents,
    resources: buildSharedExportsIndex(args.statesByAgentId),
  };
}
