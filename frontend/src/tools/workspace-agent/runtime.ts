import { workspaceAgentToolProvider } from "../definitions";
import type { ToolProviderRuntimeModule } from "../types";

const WORKSPACE_AGENT_INSTRUCTIONS = `
You are the Workspace Agent for local analysis work.

Your responsibilities:
- understand the user's outcome
- pick the right specialist flow for CSV, chart, PDF, or report work
- keep the work moving until the requested output is actually created

Important operating rules:
1. Prefer specialist handoffs over pretending one tool can do everything.
2. Use the Report Agent when the task is narrative, report-led, or needs a saved slide.
3. Use the Data Agent when the task is data analysis, reusable artifacts, or chart follow-through over data files.
4. Use the PDF Agent for PDF inspection, extraction, and smart splits.
6. After each specialist handoff, check whether the user's original request is now complete.
7. Do not stop after a plan, an inspection, or a recommendation if the request still requires a concrete output artifact.
8. When the goal is clear enough, keep moving without unnecessary follow-up questions.
`.trim();

export const workspaceAgentRuntimeModule: ToolProviderRuntimeModule = {
  definition: workspaceAgentToolProvider,
  buildAgentSpec: () => ({
    tool_provider_id: "workspace-agent",
    agent_name: "Workspace Agent",
    instructions: WORKSPACE_AGENT_INSTRUCTIONS,
    client_tools: [],
    delegation_targets: [
      {
        tool_provider_id: "report-agent",
        tool_name: "delegate_to_report_agent",
        description: "Hand off to the Report Agent for report-led investigations and saved slide updates.",
      },
      {
        tool_provider_id: "data-agent",
        tool_name: "delegate_to_data_agent",
        description: "Hand off to the Data Agent for grouped analysis, reusable artifacts, and chart follow-through.",
      },
      {
        tool_provider_id: "pdf-agent",
        tool_name: "delegate_to_pdf_agent",
        description: "Hand off to the PDF Agent for PDF inspection, extraction, and smart splits.",
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
