import { buildReportAgentClientToolCatalog, createReportAgentClientTools } from "../report-agent/tools";
import { agricultureAgentDefinition } from "../definitions";
import type { AgentRuntimeModule } from "../types";
import {
  buildAgricultureAgentFarmToolCatalog,
  buildAgricultureAgentImageToolCatalog,
  createAgricultureAgentFarmTools,
  createAgricultureAgentImageTools,
} from "./tools";

const AGRICULTURE_AGENT_INSTRUCTIONS = `
You are Agriculture for plant-image triage and practical follow-through.

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
6. Produce the strongest useful first pass you can from image evidence alone before asking for more orchard history.
7. If extra orchard history would materially change the result, ask one concise clarifying question early instead of asking repeated follow-ups.
8. Start saved-report work with \`list_reports\`, reuse the current report by default, and call \`create_report\` only when no suitable report exists yet.
9. When creating a saved report update, prefer exactly one compact \`1x2\` slide with the image first and the narrative guidance second.
10. If the user later adds orchard history, revise the same report instead of starting over unless they clearly want a separate report.
11. Delegate to Analysis for tabular follow-up and to Documents for supporting PDF context when needed.
12. Keep the output practical for a grower: visible evidence, likely possibilities, confidence limits, and next actions.
13. Use get_farm_state before changing the saved farm record, and use save_farm_state when the user wants durable farm context like crops, issues, projects, or current work tracked over time.
14. Treat tagged thread images and tagged farm entities as durable workspace references, and connect them back to the saved farm record when the user is organizing ongoing orchard context.
`.trim();

export const agricultureAgentRuntimeModule: AgentRuntimeModule = {
  definition: agricultureAgentDefinition,
  buildAgentSpec: (workspace) => ({
    agent_id: "agriculture-agent",
    agent_name: "Agriculture",
    instructions: AGRICULTURE_AGENT_INSTRUCTIONS,
    client_tools: [
      ...buildAgricultureAgentImageToolCatalog(),
      ...buildAgricultureAgentFarmToolCatalog(),
      ...buildReportAgentClientToolCatalog(workspace),
    ],
    delegation_targets: [
      {
        agent_id: "analysis-agent",
        tool_name: "delegate_to_analysis_agent",
        description: "Hand off to Analysis for any tabular follow-up or derived artifacts.",
      },
      {
        agent_id: "document-agent",
        tool_name: "delegate_to_document_agent",
        description: "Hand off to Documents for supporting PDF inspection or extraction.",
      },
      {
        agent_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to Feedback when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => [
    ...createAgricultureAgentImageTools(workspace),
    ...createAgricultureAgentFarmTools(workspace),
    ...createReportAgentClientTools(workspace),
  ],
};
