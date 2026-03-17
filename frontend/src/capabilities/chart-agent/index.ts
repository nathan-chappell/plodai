import { ChartAgentPage, chartAgentCapability } from "../chartAgent";
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
`.trim();

export const chartAgentModule: CapabilityModule = {
  definition: chartAgentCapability,
  buildAgentSpec: () => ({
    capability_id: "chart-agent",
    agent_name: "Chart Agent",
    instructions: CHART_AGENT_INSTRUCTIONS,
    client_tools: buildChartAgentClientToolCatalog(),
    handoff_targets: [],
  }),
  buildDemoScenario: () => buildChartAgentDemoScenario(),
  bindClientTools: (workspace) => createChartAgentClientTools(workspace),
  Page: ChartAgentPage,
};
