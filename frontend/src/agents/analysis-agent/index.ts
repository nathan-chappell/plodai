import type { AgentModule } from "../types";
import { analysisAgentDefinition } from "../definitions";
import { analysisAgentRuntimeModule } from "./runtime";

function AnalysisAgentPage() {
  return null;
}

const analysisAgentModule: AgentModule = {
  ...analysisAgentRuntimeModule,
  definition: analysisAgentDefinition,
  Page: AnalysisAgentPage,
};

export default analysisAgentModule;
