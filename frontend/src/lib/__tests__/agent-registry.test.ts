import { describe, expect, it } from "vitest";

import {
  bindClientToolsForAgentBundle,
  buildAgentBundleForRoot,
  getAgentModule,
  listAgentBundleToolNames,
} from "../../agents/registry";
import type { AgentRuntimeContext } from "../../agents/types";
import { createEmptyAgentShellState } from "../shell-resources";

function agentIdsFor(rootAgentId: string): string[] {
  return buildAgentBundleForRoot(rootAgentId, createWorkspaceContext()).agents.map(
    (agent) => agent.agent_id,
  );
}

function createWorkspaceContext(
): AgentRuntimeContext {
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

describe("agent registry", () => {
  it("returns the expected dependency graph for the help agent", () => {
    expect(agentIdsFor("default-agent")).toEqual([
      "default-agent",
      "report-agent",
      "analysis-agent",
      "chart-agent",
      "feedback-agent",
      "document-agent",
      "agriculture-agent",
    ]);
  });

  it("returns the expected dependency graph for the report agent", () => {
    expect(agentIdsFor("report-agent")).toEqual([
      "report-agent",
      "analysis-agent",
      "chart-agent",
      "feedback-agent",
      "document-agent",
    ]);
  });

  it("returns the expected dependency graph for the analysis agent", () => {
    expect(agentIdsFor("analysis-agent")).toEqual([
      "analysis-agent",
      "chart-agent",
      "feedback-agent",
    ]);
  });

  it("returns standalone bundles for chart and document agents", () => {
    expect(agentIdsFor("chart-agent")).toEqual(["chart-agent", "feedback-agent"]);
    expect(agentIdsFor("document-agent")).toEqual(["document-agent", "feedback-agent"]);
  });

  it("exposes agent modules by id", () => {
    expect(getAgentModule("default-agent")?.definition.path).toBe("/workspace");
    expect(getAgentModule("agriculture-agent")?.definition.path).toBe("/workspace/agriculture");
    expect(getAgentModule("missing-agent")).toBeNull();
  });

  it("keeps the root report agent limited to report CRUD tools", () => {
    const workspace = createWorkspaceContext();
    const bundle = buildAgentBundleForRoot("report-agent", workspace);
    const rootSpec = bundle.agents.find(
      (agent) => agent.agent_id === "report-agent",
    );

    expect(rootSpec?.client_tools.map((tool) => tool.name)).toEqual([
      "list_reports",
      "get_report",
      "create_report",
      "append_report_slide",
      "remove_report_slide",
    ]);
  });

  it("serializes the bundled tour-picker metadata on the default-agent chooser tool", () => {
    const workspace = createWorkspaceContext();
    const bundle = buildAgentBundleForRoot("default-agent", workspace);
    const rootSpec = bundle.agents.find(
      (agent) => agent.agent_id === "default-agent",
    );
    const chooserTool = rootSpec?.client_tools.find(
      (tool) => tool.name === "list_tour_scenarios",
    );

    expect(chooserTool?.display).toMatchObject({
      label: "Open tour picker",
      tour_picker: {
        title: "Choose a guided tour",
        scenarios: [
          {
            scenario_id: "report-tour",
            title: "Report tour",
          },
          {
            scenario_id: "document-tour",
            title: "Document tour",
          },
        ],
      },
    });
  });

  it("binds unique tools across delegated agent bundles", () => {
    const workspace = createWorkspaceContext();
    const toolNames = bindClientToolsForAgentBundle(
      buildAgentBundleForRoot("default-agent", workspace),
      workspace,
    ).map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining([
      "list_tour_scenarios",
      "launch_tour_scenario",
      "list_reports",
      "append_report_slide",
      "list_datasets",
      "create_dataset",
      "inspect_dataset_schema",
      "render_chart_from_dataset",
      "list_pdf_files",
      "list_image_files",
      "inspect_image_file",
    ]));
    expect(toolNames).toHaveLength(new Set(toolNames).size);
  });

  it("lists unique tool names declared across agriculture dependencies", () => {
    const toolNames = listAgentBundleToolNames(
      buildAgentBundleForRoot("agriculture-agent", createWorkspaceContext()),
    );

    expect(toolNames).toEqual(expect.arrayContaining([
      "list_image_files",
      "inspect_image_file",
      "list_reports",
      "create_report",
      "append_report_slide",
    ]));
    expect(toolNames).toHaveLength(new Set(toolNames).size);
  });
});
