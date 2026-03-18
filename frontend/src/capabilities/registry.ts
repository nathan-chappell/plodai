import { chartAgentModule } from "./chart-agent";
import { csvAgentModule } from "./csv-agent";
import { feedbackAgentModule } from "./feedback-agent";
import { pdfAgentModule } from "./pdf-agent";
import { reportAgentModule } from "./report-agent";
import { workspaceAgentModule } from "./workspace-agent";
import { buildCapabilityBundle } from "./shared/registry";
import type { CapabilityBundle, CapabilityModule } from "./types";

export const capabilityModules: CapabilityModule[] = [
  reportAgentModule,
  csvAgentModule,
  chartAgentModule,
  pdfAgentModule,
  workspaceAgentModule,
  feedbackAgentModule,
];

export function buildCapabilityBundleForRoot(rootCapabilityId: string): CapabilityBundle {
  return buildCapabilityBundle(rootCapabilityId, capabilityModules);
}

export function getCapabilityModule(capabilityId: string): CapabilityModule | null {
  return (
    capabilityModules.find(
      (capabilityModule) => capabilityModule.definition.id === capabilityId,
    ) ?? null
  );
}
