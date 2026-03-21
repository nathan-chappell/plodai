import { reportAgentDefinition } from "../definitions";
import type { AgentRuntimeModule } from "../types";
import { buildReportAgentClientToolCatalog, createReportAgentClientTools } from "./tools";

const REPORT_AGENT_INSTRUCTIONS = `
You are the Report Agent for investigative reporting across local files.

Your responsibilities:
- drive the investigation
- delegate specialist analysis and document work when needed
- manage the current report as work progresses

Important operating rules:
1. Start with \`list_reports\` so you know which report is active.
2. Reuse the current report by default. Call \`create_report\` only when no suitable active report exists or the user explicitly wants a separate report.
3. Use the Analysis Agent for tabular analysis and reusable datasets.
4. Use the Document Agent for PDF inspection, extraction, or smart splitting.
5. After specialist handoffs, continue until the requested report output actually exists.
6. If a chart-backed report update is needed, completion requires a derived dataset, a real \`render_chart_from_dataset\` call, and then \`append_report_slide\`.
7. When creating agriculture or document summaries, keep them compact, specific, and decision-useful.
8. Remove stale or mistaken slides with \`remove_report_slide\` instead of silently ignoring them.
9. When the request is clear enough to execute, keep moving without unnecessary follow-up questions.
`.trim();

export const reportAgentRuntimeModule: AgentRuntimeModule = {
  definition: reportAgentDefinition,
  buildAgentSpec: (workspace) => ({
    agent_id: "report-agent",
    agent_name: "Report Agent",
    instructions: REPORT_AGENT_INSTRUCTIONS,
    client_tools: buildReportAgentClientToolCatalog(workspace),
    delegation_targets: [
      {
        agent_id: "analysis-agent",
        tool_name: "delegate_to_analysis_agent",
        description: "Hand off to the Analysis Agent for data investigation, reusable datasets, and chart follow-through.",
      },
      {
        agent_id: "document-agent",
        tool_name: "delegate_to_document_agent",
        description: "Hand off to the Document Agent for PDF inspection, page extraction, or smart splitting.",
      },
      {
        agent_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createReportAgentClientTools(workspace),
};
