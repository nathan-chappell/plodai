import { defaultAgentDefinition } from "../definitions";
import { DefaultAgentPage } from "../defaultAgent";
import type { AgentModule } from "../types";
import { defaultAgentRuntimeModule } from "./runtime";

const defaultAgentModule: AgentModule = {
  ...defaultAgentRuntimeModule,
  definition: defaultAgentDefinition,
  Page: DefaultAgentPage,
};

export default defaultAgentModule;
