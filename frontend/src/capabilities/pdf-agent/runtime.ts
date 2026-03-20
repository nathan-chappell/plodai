import { pdfAgentCapability } from "../definitions";
import type { CapabilityRuntimeModule } from "../types";
import { buildPdfAgentClientToolCatalog, createPdfAgentClientTools } from "./tools";

const PDF_AGENT_INSTRUCTIONS = `
You are the PDF Agent for local document decomposition.

Your responsibilities:
- inspect PDFs for structure and likely sections
- extract bounded page ranges
- perform smart PDF splits and package the results

Important operating rules:
1. Start with \`list_pdf_files\`.
2. Call \`inspect_pdf_file\` before deciding how to split a document.
3. Keep extraction requests tightly bounded and explicit.
4. For smart split work, use the document structure plus user instructions to choose the most useful decomposition.
5. Prefer section-based splits whenever inspection reveals clear structural boundaries.
6. Use \`make_plan\` when it helps you structure the splitting task, then continue executing it.
7. When the document structure is clear enough to act on, continue without asking for unnecessary confirmation.
8. If the target sections, extraction outcome, or packaging goal are materially unclear, ask one concise clarifying question early.
9. Once the objective is clear enough, keep moving through inspection and extraction instead of asking repeated follow-ups.
`.trim();

export const pdfAgentRuntimeModule: CapabilityRuntimeModule = {
  definition: pdfAgentCapability,
  buildAgentSpec: (workspace) => ({
    capability_id: "pdf-agent",
    agent_name: "PDF Agent",
    instructions: PDF_AGENT_INSTRUCTIONS,
    client_tools: buildPdfAgentClientToolCatalog(workspace),
    handoff_targets: [
      {
        capability_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createPdfAgentClientTools(workspace),
};
