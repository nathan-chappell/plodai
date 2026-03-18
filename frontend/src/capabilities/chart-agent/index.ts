import { chartAgentCapability } from "../definitions";
import { ChartAgentPage } from "../chartAgent";
import type { CapabilityModule } from "../types";
import { buildChartAgentDemoScenario } from "./demo";
import { buildChartAgentClientToolCatalog, createChartAgentClientTools } from "./tools";

const CHART_AGENT_INSTRUCTIONS = `
You are the Chart Agent.

Your responsibilities:
- inspect chartable CSV and JSON artifacts
- plan a chart before rendering it
- produce clear, beautiful Chart.js visualizations

Important operating rules:
1. Start with \`list_chartable_files\`.
2. Inspect the selected artifact schema before committing to a chart shape.
3. Always call \`make_plan\` before \`render_chart_from_file\`.
4. Use explicit keys for labels and series. Do not invent structure that is not present in the file.
5. JSON inputs must already be top-level arrays of objects.
6. When the best chart is clear from the available artifact, render it without asking for unnecessary confirmation.
`.trim();

export const chartAgentModule: CapabilityModule = {
  definition: chartAgentCapability,
  buildAgentSpec: () => ({
    capability_id: "chart-agent",
    agent_name: "Chart Agent",
    instructions: CHART_AGENT_INSTRUCTIONS,
    client_tools: buildChartAgentClientToolCatalog(),
    handoff_targets: [
      {
        capability_id: "workspace-agent",
        tool_name: "delegate_to_workspace_agent",
        description: "Hand off to the Workspace Agent when the next step is inspecting the current working directory, creating directories, or changing directories.",
      },
      {
        capability_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  buildDemoScenario: () => buildChartAgentDemoScenario(),
  bindClientTools: (workspace) => createChartAgentClientTools(workspace),
  Page: ChartAgentPage,
};
