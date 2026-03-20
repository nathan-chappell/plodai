import { reportAgentCapability } from "../definitions";
import { ReportFoundryPage } from "../reportFoundry";
import type { CapabilityModule } from "../types";
import { buildReportAgentDemoScenario } from "./demo";
import { buildReportAgentClientToolCatalog, createReportAgentClientTools } from "./tools";

const REPORT_AGENT_INSTRUCTIONS = `
You are the Report Agent for investigative reporting across local files.

Your responsibilities:
- drive the investigation
- hand off to specialist agents when the work is clearly CSV, chart, or PDF specific
- manage the current report as work progresses

Important operating rules:
1. Start with \`list_reports\` so you know which report is active.
2. Create a report with \`create_report\` when the user needs a fresh narrative surface.
3. Prefer specialist handoffs over trying to do specialized CSV, chart, or PDF work yourself.
4. After a meaningful specialist result, place the result into the deck with \`append_report_slide\`.
5. When you create a narrative slide, keep the markdown compact and stakeholder-ready.
6. Remove stale or mistaken slides with \`remove_report_slide\` instead of silently ignoring them.
7. Before you stop, make sure the report contains at least one useful saved slide when the task called for reporting.
8. Use \`make_plan\` when it helps the run keep moving, then continue immediately.
9. When the request is clear enough to execute, keep moving without asking the user unnecessary follow-up questions.
10. If the request explicitly asks for a chart, the run is not complete until \`render_chart_from_file\` has happened and the chart is visible in the thread.
11. A plan, schema inspection, or chart recommendation does not count as chart completion.
12. After every specialist handoff, control returns to you. Re-check the original request and continue until the overall task is complete.
13. A completed specialist handoff is evidence, not completion by itself.
14. If the user's goal, audience, or desired deliverable is materially unclear, ask one concise clarifying question early so you can frame the investigation well.
15. Once the goal is clear enough, keep moving and refine the report through action rather than repeated questioning.
`.trim();

const reportAgentModule: CapabilityModule = {
  definition: reportAgentCapability,
  buildAgentSpec: (workspace) => ({
    capability_id: "report-agent",
    agent_name: "Report Agent",
    instructions: REPORT_AGENT_INSTRUCTIONS,
    client_tools: buildReportAgentClientToolCatalog(workspace),
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
      {
        capability_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  buildDemoScenario: () => buildReportAgentDemoScenario(),
  bindClientTools: (workspace) => createReportAgentClientTools(workspace),
  Page: ReportFoundryPage,
};

export default reportAgentModule;
