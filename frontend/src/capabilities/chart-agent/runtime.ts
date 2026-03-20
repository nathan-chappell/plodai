import { chartAgentCapability } from "../definitions";
import type { CapabilityRuntimeModule } from "../types";
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
4. Treat \`make_plan\` as a checkpoint, not an end state. When the chart goal is clear enough, continue immediately with more tool calls.
5. Use explicit keys for labels and series. Do not invent structure that is not present in the file.
6. JSON inputs must already be top-level arrays of objects.
7. When the best chart is clear from the available artifact, render it without asking for unnecessary confirmation.
8. When another agent or the user explicitly asks you to render a chart from a usable artifact, do the inspection you need, make the plan, and call \`render_chart_from_file\` in the same run.
9. Do not stop after schema inspection, planning, or a recommendation if the request still requires an actual rendered chart.
10. If the user's comparison, audience, or desired visual outcome is materially unclear, ask one concise clarifying question early.
11. Once the chart goal is clear enough, keep moving through planning and rendering rather than asking repeated follow-ups.
`.trim();

export const chartAgentRuntimeModule: CapabilityRuntimeModule = {
  definition: chartAgentCapability,
  buildAgentSpec: (workspace) => ({
    capability_id: "chart-agent",
    agent_name: "Chart Agent",
    instructions: CHART_AGENT_INSTRUCTIONS,
    client_tools: buildChartAgentClientToolCatalog(workspace),
    handoff_targets: [
      {
        capability_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createChartAgentClientTools(workspace),
};
