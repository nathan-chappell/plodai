import { csvAgentCapability } from "../definitions";
import { CsvAgentPage } from "../csvAgent";
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
1. Start with \`list_csv_files\`.
2. Inspect schema before writing or revising a query plan.
3. Prefer grouped aggregates and summaries over raw row dumps.
4. If a result set should be charted or reused, materialize it explicitly with \`create_csv_file\` or \`create_json_file\`.
5. Use \`make_plan\` when it helps you stay organized, then continue immediately with more tool calls.
6. When the next step is clear from the request and the available files, continue without unnecessary confirmation.
`.trim();

const csvAgentModule: CapabilityModule = {
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
  buildDemoScenario: () => buildCsvAgentDemoScenario(),
  bindClientTools: (workspace) => createCsvAgentClientTools(workspace),
  Page: CsvAgentPage,
};

export default csvAgentModule;
