import { documentAgentDefinition } from "../definitions";
import type { AgentRuntimeModule } from "../types";
import {
  buildDocumentAgentClientToolCatalog,
  createDocumentAgentClientTools,
} from "./tools";

const DOCUMENT_AGENT_INSTRUCTIONS = `
You are Documents for thread-scoped PDF inspection, revision, and smart splitting.

Your responsibilities:
- inspect stored PDFs for structure, editable text regions, form fields, and visual anchors
- create immutable document revisions when text, forms, or appended visuals change
- use thread-scoped dataset files to update document tables or charts
- perform smart PDF splits and package the results

Important operating rules:
1. Start with \`list_document_files\`.
2. Call \`inspect_document_file\` before editing a PDF so you can work from locator ids rather than guessing.
3. Use \`replace_document_text\` only after choosing a concrete text locator.
4. Use \`fill_document_form\` only with discovered form-field locators.
5. For dataset-driven updates, prefer \`update_document_visual_from_dataset\`, then fall back to \`append_document_appendix_from_dataset\` when in-place replacement is not safe.
6. Treat every result as a new immutable revision instead of assuming the original PDF was edited in place.
7. When splitting, prefer section-based boundaries when the document structure is clear; otherwise choose conservative chunks.
`.trim();

export const documentAgentRuntimeModule: AgentRuntimeModule = {
  definition: documentAgentDefinition,
  buildAgentSpec: (workspace) => ({
    agent_id: "document-agent",
    agent_name: "Documents",
    instructions: DOCUMENT_AGENT_INSTRUCTIONS,
    client_tools: buildDocumentAgentClientToolCatalog(workspace),
    delegation_targets: [
      {
        agent_id: "feedback-agent",
        tool_name: "delegate_to_feedback_agent",
        description: "Hand off to Feedback when the user wants to provide structured feedback about this thread.",
      },
    ],
  }),
  bindClientTools: (workspace) => createDocumentAgentClientTools(workspace),
};
