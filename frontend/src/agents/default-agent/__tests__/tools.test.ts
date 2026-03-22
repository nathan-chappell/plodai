import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEmptyAgentShellState } from "../../../lib/shell-resources";
import type { AgentRuntimeContext } from "../../types";

const {
  buildDefaultTourPickerDisplaySpecMock,
  getDefaultTourScenarioMock,
  listDefaultTourScenariosMock,
} = vi.hoisted(() => ({
  buildDefaultTourPickerDisplaySpecMock: vi.fn(),
  getDefaultTourScenarioMock: vi.fn(),
  listDefaultTourScenariosMock: vi.fn(),
}));

vi.mock("../tour-catalog", () => ({
  buildDefaultTourPickerDisplaySpec: buildDefaultTourPickerDisplaySpecMock,
  getDefaultTourScenario: getDefaultTourScenarioMock,
  listDefaultTourScenarios: listDefaultTourScenariosMock,
}));

import {
  buildDefaultAgentClientToolCatalog,
  createDefaultAgentClientTools,
} from "../tools";

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

describe("default-agent tools", () => {
  beforeEach(() => {
    buildDefaultTourPickerDisplaySpecMock.mockReset();
    getDefaultTourScenarioMock.mockReset();
    listDefaultTourScenariosMock.mockReset();
  });

  it("includes the bundled tour-picker display metadata on the chooser tool", () => {
    buildDefaultTourPickerDisplaySpecMock.mockReturnValue({
      title: "Choose a guided tour",
      summary: "Pick the best guided sample.",
      scenarios: [
        {
          scenario_id: "report-tour",
          title: "Report tour",
          summary: "Create one chart-backed report slide.",
          workspace_name: "Report tour",
          target_agent_id: "report-agent",
          default_asset_count: 2,
        },
      ],
    });

    expect(buildDefaultAgentClientToolCatalog()[0]?.display).toEqual({
      label: "Open tour picker",
      tour_picker: {
        title: "Choose a guided tour",
        summary: "Pick the best guided sample.",
        scenarios: [
          {
            scenario_id: "report-tour",
            title: "Report tour",
            summary: "Create one chart-backed report slide.",
            workspace_name: "Report tour",
            target_agent_id: "report-agent",
            default_asset_count: 2,
          },
        ],
      },
    });
  });

  it("returns the available tour summaries without trying to open local picker chrome", async () => {
    buildDefaultTourPickerDisplaySpecMock.mockReturnValue({
      title: "Choose a guided tour",
      summary: "Pick the best guided sample.",
      scenarios: [],
    });
    listDefaultTourScenariosMock.mockResolvedValue([
      {
        id: "report-tour",
        title: "Report tour",
        summary: "Create one chart-backed report slide.",
        workspace_name: "Report tour",
        target_agent_id: "report-agent",
        default_asset_count: 2,
        suggested_prompts: ["Start the report tour."],
      },
    ]);

    const emitEffect = vi.fn();
    const [listTool] = createDefaultAgentClientTools(createWorkspace());
    const result = await listTool.handler({}, {
      emitEffect,
      emitEffects: () => undefined,
      selectAgent: () => undefined,
      replaceAgentResources: () => undefined,
    });

    expect(result).toEqual({
      status: "waiting_for_user",
      tour_scenarios: [
        {
          id: "report-tour",
          title: "Report tour",
          summary: "Create one chart-backed report slide.",
          workspace_name: "Report tour",
          target_agent_id: "report-agent",
          default_asset_count: 2,
          suggested_prompts: ["Start the report tour."],
        },
      ],
      count: 1,
      next_action:
        "The guided tour picker is open in chat; wait for the user to choose a tour.",
    });
    expect(emitEffect).not.toHaveBeenCalled();
  });

  it("opens the report tour chooser and returns awaiting-user-input guidance", async () => {
    buildDefaultTourPickerDisplaySpecMock.mockReturnValue({
      title: "Choose a guided tour",
      summary: "Pick the best guided sample.",
      scenarios: [],
    });
    getDefaultTourScenarioMock.mockResolvedValue({
      id: "report-tour",
      title: "Report tour",
      summary: "Create one chart-backed report slide.",
      workspace_name: "Report tour",
      target_agent_id: "report-agent",
      upload_config: {
        accept: {
          "text/csv": [".csv"],
          "application/pdf": [".pdf"],
        },
        max_count: 4,
        helper_text: "Upload one or more reporting inputs.",
      },
      default_assets: [
        {
          public_path: "/tours/report/board_sales.csv",
          file_name: "board_sales.csv",
          mime_type: "text/csv",
        },
        {
          public_path: "/tours/report/board_pack.pdf",
          file_name: "board_pack.pdf",
          mime_type: "application/pdf",
        },
      ],
      launch_prompt: "Start the report tour in the current workspace.",
      suggested_prompts: ["Start the report tour."],
      model: "lightweight",
    });

    const replaceAgentResources = vi.fn();
    const selectAgent = vi.fn();
    const emitEffect = vi.fn();
    const [, launchTool] = createDefaultAgentClientTools(createWorkspace());
    const result = await launchTool.handler(
      { scenario_id: "report-tour" },
      {
        emitEffect,
        emitEffects: () => undefined,
        selectAgent,
        replaceAgentResources,
      },
    );

    expect(replaceAgentResources).not.toHaveBeenCalled();
    expect(selectAgent).not.toHaveBeenCalled();
    expect(emitEffect).toHaveBeenCalledWith({
      type: "tour_requested",
      scenarioId: "report-tour",
      title: "Report tour",
      summary: "Create one chart-backed report slide.",
      workspaceName: "Report tour",
      targetAgentId: "report-agent",
      uploadConfig: {
        accept: {
          "text/csv": [".csv"],
          "application/pdf": [".pdf"],
        },
        max_count: 4,
        helper_text: "Upload one or more reporting inputs.",
      },
      defaultAssetCount: 2,
    });
    expect(result).toEqual({
      status: "awaiting_user_input",
      scenario_id: "report-tour",
      title: "Report tour",
      summary: "Create one chart-backed report slide.",
      workspace_name: "Report tour",
      agent_id: "report-agent",
      target_agent_id: "report-agent",
      default_asset_count: 2,
      upload_helper_text: "Upload one or more reporting inputs.",
      next_action:
        "The tour launcher is open in chat; wait for the user to choose upload or built-in default.",
    });
  });
});
