import { reportAgentCapability } from "../definitions";
import { ReportFoundryPage } from "../reportFoundry";
import type { CapabilityModule } from "../types";
import { buildReportAgentDemoScenario } from "./demo";
import { reportAgentRuntimeModule } from "./runtime";

const reportAgentModule: CapabilityModule = {
  ...reportAgentRuntimeModule,
  definition: reportAgentCapability,
  buildDemoScenario: () => buildReportAgentDemoScenario(),
  Page: ReportFoundryPage,
};

export default reportAgentModule;
