import type { AgentClientTool, AgentRuntimeContext, FunctionToolDefinition } from "../types";
import {
  launchDemoScenarioToolSchema,
  listDemoScenariosToolSchema,
} from "../../lib/tool-schemas";
import { buildToolDefinition } from "../shared/tool-helpers";
import {
  getHelpDemoScenario,
  listHelpDemoScenarios,
  summarizeHelpDemoScenario,
} from "./demo-catalog";
import { buildResourceFromFile } from "../../lib/shell-resources";

export function buildHelpAgentClientToolCatalog(): FunctionToolDefinition[] {
  return [
    buildToolDefinition(
      "list_demo_scenarios",
      "List the curated report and document demos that Help can launch into fresh agent-owned shells.",
      listDemoScenariosToolSchema,
      {
        label: "List demos",
      },
    ),
    buildToolDefinition(
      "launch_demo_scenario",
      "Seed the selected agent with the demo exports, switch the shell to that agent, and queue the first guided prompt.",
      launchDemoScenarioToolSchema,
      {
        label: "Launch demo",
        prominent_args: ["scenario_id"],
      },
    ),
  ];
}

export function createHelpAgentClientTools(
  _workspace: AgentRuntimeContext,
): AgentClientTool[] {
  return [
    {
      ...buildHelpAgentClientToolCatalog()[0],
      handler: async () => {
        const scenarios = await listHelpDemoScenarios();
        return {
          demo_scenarios: scenarios.map(summarizeHelpDemoScenario),
          count: scenarios.length,
        };
      },
    },
    {
      ...buildHelpAgentClientToolCatalog()[1],
      handler: async (args, context) => {
        const scenarioId =
          typeof (args as { scenario_id?: unknown }).scenario_id === "string"
            ? (args as { scenario_id: string }).scenario_id.trim()
            : "";
        if (!scenarioId) {
          throw new Error("scenario_id is required.");
        }
        const scenario = await getHelpDemoScenario(scenarioId);
        if (!scenario) {
          throw new Error(`Unknown demo scenario: ${scenarioId}`);
        }
        const resources = scenario.seed_files.map((file) =>
          buildResourceFromFile(scenario.target_agent_id, file),
        );
        context.replaceAgentResources(scenario.target_agent_id, resources);
        context.selectAgent(scenario.target_agent_id);
        context.schedulePrompt(scenario.initial_prompt, scenario.model);
        return {
          status: "launched",
          ...summarizeHelpDemoScenario(scenario),
          agent_id: scenario.target_agent_id,
          initial_prompt_queued: true,
          initial_prompt: scenario.initial_prompt,
        };
      },
    },
  ];
}
