import type { AgentModule } from "../types";
import { documentAgentDefinition } from "../definitions";
import { documentAgentRuntimeModule } from "./runtime";

function DocumentAgentPage() {
  return null;
}

const documentAgentModule: AgentModule = {
  ...documentAgentRuntimeModule,
  definition: documentAgentDefinition,
  Page: DocumentAgentPage,
};

export default documentAgentModule;
