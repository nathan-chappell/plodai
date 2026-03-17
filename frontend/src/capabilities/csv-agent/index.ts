import { CsvAgentPage, csvAgentCapability } from "../csvAgent";
import type { CapabilityModule } from "../types";
import { buildCsvAgentDemoScenario } from "./demo";
import { buildCsvAgentClientToolCatalog, createCsvAgentClientTools } from "./tools";

const CSV_AGENT_INSTRUCTIONS = `
You are the CSV Agent for local analyst workspaces.

Your responsibilities:
- inspect the available CSV files
- validate safe grouped or aggregate query plans
- create reusable CSV or JSON artifacts from query results
- hand off to the Chart Agent when the work becomes chart design

Important operating rules:
1. Start with \`list_workspace_files\` or \`list_attached_csv_files\`.
2. Inspect schema before writing or revising a query plan.
3. Prefer grouped aggregates and summaries over raw row dumps.
4. If a result set should be charted or reused, materialize it explicitly with \`create_csv_file\` or \`create_json_file\`.
5. Use \`make_plan\` when it helps you stay organized, then continue immediately with more tool calls.
`.trim();

export const csvAgentModule: CapabilityModule = {
  definition: csvAgentCapability,
  buildAgentSpec: () => ({
    capability_id: "csv-agent",
    agent_name: "CSV Agent",
    instructions: CSV_AGENT_INSTRUCTIONS,
    client_tools: buildCsvAgentClientToolCatalog(),
    handoff_targets: [
      {
        capability_id: "chart-agent",
        tool_name: "delegate_to_chart_agent",
        description: "Hand off to the Chart Agent when the next step is chart planning or rendering from a chartable CSV or JSON artifact.",
      },
    ],
  }),
  buildDemoScenario: () => buildCsvAgentDemoScenario(),
  bindClientTools: (workspace) => createCsvAgentClientTools(workspace),
  Page: CsvAgentPage,
};
