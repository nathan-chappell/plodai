import { chartAgentDefinition } from "../definitions";
import type { AgentModule } from "../types";
import { chartAgentRuntimeModule } from "./runtime";

function ChartAgentPage() {
  return null;
}

const chartAgentModule: AgentModule = {
  ...chartAgentRuntimeModule,
  definition: chartAgentDefinition,
  Page: ChartAgentPage,
};

export default chartAgentModule;
