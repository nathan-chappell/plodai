import { feedbackAgentDefinition } from "../definitions";
import type { AgentModule } from "../types";
import { feedbackAgentRuntimeModule } from "./runtime";

function FeedbackAgentPage() {
  return null;
}

const feedbackAgentModule: AgentModule = {
  ...feedbackAgentRuntimeModule,
  definition: feedbackAgentDefinition,
  Page: FeedbackAgentPage,
};

export default feedbackAgentModule;
