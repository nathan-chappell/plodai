import { reportAgentDefinition } from "../definitions";
import type { AgentModule } from "../types";
import { reportAgentRuntimeModule } from "./runtime";

function ReportAgentPage() {
  return null;
}

const reportAgentModule: AgentModule = {
  ...reportAgentRuntimeModule,
  definition: reportAgentDefinition,
  Page: ReportAgentPage,
};

export default reportAgentModule;
