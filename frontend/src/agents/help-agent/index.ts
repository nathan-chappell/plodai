import { helpAgentDefinition } from "../definitions";
import { HelpAgentPage } from "../helpAgent";
import type { AgentModule } from "../types";
import { helpAgentRuntimeModule } from "./runtime";

const helpAgentModule: AgentModule = {
  ...helpAgentRuntimeModule,
  definition: helpAgentDefinition,
  Page: HelpAgentPage,
};

export default helpAgentModule;
