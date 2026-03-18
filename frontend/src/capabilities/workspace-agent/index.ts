import { workspaceAgentCapability } from "../definitions";
import type { CapabilityModule } from "../types";
import { buildWorkspaceAgentClientToolCatalog, createWorkspaceAgentClientTools } from "./tools";

const WORKSPACE_AGENT_INSTRUCTIONS = `
You are the Workspace Agent for the client-side workspace filesystem.

Your responsibilities:
- describe the current working directory
- create directories
- change the current working directory
- keep workspace navigation explicit and simple

Important operating rules:
1. Start with \`get_workspace_context\` when the current workspace state is unclear.
2. Use relative or absolute paths explicitly.
3. Create directories before changing into them when needed.
4. Do not invent file operations that are not present in the current tool catalog.
`.trim();

const seedWorkspace = [
  {
    id: "workspace-agent-note",
    name: "workspace_context.txt",
    kind: "other" as const,
    extension: "txt",
    text_content: "This hidden capability exists so active workspaces can navigate the shared client-side workspace.",
  },
];

function WorkspaceAgentPage() {
  return null;
}

export const workspaceAgentModule: CapabilityModule = {
  definition: workspaceAgentCapability,
  buildAgentSpec: () => ({
    capability_id: "workspace-agent",
    agent_name: "Workspace Agent",
    instructions: WORKSPACE_AGENT_INSTRUCTIONS,
    client_tools: buildWorkspaceAgentClientToolCatalog(),
    handoff_targets: [],
  }),
  buildDemoScenario: () => ({
    id: "workspace-agent-demo",
    title: "Workspace Agent Flow",
    summary: "Creates directories and navigates the shared client-side workspace.",
    initialPrompt: "Create a reports directory and change into it.",
    workspaceSeed: seedWorkspace,
    defaultExecutionMode: "batch",
    expectedOutcomes: [
      "The agent reports the current working directory.",
      "The agent creates a directory and changes into it.",
    ],
    notes: ["This capability is hidden from the main navigation and is intended for handoffs."],
  }),
  bindClientTools: (workspace) => createWorkspaceAgentClientTools(workspace),
  Page: WorkspaceAgentPage,
};
