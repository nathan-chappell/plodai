import type { AgentClientTool, AgentRuntimeContext, FunctionToolDefinition } from "../types";
import {
  launchTourScenarioToolSchema,
  listTourScenariosToolSchema,
} from "../../lib/tool-schemas";
import { buildToolDefinition } from "../shared/tool-helpers";
import {
  buildDefaultTourPickerDisplaySpec,
  getDefaultTourScenario,
  listDefaultTourScenarios,
} from "./tour-catalog";

export function buildDefaultAgentClientToolCatalog(): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_tour_scenarios",
      "Open the guided tour picker with the curated report and document tour choices. Use this immediately when the user asks which tour to start with or wants help choosing.",
      listTourScenariosToolSchema,
      {
        label: "Open tour picker",
        tour_picker: buildDefaultTourPickerDisplaySpec(),
      },
    ),
    buildToolDefinition(
      "launch_tour_scenario",
      "Open the selected guided tour launcher so the user can upload files or use the built-in default pack.",
      launchTourScenarioToolSchema,
      {
        label: "Open tour launcher",
        prominent_args: ["scenario_id"],
      },
    ),
  ];
}

export function createDefaultAgentClientTools(
  _workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return [
    {
      ...buildDefaultAgentClientToolCatalog()[0],
      handler: async () => {
        const scenarios = await listDefaultTourScenarios();
        return {
          status: "waiting_for_user",
          tour_scenarios: scenarios,
          count: scenarios.length,
          next_action:
            "The guided tour picker is open in chat; wait for the user to choose a tour.",
        };
      },
    },
    {
      ...buildDefaultAgentClientToolCatalog()[1],
      handler: async (args, context) => {
        const scenarioId =
          typeof (args as { scenario_id?: unknown }).scenario_id === "string"
            ? (args as { scenario_id: string }).scenario_id.trim()
            : "";
        if (!scenarioId) {
          throw new Error("scenario_id is required.");
        }
        const scenario = await getDefaultTourScenario(scenarioId);
        if (!scenario) {
          throw new Error(`Unknown tour scenario: ${scenarioId}`);
        }
        context.emitEffect({
          type: "tour_requested",
          scenarioId: scenario.id,
          title: scenario.title,
          summary: scenario.summary,
          workspaceName: scenario.workspace_name,
          targetAgentId: scenario.target_agent_id,
          uploadConfig: scenario.upload_config,
          defaultAssetCount: scenario.default_assets.length,
        });
        return {
          status: "awaiting_user_input",
          scenario_id: scenario.id,
          title: scenario.title,
          summary: scenario.summary,
          workspace_name: scenario.workspace_name,
          agent_id: scenario.target_agent_id,
          target_agent_id: scenario.target_agent_id,
          default_asset_count: scenario.default_assets.length,
          upload_helper_text: scenario.upload_config.helper_text,
          next_action:
            "The tour launcher is open in chat; wait for the user to choose upload or built-in default.",
        };
      },
    },
  ];
}
