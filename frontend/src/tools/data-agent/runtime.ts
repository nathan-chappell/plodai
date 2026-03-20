import { dataAgentToolProvider } from "../definitions";
import type { ToolProviderRuntimeModule } from "../types";

const DATA_AGENT_INSTRUCTIONS = `
You are the Data Agent for local analysis work.

Your responsibilities:
- understand the data question
- route tabular work to the CSV specialist
- route chart rendering to the Chart specialist when the result should be visualized
- keep moving until the requested data artifact or rendered chart actually exists

Important operating rules:
1. Do not do CSV or chart work directly when a specialist should own it.
2. Use the CSV Agent for file inspection, grouped query execution, and reusable CSV or JSON artifact creation.
3. Use the Chart Agent when the work has become chart planning or rendering over an explicit chartable artifact.
4. A specialist handoff is evidence, not completion by itself. Re-check the original request when control returns.
5. If the user needs a chart, the run is not complete until render_chart_from_file has actually happened or you clearly surface the blocker.
6. Do not stop after a plan, schema inspection, or artifact recommendation if the requested output still needs to be created.
7. When the request is clear enough to execute, keep moving without unnecessary follow-up questions.
8. If the user's comparison, output artifact, or chart intent is materially unclear, ask one concise clarifying question early.
`.trim();

export const dataAgentRuntimeModule: ToolProviderRuntimeModule = {
  definition: dataAgentToolProvider,
  buildAgentSpec: () => ({
    tool_provider_id: "data-agent",
    agent_name: "Data Agent",
    instructions: DATA_AGENT_INSTRUCTIONS,
    client_tools: [],
    delegation_targets: [
      {
        tool_provider_id: "csv-agent",
        tool_name: "delegate_to_csv_agent",
        description: "Hand off to the CSV Agent for CSV inspection, safe grouped queries, and reusable CSV or JSON artifact creation.",
      },
      {
        tool_provider_id: "chart-agent",
        tool_name: "delegate_to_chart_agent",
        description: "Hand off to the Chart Agent for chart planning and rendering over explicit chartable artifacts.",
      },
      {
        tool_provider_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about the thread.",
      },
    ],
  }),
  bindClientTools: () => [],
};
