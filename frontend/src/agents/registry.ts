import agricultureAgentModule from "./agriculture-agent";
import analysisAgentModule from "./analysis-agent";
import chartAgentModule from "./chart-agent";
import documentAgentModule from "./document-agent";
import feedbackAgentModule from "./feedback-agent";
import reportAgentModule from "./report-agent";
import { buildAgentBundle } from "./shared/registry";
import type {
  AgentBundle,
  AgentClientTool,
  AgentModule,
  AgentRuntimeContext,
} from "./types";

export const agentModules: AgentModule[] = [
  reportAgentModule,
  analysisAgentModule,
  chartAgentModule,
  documentAgentModule,
  agricultureAgentModule,
  feedbackAgentModule,
];

export function buildAgentBundleForRoot(
  rootAgentId: string,
  workspace: AgentRuntimeContext,
): AgentBundle {
  return buildAgentBundle(rootAgentId, agentModules, workspace);
}

export function getAgentModule(agentId: string): AgentModule | null {
  return agentModules.find((agentModule) => agentModule.definition.id === agentId) ?? null;
}

export function listAgentBundleToolNames(agentBundle: AgentBundle): string[] {
  const seen = new Set<string>();
  const toolNames: string[] = [];

  for (const agent of agentBundle.agents) {
    for (const tool of agent.client_tools) {
      if (seen.has(tool.name)) {
        continue;
      }
      seen.add(tool.name);
      toolNames.push(tool.name);
    }
  }

  return toolNames;
}

export function bindClientToolsForAgentBundle(
  agentBundle: AgentBundle,
  workspace: AgentRuntimeContext,
): AgentClientTool[] {
  const seen = new Set<string>();
  const boundTools: AgentClientTool[] = [];

  for (const agent of agentBundle.agents) {
    const agentModule = getAgentModule(agent.agent_id);
    if (!agentModule) {
      throw new Error(`Unknown agent module: ${agent.agent_id}`);
    }

    const nextTools = agentModule.bindClientTools({
      ...workspace,
      agentId: agentModule.definition.id,
      agentTitle: agentModule.definition.title,
    });
    if (isPromiseLike(nextTools)) {
      throw new Error(
        `Async client tool binding is not supported for agent '${agent.agent_id}'.`,
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
  value: AgentClientTool[] | Promise<AgentClientTool[]>,
): value is Promise<AgentClientTool[]> {
  return typeof (value as PromiseLike<AgentClientTool[]> | null)?.then === "function";
}
