import { csvAgentCapability } from "../definitions";
import { CsvAgentPage } from "../csvAgent";
import type { CapabilityModule } from "../types";
import { buildCsvAgentDemoScenario } from "./demo";
import { csvAgentRuntimeModule } from "./runtime";

const csvAgentModule: CapabilityModule = {
  ...csvAgentRuntimeModule,
  definition: csvAgentCapability,
  buildDemoScenario: () => buildCsvAgentDemoScenario(),
  Page: CsvAgentPage,
};

export default csvAgentModule;
