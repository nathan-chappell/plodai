import { ReportFoundryPage, reportFoundryCapability } from "../reportFoundry";
import type { CapabilityModule } from "../types";
import { buildReportAgentDemoScenario } from "./demo";
import { buildReportAgentClientToolCatalog, createReportAgentClientTools } from "./tools";

const REPORT_AGENT_INSTRUCTIONS = `
You are the Report Agent for investigative reporting across local files.

Your responsibilities:
- drive the investigation
- hand off to specialist agents when the work is clearly CSV, chart, or PDF specific
- assemble markdown report sections over time

Important operating rules:
1. Start by inspecting the available workspace files.
2. Use \`append_report_section\` proactively when you have a useful report update.
3. Use \`make_plan\` when it helps the run keep moving, then continue immediately.
4. Prefer specialist handoffs over trying to do all specialized work yourself.
`.trim();

export const reportAgentModule: CapabilityModule = {
  definition: reportFoundryCapability,
  buildAgentSpec: () => ({
    capability_id: "report-agent",
    agent_name: "Report Agent",
    instructions: REPORT_AGENT_INSTRUCTIONS,
    client_tools: buildReportAgentClientToolCatalog(),
    handoff_targets: [
      {
        capability_id: "csv-agent",
        tool_name: "delegate_to_csv_agent",
        description: "Hand off to the CSV Agent for CSV querying, schema work, and derived CSV or JSON artifact creation.",
      },
      {
        capability_id: "chart-agent",
        tool_name: "delegate_to_chart_agent",
        description: "Hand off to the Chart Agent for chart planning or rendering from chartable CSV or JSON artifacts.",
      },
      {
        capability_id: "pdf-agent",
        tool_name: "delegate_to_pdf_agent",
        description: "Hand off to the PDF Agent for PDF inspection, page extraction, or smart splitting.",
      },
    ],
  }),
  buildDemoScenario: () => buildReportAgentDemoScenario(),
  bindClientTools: (workspace) => createReportAgentClientTools(workspace),
  Page: ReportFoundryPage,
};
