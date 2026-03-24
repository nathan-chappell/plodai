import type { AgentModule } from "../types";
import { plodaiAgentDefinition } from "../definitions";
import { plodaiAgentRuntimeModule } from "./runtime";

function PlodaiAgentPage() {
  return null;
}

const plodaiAgentModule: AgentModule = {
  ...plodaiAgentRuntimeModule,
  definition: plodaiAgentDefinition,
  Page: PlodaiAgentPage,
};

export default plodaiAgentModule;
