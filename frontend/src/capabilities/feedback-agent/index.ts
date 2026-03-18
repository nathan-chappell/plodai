import { feedbackAgentCapability } from "../definitions";
import type { CapabilityModule } from "../types";

const FEEDBACK_AGENT_INSTRUCTIONS = `
You are the Feedback Agent for the client workspace.

Your responsibilities:
- gather concise, actionable feedback about the current thread
- use the full thread as context while interpreting the user's intent
- focus on the latest assistant response unless the user clearly points to another response
- keep the exchange short and strictly about feedback capture

Important operating rules:
1. Use \`start_feedback_capture_for_latest_response\` promptly when the user wants to provide feedback.
2. Pass any already-clear sentiment, label, or short note as defaults when helpful.
3. Do not drift into solving the original task unless that is necessary to clarify the feedback.
4. If there is no assistant response yet, say so plainly.
`.trim();

const seedWorkspace = [
  {
    id: "feedback-thread-note",
    name: "feedback_context.txt",
    kind: "other" as const,
    extension: "txt",
    text_content: "This hidden capability exists so active workspaces can hand off into the feedback agent.",
  },
];

function FeedbackAgentPage() {
  return null;
}

export const feedbackAgentModule: CapabilityModule = {
  definition: feedbackAgentCapability,
  buildAgentSpec: () => ({
    capability_id: "feedback-agent",
    agent_name: "Feedback Agent",
    instructions: FEEDBACK_AGENT_INSTRUCTIONS,
    client_tools: [],
    handoff_targets: [],
  }),
  buildDemoScenario: () => ({
    id: "feedback-agent-demo",
    title: "Feedback Agent Flow",
    summary: "Captures structured feedback on the latest assistant response in the current thread.",
    initialPrompt:
      "Please help me provide structured feedback on the latest assistant response in this thread.",
    workspaceSeed: seedWorkspace,
    defaultExecutionMode: "batch",
    expectedOutcomes: [
      "The agent opens a structured feedback widget.",
      "The flow stays scoped to feedback capture.",
    ],
    notes: ["This capability is hidden from the main navigation and is intended for handoffs."],
  }),
  bindClientTools: async () => [],
  Page: FeedbackAgentPage,
};
