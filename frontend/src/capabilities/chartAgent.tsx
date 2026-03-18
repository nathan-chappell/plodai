import { useEffect, useMemo } from "react";

import { MetaText } from "../app/styles";
import { AuthPanel } from "../components/AuthPanel";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { DatasetChart } from "../components/DatasetChart";
import { chartAgentCapability } from "./definitions";
import { buildChartAgentDemoScenario } from "./chart-agent/demo";
import { createChartAgentClientTools } from "./chart-agent/tools";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { buildChartAgentBundle } from "./manifests";
import { useDemoScenario } from "./shared/useDemoScenario";
import type { ClientEffect } from "../types/analysis";
import type { ShellWorkspaceRegistration } from "./types";
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

type ChartAgentTab = "agent" | "demo";

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

export function ChartAgentPage({
  onRegisterWorkspace,
}: {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
}) {
  const {
    cwdPath,
    breadcrumbs,
    entries,
    files,
    setFiles,
    appendFiles,
    status,
    setStatus,
    investigationBrief,
    setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    executionMode,
    setExecutionMode,
    reportEffects,
    setReportEffects,
    handleFiles,
    handleRemoveEntry,
    createDirectory,
    changeDirectory,
    workspaceContext,
    getState,
    updateFilesystem,
    syncToolCatalog,
    appendReportEffects,
    workspaceBootstrapMetadata,
  } = useCapabilityFileWorkspace({
    capabilityId: chartAgentCapability.id,
    capabilityTitle: chartAgentCapability.title,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "agent",
    allowedTabs: ["agent", "demo"],
  });
  const capabilityBundle = useMemo(() => buildChartAgentBundle(), []);
  const clientTools = useMemo(
    () => createChartAgentClientTools({ cwdPath, entries, files, workspaceContext, createDirectory, changeDirectory, updateFilesystem, getState }),
    [changeDirectory, createDirectory, cwdPath, entries, files, getState, updateFilesystem, workspaceContext],
  );
  const {
    scenario: demoScenario,
    loading: demoLoading,
    error: demoError,
  } = useDemoScenario({
    active: activeWorkspaceTab === "demo",
    buildDemoScenario: buildChartAgentDemoScenario,
    setExecutionMode,
    setFiles,
    setStatus,
    setReportEffects,
  });

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: chartAgentCapability.id,
      title: "Files",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      cwdPath,
      breadcrumbs,
      entries,
      accept: ".csv,.json",
      onSelectFiles: handleFiles,
      onCreateDirectory: createDirectory,
      onChangeDirectory: changeDirectory,
      onRemoveEntry: handleRemoveEntry,
    });
  }, [breadcrumbs, changeDirectory, createDirectory, cwdPath, entries, handleFiles, handleRemoveEntry, onRegisterWorkspace]);

  useEffect(() => {
    syncToolCatalog(clientTools.map((tool) => tool.name));
  }, [clientTools, syncToolCatalog]);

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
            data-testid={`chart-agent-tab-${tab.id}`}
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
                CWD: {cwdPath}
              </MetaText>
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
              workspaceContext={workspaceContext}
              workspaceBootstrap={workspaceBootstrapMetadata}
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={appendReportEffects}
              onFilesAdded={appendFiles}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <CapabilityPanel data-testid="chart-agent-demo-workspace">
              <CapabilitySectionHeader>
                <CapabilitySectionTitle>Demo workspace</CapabilitySectionTitle>
                <CapabilityMetaText>
                  {demoLoading ? "Preparing the chart demo." : demoError ?? status}
                </CapabilityMetaText>
              </CapabilitySectionHeader>
              <MetaText data-testid="chart-agent-demo-files">
                Files: {files.length ? files.map((file) => `${file.name} (${file.kind})`).join(", ") : "loading demo files"}
              </MetaText>
              <MetaText data-testid="chart-agent-demo-title">Demo: {demoScenario?.title ?? "Preparing scenario"}</MetaText>
            </CapabilityPanel>

            {reportEffects.filter(isChartEffect).length ? (
              <ReportEffectsPanel data-testid="chart-agent-demo-effects">
                {reportEffects.filter(isChartEffect).map((effect, index) => (
                  <ReportEffectCard key={`${effect.type}-${effect.chartPlanId}-${index}`} data-testid="chart-agent-demo-chart-effect">
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
              workspaceBootstrap={workspaceBootstrapMetadata}
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
              clientTools={clientTools}
              onEffects={appendReportEffects}
              onFilesAdded={appendFiles}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}
    </>
  );
}
