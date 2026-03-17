import { useEffect, useMemo } from "react";

import { useAppState } from "../app/context";
import { ChatKitPane } from "../components/ChatKitPane";
import { DatasetChart } from "../components/DatasetChart";
import { NarrativeCard } from "../components/NarrativeCard";
import { SmokeTestPane } from "../components/SmokeTestPane";
import { useReportFoundryWorkspace, type ReportFoundryWorkspaceTab } from "./hooks";
import type { ClientEffect } from "../types/analysis";
import type { LocalDataset } from "../types/report";
import { MetaText } from "../app/styles";
import type { CapabilityClientTool, CapabilityDefinition, ShellWorkspaceRegistration } from "./types";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { buildReportAgentManifest } from "./manifests";
import { createWorkspaceClientTools } from "../lib/file-agent-tools";
import {
  CapabilityHeroRow,
  CapabilityEyebrow,
  CapabilityHeader,
  CapabilityHighlight,
  CapabilityMetaText,
  CapabilityPanel,
  CapabilitySectionHeader,
  CapabilitySectionTitle,
  CapabilitySubhead,
  CapabilityTabBar,
  CapabilityTabButton,
  CapabilityTextarea,
  CapabilityTitle,
  ReportChatColumn,
  ReportEffectCard,
  ReportEffectsPanel,
  ReportWorkspaceColumn,
  ReportWorkspaceLayout,
} from "./styles";
import { AuthPanel } from "../components/AuthPanel";

function isChartEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "chart_rendered" }> {
  return effect.type === "chart_rendered";
}

function isReportEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "report_section_appended" }> {
  return effect.type === "report_section_appended";
}

function InvestigationBriefPanel({
  investigationBrief,
  setInvestigationBrief,
}: {
  investigationBrief: string;
  setInvestigationBrief: (value: string) => void;
}) {
  return (
    <CapabilityPanel>
      <CapabilitySectionHeader>
        <CapabilitySectionTitle>Analysis goal</CapabilitySectionTitle>
        <CapabilityMetaText>This brief is saved with the conversation so the analyst keeps the objective in view.</CapabilityMetaText>
      </CapabilitySectionHeader>
      <CapabilityTextarea
        value={investigationBrief}
        onChange={(event) => setInvestigationBrief(event.target.value)}
        placeholder="Example: Compare regional performance, find the most surprising anomalies, and suggest the best charts."
      />
      <CapabilityHighlight>
        <CapabilityMetaText>
          The analyst will use this as the working objective, then refine the thread title once the focus becomes clear.
        </CapabilityMetaText>
      </CapabilityHighlight>
    </CapabilityPanel>
  );
}

export function createReportFoundryClientTools(datasets: LocalDataset[]): CapabilityClientTool[] {
  return createWorkspaceClientTools(datasets, { includeCharts: true });
}

export const reportFoundryCapability: CapabilityDefinition = {
  id: "report-agent",
  path: "/capabilities/report-agent",
  navLabel: "Report Agent",
  title: "Report Agent",
  eyebrow: "Capability",
  description: "Investigative report generation over local files.",
  tabs: [
    { id: "report", label: "Report" },
    { id: "goal", label: "Goal" },
    { id: "integration", label: "Integration Test" },
  ],
};

export function ReportFoundryPage({
  onRegisterWorkspace,
}: {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
}) {
  const { user } = useAppState();
  if (!user) {
    return null;
  }
  const {
    datasets,
    status,
    investigationBrief,
    setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    reportEffects,
    setReportEffects,
    handleFiles,
    handleClearDatasets,
    handleLoadSmokeDatasets,
    handleRemoveDataset,
  } = useReportFoundryWorkspace();
  const capabilityManifest = useMemo(() => buildReportAgentManifest(), []);
  const clientTools = useMemo<CapabilityClientTool[]>(() => createReportFoundryClientTools(datasets), [datasets]);

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: reportFoundryCapability.id,
      title: "Files",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      files: datasets,
      accept: ".csv",
      onSelectFiles: handleFiles,
      onClearFiles: handleClearDatasets,
      onRemoveFile: handleRemoveDataset,
    });
  }, [datasets, handleClearDatasets, handleFiles, handleRemoveDataset, onRegisterWorkspace]);

  return (
    <>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{reportFoundryCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{reportFoundryCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            Load local files, set the goal, and investigate through safe queries and charts.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" />
      </CapabilityHeroRow>

      <CapabilityTabBar>
        {reportFoundryCapability.tabs.map((tab) => (
            <CapabilityTabButton
              key={tab.id}
              $active={activeWorkspaceTab === tab.id}
              onClick={() => setActiveWorkspaceTab(tab.id as ReportFoundryWorkspaceTab)}
              type="button"
            >
              {tab.label}
            </CapabilityTabButton>
          ))}
      </CapabilityTabBar>

      {activeWorkspaceTab === "report" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <CapabilityPanel>
              <CapabilitySectionHeader>
                <CapabilitySectionTitle>Report canvas</CapabilitySectionTitle>
              <CapabilityMetaText>{status}</CapabilityMetaText>
              </CapabilitySectionHeader>
              <CapabilityMetaText>Files: {datasets.length ? datasets.map((dataset) => dataset.name).join(", ") : "none yet"}</CapabilityMetaText>
              <CapabilityMetaText>
                Current goal: {investigationBrief.trim() || "No goal set yet. Open the Goal tab to define the investigation."}
              </CapabilityMetaText>
              <CapabilityMetaText>Use the sidebar workspace panel to add, inspect, or remove the files feeding this report.</CapabilityMetaText>
            </CapabilityPanel>

            {reportEffects.length ? (
              <ReportEffectsPanel>
                {reportEffects.map((effect, index) => (
                  <ReportEffectCard key={`${effect.type}-${index}`}>
                    {isChartEffect(effect) ? <DatasetChart spec={effect.chart} rows={effect.rows} /> : null}
                    {isReportEffect(effect) ? (
                      <NarrativeCard
                        section={{
                          id: `${effect.type}-${index}`,
                          title: effect.title,
                          markdown: effect.markdown,
                        }}
                      />
                    ) : null}
                  </ReportEffectCard>
                ))}
              </ReportEffectsPanel>
            ) : null}
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <ChatKitPane
              capabilityManifest={capabilityManifest}
              enabled
              files={datasets}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={(nextEffects) => setReportEffects((current) => [...nextEffects, ...current].slice(0, 8))}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "goal" ? (
        <InvestigationBriefPanel
          investigationBrief={investigationBrief}
          setInvestigationBrief={setInvestigationBrief}
        />
      ) : null}

      {activeWorkspaceTab === "integration" ? <SmokeTestPane onLoadFixtures={handleLoadSmokeDatasets} /> : null}
    </>
  );
}
