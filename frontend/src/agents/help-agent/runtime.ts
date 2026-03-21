import { helpAgentDefinition } from "../definitions";
import type { AgentRuntimeModule } from "../types";
import {
  buildHelpAgentClientToolCatalog,
  createHelpAgentClientTools,
} from "./tools";

const HELP_AGENT_INSTRUCTIONS = `
You are the Help Agent for the shared workspace.

Your responsibilities:
- explain what this app can do in clear, concrete terms
- recommend the right agent flow for the user's goal
- launch the right seeded demo when the user wants a guided example
- keep the user oriented while specialist work happens in the same shared workspace

Important operating rules:
1. When the user asks for a demo, start with \`list_demo_scenarios\` unless the desired demo is already clear.
2. Use \`launch_demo_scenario\` to create a fresh seeded workspace and queue the first demo turn automatically.
3. After a demo is launched, explain briefly what the user should expect next instead of restaging the same setup manually.
4. Delegate to the Report Agent for reporting work, the Analysis Agent for tabular work, the Document Agent for PDF work, and the Agriculture Agent for plant-image work.
5. A specialist handoff is not completion by itself. Keep the user's requested outcome in mind.
6. When the best next step is clear, continue without unnecessary confirmation.
`.trim();

export const helpAgentRuntimeModule: AgentRuntimeModule = {
  definition: helpAgentDefinition,
  buildAgentSpec: () => ({
    agent_id: "help-agent",
    agent_name: "Help Agent",
    instructions: HELP_AGENT_INSTRUCTIONS,
    client_tools: buildHelpAgentClientToolCatalog(),
    delegation_targets: [
      {
        agent_id: "report-agent",
        tool_name: "delegate_to_report_agent",
        description: "Hand off to the Report Agent for report assembly and saved slides.",
      },
      {
        agent_id: "analysis-agent",
        tool_name: "delegate_to_analysis_agent",
        description: "Hand off to the Analysis Agent for tabular inspection and derived data artifacts.",
      },
      {
        agent_id: "document-agent",
        tool_name: "delegate_to_document_agent",
        description: "Hand off to the Document Agent for PDF inspection, extraction, and smart splits.",
      },
      {
        agent_id: "agriculture-agent",
        tool_name: "delegate_to_agriculture_agent",
        description: "Hand off to the Agriculture Agent for plant-image inspection and agriculture-specific reasoning.",
      },
      {
        agent_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about the thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createHelpAgentClientTools(workspace),
};
