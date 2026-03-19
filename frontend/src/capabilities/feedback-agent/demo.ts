import type { CapabilityDemoScenario } from "../types";

const seedWorkspace = [
  {
    id: "feedback-thread-note",
    name: "feedback_context.txt",
    kind: "other" as const,
    extension: "txt",
    text_content: "This hidden capability exists so active workspaces can hand off into the feedback agent.",
  },
];

export function buildFeedbackAgentDemoScenario(): CapabilityDemoScenario {
  return {
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
  };
}
