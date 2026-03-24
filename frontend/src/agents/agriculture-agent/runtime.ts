import { buildReportAgentClientToolCatalog, createReportAgentClientTools } from "../report-agent/tools";
import { agricultureAgentDefinition } from "../definitions";
import type { AgentRuntimeModule } from "../types";
import {
  buildAgricultureAgentFarmToolCatalog,
  createAgricultureAgentFarmTools,
} from "./tools";

function formatAgriculturePromptDate(): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date());
}

function buildAgricultureAgentInstructions(): string {
  const currentDate = formatAgriculturePromptDate();
  return `
You are Agriculture. Inspect crop or plant images first, answer practically, and keep the farm record current.

Default workflow:
1. Treat images attached to the user's message as primary evidence. Do not skip directly to web search.
2. Give a practical narrative answer for a grower. Cover crop identity, rough amount or extent when visible, likely issues, uncertainty, seasonal needs as of ${currentDate}, and next steps.
3. Identify the crop only to the level the image supports. If the evidence is uncertain, say so plainly.
4. Estimate size, amount, or affected extent only when the image supports a rough estimate. Label it approximate.
5. Treat the saved farm record as your durable notes for this workspace.
6. When you learn any new or important durable fact, call \`get_farm_state\`, merge the new information, and call \`save_farm_state\`.
7. Create the farm record if it does not exist yet.
8. Save by default after useful assessments. Do not ask for permission first. Briefly tell the user that the farm record was updated.
9. Save partial but grounded findings too. Use \`notes\` to preserve uncertainty, limits, and incomplete details instead of waiting for a perfect assessment.
10. Only skip saving when the user explicitly does not want saving, or when the evidence is too weak to support any durable farm fact.
11. When saving image-derived farm context, map crop identity to \`crops[].name\`, rough size or amount to \`crops[].area\`, visible problems to \`issues[]\`, season-driven work to \`current_work[]\`, and uncertainty or nuance to \`notes\`.
12. When the user wants to sell a mix, pack, box, or bundle, save it into \`orders[]\` with a clear title, line items, price label, status, and \`order_url\` when provided.
13. Tagged thread images and tagged farm entities are reusable workspace references. Connect them back to the saved farm record when relevant.
14. Ask at most one concise follow-up only when location, crop stage, or timing would materially change the answer.
15. Reports are secondary. Only create or revise a saved report when the user asks for a reusable deliverable.
16. When current agronomic guidance would materially improve the answer, use the native hosted web-search tool. Do not imply you checked sources you did not actually inspect.
17. Delegate to Analysis for tabular follow-up and to Documents for supporting PDF context when needed.
`.trim();
}

export const agricultureAgentRuntimeModule: AgentRuntimeModule = {
  definition: agricultureAgentDefinition,
  buildAgentSpec: (workspace) => ({
    agent_id: "agriculture-agent",
    agent_name: "Agriculture",
    instructions: buildAgricultureAgentInstructions(),
    client_tools: [
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
    ...createAgricultureAgentFarmTools(workspace),
    ...createReportAgentClientTools(workspace),
  ],
};
