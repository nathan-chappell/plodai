import { defaultAgentDefinition } from "../definitions";
import type { AgentRuntimeModule } from "../types";
import {
  buildDefaultAgentClientToolCatalog,
  createDefaultAgentClientTools,
} from "./tools";

const DEFAULT_AGENT_INSTRUCTIONS = `
You are the default workspace router for the shared workspace.

Your responsibilities:
- explain what this app can do in clear, concrete terms
- recommend the right workflow for the user's goal
- open the right guided tour when the user wants a useful example
- keep the user oriented while specialist work happens in the same shared workspace
- act like the front-of-house router: prepare context, route to the right specialist, and keep momentum

Important operating rules:
1. When the user asks which tour to start with, says they are new, or wants help choosing, call \`list_tour_scenarios\` immediately so the guided tour picker opens in chat. Do not ask permission and do not answer in prose first.
2. When the user clearly names a specific tour or wants to start one right away, call \`launch_tour_scenario\` immediately.
3. After \`list_tour_scenarios\` or \`launch_tour_scenario\`, do not add another assistant reply in the same turn.
4. Do not ask the user to restage the same setup or manually prepare the workspace after the chooser opens.
5. Delegate to Report for reporting work, Analysis for tabular work, Documents for PDF work, and Agriculture for plant-image work.
6. A specialist handoff is not completion by itself. Keep the user's requested outcome in mind.
7. When the best next step is clear, continue without unnecessary confirmation.
`.trim();

export const defaultAgentRuntimeModule: AgentRuntimeModule = {
  definition: defaultAgentDefinition,
  buildAgentSpec: () => ({
    agent_id: "default-agent",
    agent_name: "Default",
    instructions: DEFAULT_AGENT_INSTRUCTIONS,
    client_tools: buildDefaultAgentClientToolCatalog(),
    delegation_targets: [
      {
        agent_id: "report-agent",
        tool_name: "delegate_to_report_agent",
        description: "Hand off to Report for report assembly and saved slides.",
      },
      {
        agent_id: "analysis-agent",
        tool_name: "delegate_to_analysis_agent",
        description: "Hand off to Analysis for tabular inspection and derived data artifacts.",
      },
      {
        agent_id: "document-agent",
        tool_name: "delegate_to_document_agent",
        description: "Hand off to Documents for PDF inspection, extraction, and smart splits.",
      },
      {
        agent_id: "agriculture-agent",
        tool_name: "delegate_to_agriculture_agent",
        description: "Hand off to Agriculture for plant-image inspection and agriculture-specific reasoning.",
      },
      {
        agent_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to Feedback when the user wants to provide structured feedback about the thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createDefaultAgentClientTools(workspace),
};
