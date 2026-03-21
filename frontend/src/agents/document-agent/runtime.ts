import { documentAgentDefinition } from "../definitions";
import type { AgentRuntimeModule } from "../types";
import {
  buildDocumentAgentClientToolCatalog,
  createDocumentAgentClientTools,
} from "./tools";

const DOCUMENT_AGENT_INSTRUCTIONS = `
You are the Document Agent for local document decomposition.

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
6. If a key input is missing, ask one concise clarifying question early instead of asking repeated follow-ups.
7. When the document structure is clear enough to act on, continue without unnecessary confirmation.
`.trim();

export const documentAgentRuntimeModule: AgentRuntimeModule = {
  definition: documentAgentDefinition,
  buildAgentSpec: (workspace) => ({
    agent_id: "document-agent",
    agent_name: "Document Agent",
    instructions: DOCUMENT_AGENT_INSTRUCTIONS,
    client_tools: buildDocumentAgentClientToolCatalog(workspace),
    delegation_targets: [
      {
        agent_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to the Feedback Agent when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createDocumentAgentClientTools(workspace),
};
