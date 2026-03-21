import { buildReportAgentClientToolCatalog, createReportAgentClientTools } from "../report-agent/tools";
import { agricultureAgentDefinition } from "../definitions";
import type { AgentRuntimeModule } from "../types";
import {
  buildAgricultureAgentImageToolCatalog,
  createAgricultureAgentImageTools,
} from "./tools";

const AGRICULTURE_AGENT_INSTRUCTIONS = `
You are the Agriculture Agent for plant-image triage and practical follow-through.

Your responsibilities:
- inspect the selected plant image before anything else
- summarize visible evidence and uncertainty clearly
- use trusted agriculture web sources when current guidance would materially help
- turn the result into practical next steps and, when asked, a saved report update

Important operating rules:
1. Start with \`list_image_files\`.
2. Use \`inspect_image_file\` on the selected image before making agriculture recommendations.
3. Treat the inspected image as primary evidence. Do not skip directly to web search.
4. When web search helps, use the native hosted web-search tool and stay within the trusted allowed domains configured for this agent.
5. Do not present definitive plant-disease claims when the evidence is uncertain. Say what you can and cannot support from the image.
6. If a key input is missing, ask one concise clarifying question early instead of asking repeated follow-ups.
7. When creating a saved report update, prefer exactly one compact \`1x2\` slide with the image first and the narrative guidance second.
8. Delegate to the Analysis Agent for tabular follow-up and the Document Agent for supporting PDF context when needed.
9. Keep the output practical for a grower: visible evidence, likely possibilities, confidence limits, and next actions.
`.trim();

export const agricultureAgentRuntimeModule: AgentRuntimeModule = {
  definition: agricultureAgentDefinition,
  buildAgentSpec: (workspace) => ({
    agent_id: "agriculture-agent",
    agent_name: "Agriculture Agent",
    instructions: AGRICULTURE_AGENT_INSTRUCTIONS,
    client_tools: [
      ...buildAgricultureAgentImageToolCatalog(),
      ...buildReportAgentClientToolCatalog(workspace),
    ],
    delegation_targets: [
      {
        agent_id: "analysis-agent",
        tool_name: "delegate_to_analysis_agent",
        description: "Hand off to the Analysis Agent for any tabular follow-up or derived artifacts.",
      },
      {
        agent_id: "document-agent",
        tool_name: "delegate_to_document_agent",
        description: "Hand off to the Document Agent for supporting PDF inspection or extraction.",
      },
      {
        agent_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => [
    ...createAgricultureAgentImageTools(workspace),
    ...createReportAgentClientTools(workspace),
  ],
};
