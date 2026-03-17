import { PdfAgentPage, pdfAgentCapability } from "../pdfAgent";
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
5. Use \`make_plan\` when it helps you structure the splitting task, then continue executing it.
`.trim();

export const pdfAgentModule: CapabilityModule = {
  definition: pdfAgentCapability,
  buildAgentSpec: () => ({
    capability_id: "pdf-agent",
    agent_name: "PDF Agent",
    instructions: PDF_AGENT_INSTRUCTIONS,
    client_tools: buildPdfAgentClientToolCatalog(),
    handoff_targets: [],
  }),
  buildDemoScenario: () => buildPdfAgentDemoScenario(),
  bindClientTools: (workspace) => createPdfAgentClientTools(workspace),
  Page: PdfAgentPage,
};
