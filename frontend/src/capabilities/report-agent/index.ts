import { ReportFoundryPage, reportFoundryCapability } from "../reportFoundry";
import type { CapabilityModule } from "../types";
import { buildReportAgentDemoScenario } from "./demo";
import { REPORT_AGENT_INSTRUCTIONS } from "./instructions";
import { buildReportAgentClientToolCatalog, createReportAgentClientTools } from "./tools";

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
