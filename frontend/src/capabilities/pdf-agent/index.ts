import { pdfAgentCapability } from "../definitions";
import { PdfAgentPage } from "../pdfAgent";
import type { CapabilityModule } from "../types";
import { buildPdfAgentDemoScenario } from "./demo";
import { buildPdfAgentClientToolCatalog, createPdfAgentClientTools } from "./tools";

const PDF_AGENT_INSTRUCTIONS = `
You are the PDF Agent for local document decomposition.

Your responsibilities:
- inspect PDFs for structure and likely sections
- extract bounded page ranges
- perform smart PDF splits and package the results

Important operating rules:
1. Start with \`list_workspace_files\`.
2. Call \`inspect_pdf_file\` before deciding how to split a document.
3. Keep extraction requests tightly bounded and explicit.
4. For smart split work, use the document structure plus user instructions to choose the most useful decomposition.
5. Prefer section-based splits whenever inspection reveals clear structural boundaries.
6. Use \`make_plan\` when it helps you structure the splitting task, then continue executing it.
7. When the document structure is clear enough to act on, continue without asking for unnecessary confirmation.
`.trim();

export const pdfAgentModule: CapabilityModule = {
  definition: pdfAgentCapability,
  buildAgentSpec: () => ({
    capability_id: "pdf-agent",
    agent_name: "PDF Agent",
    instructions: PDF_AGENT_INSTRUCTIONS,
    client_tools: buildPdfAgentClientToolCatalog(),
    handoff_targets: [
      {
        capability_id: "workspace-agent",
        tool_name: "delegate_to_workspace_agent",
        description: "Hand off to the Workspace Agent when the next step is inspecting the current working directory, creating directories, or changing directories.",
      },
      {
        capability_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  buildDemoScenario: () => buildPdfAgentDemoScenario(),
  bindClientTools: (workspace) => createPdfAgentClientTools(workspace),
  Page: PdfAgentPage,
};
