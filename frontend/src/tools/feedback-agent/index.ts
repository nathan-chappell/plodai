import { feedbackAgentCapability } from "../definitions";
import type { CapabilityModule } from "../types";
import { buildFeedbackAgentDemoScenario } from "./demo";
import { feedbackAgentRuntimeModule } from "./runtime";

function FeedbackAgentPage() {
  return null;
}

const feedbackAgentModule: CapabilityModule = {
  ...feedbackAgentRuntimeModule,
  definition: feedbackAgentCapability,
  buildDemoScenario: () => buildFeedbackAgentDemoScenario(),
  Page: FeedbackAgentPage,
};

export default feedbackAgentModule;
