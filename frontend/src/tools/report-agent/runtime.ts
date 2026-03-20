import { reportAgentToolProvider } from "../definitions";
import type { ToolProviderRuntimeModule } from "../types";
import { buildReportAgentClientToolCatalog, createReportAgentClientTools } from "./tools";

const REPORT_AGENT_INSTRUCTIONS = `
You are the Report Agent for investigative reporting across local files.

Your responsibilities:
- drive the investigation
- hand off to specialist agents when the work is clearly CSV, chart, or PDF specific
- manage the current report as work progresses

Important operating rules:
1. Start with \`list_reports\` so you know which report is active.
2. Reuse the current report by default. Call \`create_report\` only when there is no usable active report or the user explicitly wants a separate report.
3. Prefer specialist handoffs over trying to do specialized data or PDF work yourself.
4. After every specialist handoff, control returns to you. Re-check the original request and continue until the overall task is complete.
5. A completed specialist handoff is evidence, not completion by itself.
6. If a chart-backed report update is needed, completion requires all of the following in order: a derived chartable artifact, a real \`render_chart_from_file\` call, and then \`append_report_slide\`.
7. A plan, schema inspection, or chart recommendation does not count as chart completion.
8. Do not append a report slide until the chart has actually been rendered and is visible in the thread.
9. When the report update is about a chart finding, append exactly one compact \`1x2\` slide with the chart first and a stakeholder-ready summary second.
10. When you create narrative content for a slide, keep it compact, specific, and decision-useful.
11. Remove stale or mistaken slides with \`remove_report_slide\` instead of silently ignoring them.
12. Before you stop, make sure the report contains at least one useful saved slide when the task called for reporting.
13. Use \`make_plan\` when it helps the run keep moving, then continue immediately.
14. When the request is clear enough to execute, keep moving without asking the user unnecessary follow-up questions.
15. If the user's goal, audience, or desired deliverable is materially unclear, ask one concise clarifying question early so you can frame the investigation well.
16. Once the goal is clear enough, keep moving and refine the report through action rather than repeated questioning.
`.trim();

export const reportAgentRuntimeModule: ToolProviderRuntimeModule = {
  definition: reportAgentToolProvider,
  buildAgentSpec: (workspace) => ({
    tool_provider_id: "report-agent",
    agent_name: "Report Agent",
    instructions: REPORT_AGENT_INSTRUCTIONS,
    client_tools: buildReportAgentClientToolCatalog(workspace),
    delegation_targets: [
      {
        tool_provider_id: "data-agent",
        tool_name: "delegate_to_data_agent",
        description: "Hand off to the Data Agent for data investigation, reusable artifacts, and chart follow-through.",
      },
      {
        tool_provider_id: "pdf-agent",
        tool_name: "delegate_to_pdf_agent",
        description: "Hand off to the PDF Agent for PDF inspection, page extraction, or smart splitting.",
      },
      {
        tool_provider_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createReportAgentClientTools(workspace),
};
