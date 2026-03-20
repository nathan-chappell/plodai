import { dataAgentToolProvider } from "../definitions";
import type { ToolProviderModule } from "../types";
import { buildDataAgentDemoScenario } from "./demo";
import { dataAgentRuntimeModule } from "./runtime";

const dataAgentModule: ToolProviderModule = {
  ...dataAgentRuntimeModule,
  definition: dataAgentToolProvider,
  buildDemoScenario: () => buildDataAgentDemoScenario(),
  Page: () => null,
};

export default dataAgentModule;
