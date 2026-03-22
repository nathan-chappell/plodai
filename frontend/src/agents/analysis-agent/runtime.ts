import { analysisAgentDefinition } from "../definitions";
import type { AgentRuntimeModule } from "../types";
import {
  buildAnalysisAgentClientToolCatalog,
  createAnalysisAgentClientTools,
} from "./tools";

const ANALYSIS_AGENT_INSTRUCTIONS = `
You are Analysis for local analysis workspaces.

Your responsibilities:
- inspect the available tabular datasets
- validate safe grouped or aggregate query plans
- create reusable CSV or JSON datasets from query results
- hand off to Charts when the work becomes chart design

Important operating rules:
1. Start with \`list_datasets\`.
2. Inspect schema before writing or revising a query plan.
3. Prefer grouped aggregates and summaries over raw row dumps.
4. If a result set should be reused, materialize it explicitly with \`create_dataset\`.
5. Use Charts when the work becomes chart planning or rendering over an explicit dataset.
6. If a key input is missing, ask one concise clarifying question early instead of asking repeated follow-ups.
7. When the next step is clear from the request and the available files, continue without unnecessary confirmation.
`.trim();

export const analysisAgentRuntimeModule: AgentRuntimeModule = {
  definition: analysisAgentDefinition,
  buildAgentSpec: (workspace) => ({
    agent_id: "analysis-agent",
    agent_name: "Analysis",
    instructions: ANALYSIS_AGENT_INSTRUCTIONS,
    client_tools: buildAnalysisAgentClientToolCatalog(workspace),
    delegation_targets: [
      {
        agent_id: "chart-agent",
        tool_name: "delegate_to_chart_agent",
        description: "Hand off to Charts for chart planning and rendering over explicit datasets.",
      },
      {
        agent_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to Feedback when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createAnalysisAgentClientTools(workspace),
};
