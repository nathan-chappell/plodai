import { chartAgentCapability } from "../definitions";
import { ChartAgentPage } from "../chartAgent";
import type { CapabilityModule } from "../types";
import { buildChartAgentDemoScenario } from "./demo";
import { chartAgentRuntimeModule } from "./runtime";

const chartAgentModule: CapabilityModule = {
  ...chartAgentRuntimeModule,
  definition: chartAgentCapability,
  buildDemoScenario: () => buildChartAgentDemoScenario(),
  Page: ChartAgentPage,
};

export default chartAgentModule;
