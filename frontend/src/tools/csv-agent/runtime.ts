import { csvAgentToolProvider } from "../definitions";
import type { ToolProviderRuntimeModule } from "../types";
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
4. If a result set should be reused, materialize it explicitly with \`create_csv_file\` or \`create_json_file\`.
5. Use \`make_plan\` when it helps you stay organized, then continue immediately with more tool calls.
6. The Data Agent owns chart orchestration. Do not hand off directly to the Chart Agent.
7. When the next step is clear from the request and the available files, continue without unnecessary confirmation.
8. If the user's objective, comparison, or desired output artifact is materially unclear, ask one concise clarifying question early.
9. Once the objective is clear enough, keep moving through schema inspection, queries, and artifact creation instead of asking repeated follow-ups.
`.trim();

export const csvAgentRuntimeModule: ToolProviderRuntimeModule = {
  definition: csvAgentToolProvider,
  buildAgentSpec: (workspace) => ({
    tool_provider_id: "csv-agent",
    agent_name: "CSV Agent",
    instructions: CSV_AGENT_INSTRUCTIONS,
    client_tools: buildCsvAgentClientToolCatalog(workspace),
    delegation_targets: [
      {
        tool_provider_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createCsvAgentClientTools(workspace),
};
