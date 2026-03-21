import type { AgentModule } from "../types";
import { agricultureAgentDefinition } from "../definitions";
import { agricultureAgentRuntimeModule } from "./runtime";

function AgricultureAgentPage() {
  return null;
}

const agricultureAgentModule: AgentModule = {
  ...agricultureAgentRuntimeModule,
  definition: agricultureAgentDefinition,
  Page: AgricultureAgentPage,
};

export default agricultureAgentModule;
