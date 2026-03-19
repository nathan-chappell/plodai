import { feedbackAgentCapability } from "../definitions";
import type { CapabilityModule } from "../types";
import { buildFeedbackAgentDemoScenario } from "./demo";
import { buildFeedbackAgentClientToolCatalog, createFeedbackAgentClientTools } from "./tools";

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

function FeedbackAgentPage() {
  return null;
}

const feedbackAgentModule: CapabilityModule = {
  definition: feedbackAgentCapability,
  buildAgentSpec: () => ({
    capability_id: "feedback-agent",
    agent_name: "Feedback Agent",
    instructions: FEEDBACK_AGENT_INSTRUCTIONS,
    client_tools: buildFeedbackAgentClientToolCatalog(),
    handoff_targets: [],
  }),
  buildDemoScenario: () => buildFeedbackAgentDemoScenario(),
  bindClientTools: (workspace) => createFeedbackAgentClientTools(workspace),
  Page: FeedbackAgentPage,
};

export default feedbackAgentModule;
