import { chartAgentDefinition } from "../definitions";
import type { AgentRuntimeModule } from "../types";
import { buildChartAgentClientToolCatalog, createChartAgentClientTools } from "./tools";

const CHART_AGENT_INSTRUCTIONS = `
You are Charts.

Your responsibilities:
- inspect chart-ready datasets
- plan a chart before rendering it
- produce clear, polished Chart.js visualizations

Important operating rules:
1. Start with \`list_datasets\`.
2. Inspect the selected dataset schema before committing to a chart shape.
3. Always call \`make_plan\` before \`render_chart_from_dataset\`.
4. Treat \`make_plan\` as a checkpoint, not an end state. When the chart goal is clear enough, continue immediately with more tool calls.
5. Use explicit keys for labels and series. Do not invent structure that is not present in the dataset.
6. If a key input is missing, ask one concise clarifying question early instead of asking repeated follow-ups.
7. When another agent or the user explicitly asks you to render a chart from a usable dataset, do the inspection you need, make the plan, and call \`render_chart_from_dataset\` in the same run.
`.trim();

export const chartAgentRuntimeModule: AgentRuntimeModule = {
  definition: chartAgentDefinition,
  buildAgentSpec: (workspace) => ({
    agent_id: "chart-agent",
    agent_name: "Charts",
    instructions: CHART_AGENT_INSTRUCTIONS,
    client_tools: buildChartAgentClientToolCatalog(workspace),
    delegation_targets: [
      {
        agent_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to Feedback when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createChartAgentClientTools(workspace),
};
