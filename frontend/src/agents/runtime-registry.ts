import { buildAgentBundle } from "./shared/registry";
import type {
  AgentBundle,
  AgentClientTool,
  AgentRuntimeModule,
  AgentRuntimeContext,
} from "./types";
import { agricultureAgentRuntimeModule } from "./agriculture-agent/runtime";
import { analysisAgentRuntimeModule } from "./analysis-agent/runtime";
import { chartAgentRuntimeModule } from "./chart-agent/runtime";
import { documentAgentRuntimeModule } from "./document-agent/runtime";
import { feedbackAgentRuntimeModule } from "./feedback-agent/runtime";
import { reportAgentRuntimeModule } from "./report-agent/runtime";

const runtimeAgentModules: AgentRuntimeModule[] = [
  reportAgentRuntimeModule,
  analysisAgentRuntimeModule,
  chartAgentRuntimeModule,
  documentAgentRuntimeModule,
  agricultureAgentRuntimeModule,
  feedbackAgentRuntimeModule,
];

function getRuntimeAgentModule(agentId: string): AgentRuntimeModule | null {
  return (
    runtimeAgentModules.find((agentModule) => agentModule.definition.id === agentId) ??
    null
  );
}

export function buildAgentBundleForRoot(
  rootAgentId: string,
  workspace: AgentRuntimeContext,
): AgentBundle {
  return buildAgentBundle(rootAgentId, runtimeAgentModules, workspace);
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
    const agentModule = getRuntimeAgentModule(agent.agent_id);
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
