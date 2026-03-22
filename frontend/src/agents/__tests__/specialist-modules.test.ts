import { describe, expect, it } from "vitest";

import type { AgentRuntimeContext } from "../types";
import agricultureAgentModule from "../agriculture-agent";
import analysisAgentModule from "../analysis-agent";
import chartAgentModule from "../chart-agent";
import documentAgentModule from "../document-agent";
import { createEmptyAgentShellState } from "../../lib/shell-resources";

function createWorkspace(): AgentRuntimeContext {
  const state = createEmptyAgentShellState();
  return {
    activeAgentId: "default-agent",
    getAgentState: () => state,
    updateAgentState: () => undefined,
    replaceAgentResources: () => undefined,
    listAgentResources: () => [],
    listSharedResources: () => [],
    resolveResource: () => null,
    selectAgent: () => undefined,
  };
}

describe("specialist agent modules", () => {
  it("tell the specialists to ask one concise clarifying question only when needed", () => {
    const workspace = createWorkspace();

    for (const module of [
      analysisAgentModule,
      chartAgentModule,
      documentAgentModule,
      agricultureAgentModule,
    ]) {
      const instructions = module.buildAgentSpec(workspace).instructions;
      expect(instructions).toContain("ask one concise clarifying question early");
      expect(instructions).toContain("asking repeated follow-ups");
    }
  });

  it("keeps the agriculture agent photo-first while reusing the same report by default", () => {
    const instructions = agricultureAgentModule.buildAgentSpec(createWorkspace()).instructions;

    expect(instructions).toContain("image evidence alone");
    expect(instructions).toContain("list_reports");
    expect(instructions).toContain("create_report");
    expect(instructions).toContain("same report");
  });
});
