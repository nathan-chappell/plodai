import { useEffect, useMemo } from "react";

import { MetaText } from "../app/styles";
import { AuthPanel } from "../components/AuthPanel";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { DatasetChart } from "../components/DatasetChart";
import { buildChartAgentDemoScenario } from "./chart-agent/demo";
import { createChartAgentClientTools } from "./chart-agent/tools";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { buildChartAgentBundle } from "./manifests";
import { useDemoScenario } from "./shared/useDemoScenario";
import type { ClientEffect } from "../types/analysis";
import type { CapabilityDefinition, ShellWorkspaceRegistration } from "./types";
import {
  CapabilityEyebrow,
  CapabilityHeader,
  CapabilityHeroRow,
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

type ChartAgentTab = "agent" | "goal" | "demo";

const DEFAULT_STATUS = "Load CSV or JSON chartable artifacts to start using the Chart agent.";
const DEFAULT_BRIEF =
  "Inspect chartable artifacts, make a chart plan first, and render the clearest visual explanation possible.";

function isChartEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "chart_rendered" }> {
  return effect.type === "chart_rendered";
}

function GoalPanel({
  investigationBrief,
  setInvestigationBrief,
}: {
  investigationBrief: string;
  setInvestigationBrief: (value: string) => void;
}) {
  return (
    <CapabilityPanel>
      <CapabilitySectionHeader>
        <CapabilitySectionTitle>Chart goal</CapabilitySectionTitle>
        <CapabilityMetaText>This brief keeps the Chart agent focused on the current visual story.</CapabilityMetaText>
      </CapabilitySectionHeader>
      <CapabilityTextarea
        value={investigationBrief}
        onChange={(event) => setInvestigationBrief(event.target.value)}
        placeholder="Example: Turn the explicit result artifacts into the most persuasive comparative charts."
      />
      <CapabilityHighlight>
        <CapabilityMetaText>
          The Chart agent expects explicit CSV or JSON artifacts and always makes a plan before rendering.
        </CapabilityMetaText>
      </CapabilityHighlight>
    </CapabilityPanel>
  );
}

export const chartAgentCapability: CapabilityDefinition = {
  id: "chart-agent",
  path: "/capabilities/chart-agent",
  navLabel: "Chart Agent",
  title: "Chart Agent",
  eyebrow: "Capability",
  description: "Beautiful Chart.js rendering over explicit CSV and JSON artifacts.",
  tabs: [
    { id: "agent", label: "Agent" },
    { id: "goal", label: "Goal" },
    { id: "demo", label: "Demo" },
  ],
};

export function ChartAgentPage({
  onRegisterWorkspace,
}: {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
}) {
  const {
    files,
    setFiles,
    appendFiles,
    status,
    setStatus,
    investigationBrief,
    setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    reportEffects,
    setReportEffects,
    handleFiles,
    handleClearFiles,
    handleRemoveFile,
  } = useCapabilityFileWorkspace({
    capabilityId: chartAgentCapability.id,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "agent",
    allowedTabs: ["agent", "goal", "demo"],
  });
  const capabilityBundle = useMemo(() => buildChartAgentBundle(), []);
  const clientTools = useMemo(() => createChartAgentClientTools({ files }), [files]);
  const {
    scenario: demoScenario,
    loading: demoLoading,
    error: demoError,
    reloadScenario,
  } = useDemoScenario({
    active: activeWorkspaceTab === "demo",
    buildDemoScenario: buildChartAgentDemoScenario,
    setFiles,
    setStatus,
    setReportEffects,
  });

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: chartAgentCapability.id,
      title: "Files",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      files,
      accept: ".csv,.json",
      onSelectFiles: handleFiles,
      onClearFiles: handleClearFiles,
      onRemoveFile: handleRemoveFile,
    });
  }, [files, handleClearFiles, handleFiles, handleRemoveFile, onRegisterWorkspace]);

  return (
    <>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{chartAgentCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{chartAgentCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            Build polished charts from explicit CSV and JSON artifacts with a deliberate plan-first workflow.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" />
      </CapabilityHeroRow>

      <CapabilityTabBar>
        {chartAgentCapability.tabs.map((tab) => (
          <CapabilityTabButton
            key={tab.id}
            $active={activeWorkspaceTab === tab.id}
            onClick={() => setActiveWorkspaceTab(tab.id as ChartAgentTab)}
            type="button"
          >
            {tab.label}
          </CapabilityTabButton>
        ))}
      </CapabilityTabBar>

      {activeWorkspaceTab === "agent" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <CapabilityPanel>
              <CapabilitySectionHeader>
                <CapabilitySectionTitle>Chartable artifacts</CapabilitySectionTitle>
                <CapabilityMetaText>{status}</CapabilityMetaText>
              </CapabilitySectionHeader>
              <MetaText>
                Files: {files.length ? files.map((file) => `${file.name} (${file.kind})`).join(", ") : "none yet"}
              </MetaText>
              <MetaText>
                Goal: {investigationBrief.trim() || "No goal set yet. Open the Goal tab to define the current charting task."}
              </MetaText>
            </CapabilityPanel>

            {reportEffects.length ? (
              <ReportEffectsPanel>
                {reportEffects.filter(isChartEffect).map((effect, index) => (
                  <ReportEffectCard key={`${effect.type}-${effect.chartPlanId}-${index}`}>
                    <DatasetChart spec={effect.chart} rows={effect.rows} />
                  </ReportEffectCard>
                ))}
              </ReportEffectsPanel>
            ) : null}
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <ChatKitPane
              capabilityBundle={capabilityBundle}
              enabled
              files={files}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={(nextEffects) => setReportEffects((current) => [...nextEffects, ...current].slice(0, 8))}
              onFilesAdded={appendFiles}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "goal" ? (
        <GoalPanel investigationBrief={investigationBrief} setInvestigationBrief={setInvestigationBrief} />
      ) : null}

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <CapabilityPanel>
              <CapabilitySectionHeader>
                <CapabilitySectionTitle>Demo workspace</CapabilitySectionTitle>
                <CapabilityMetaText>
                  {demoLoading ? "Preparing the chart demo." : demoError ?? status}
                </CapabilityMetaText>
              </CapabilitySectionHeader>
              <MetaText>
                Files: {files.length ? files.map((file) => `${file.name} (${file.kind})`).join(", ") : "loading demo files"}
              </MetaText>
              <MetaText>Demo: {demoScenario?.title ?? "Preparing scenario"}</MetaText>
            </CapabilityPanel>

            {reportEffects.filter(isChartEffect).length ? (
              <ReportEffectsPanel>
                {reportEffects.filter(isChartEffect).map((effect, index) => (
                  <ReportEffectCard key={`${effect.type}-${effect.chartPlanId}-${index}`}>
                    <DatasetChart spec={effect.chart} rows={effect.rows} />
                  </ReportEffectCard>
                ))}
              </ReportEffectsPanel>
            ) : null}
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <CapabilityDemoPane
              scenario={demoScenario}
              loading={demoLoading}
              error={demoError}
              capabilityBundle={capabilityBundle}
              files={files}
              clientTools={clientTools}
              onEffects={(nextEffects) => setReportEffects((current) => [...nextEffects, ...current].slice(0, 8))}
              onFilesAdded={appendFiles}
              onReloadScenario={reloadScenario}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}
    </>
  );
}
