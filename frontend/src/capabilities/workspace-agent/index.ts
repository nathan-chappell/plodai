import { workspaceAgentCapability } from "../definitions";
import { WorkspaceAgentPage } from "../workspaceAgent";
import type { CapabilityModule } from "../types";
import { buildWorkspaceAgentDemoScenario } from "./demo";
import { workspaceAgentRuntimeModule } from "./runtime";

const workspaceAgentModule: CapabilityModule = {
  ...workspaceAgentRuntimeModule,
  definition: workspaceAgentCapability,
  buildDemoScenario: () => buildWorkspaceAgentDemoScenario(),
  Page: WorkspaceAgentPage,
};

export default workspaceAgentModule;
