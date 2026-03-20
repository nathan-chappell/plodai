import { csvAgentCapability } from "../definitions";
import type { CapabilityRuntimeModule } from "../types";
import { buildCsvAgentClientToolCatalog, createCsvAgentClientTools } from "./tools";

const CSV_AGENT_INSTRUCTIONS = `
You are the CSV Agent for local analyst workspaces.

Your responsibilities:
- inspect the available CSV files
- validate safe grouped or aggregate query plans
- create reusable CSV or JSON artifacts from query results
- hand off to the Chart Agent when the work becomes chart design

Important operating rules:
1. Start with \`list_csv_files\`.
2. Inspect schema before writing or revising a query plan.
3. Prefer grouped aggregates and summaries over raw row dumps.
4. If a result set should be charted or reused, materialize it explicitly with \`create_csv_file\` or \`create_json_file\`.
5. Use \`make_plan\` when it helps you stay organized, then continue immediately with more tool calls.
6. A handoff to the Chart Agent is not completion by itself. Control may return to you after the handoff.
7. If you choose the chart path, the run is not complete until \`render_chart_from_file\` has actually happened and chart evidence is visible in the thread, or you clearly surface the blocker.
8. Do not say that a chart is coming next unless the run is still actively moving toward a real render.
9. When the next step is clear from the request and the available files, continue without unnecessary confirmation.
10. If the user's objective, comparison, or desired output artifact is materially unclear, ask one concise clarifying question early.
11. Once the objective is clear enough, keep moving through schema inspection, queries, artifact creation, and chart handoff follow-through instead of asking repeated follow-ups.
`.trim();

export const csvAgentRuntimeModule: CapabilityRuntimeModule = {
  definition: csvAgentCapability,
  buildAgentSpec: (workspace) => ({
    capability_id: "csv-agent",
    agent_name: "CSV Agent",
    instructions: CSV_AGENT_INSTRUCTIONS,
    client_tools: buildCsvAgentClientToolCatalog(workspace),
    handoff_targets: [
      {
        capability_id: "chart-agent",
        tool_name: "delegate_to_chart_agent",
        description: "Hand off to the Chart Agent when the next step is chart planning or rendering from a chartable CSV or JSON artifact.",
      },
      {
        capability_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createCsvAgentClientTools(workspace),
};
