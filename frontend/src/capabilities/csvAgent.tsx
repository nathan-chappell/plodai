import { useEffect, useMemo } from "react";

import { MetaText } from "../app/styles";
import { AuthPanel } from "../components/AuthPanel";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { DatasetChart } from "../components/DatasetChart";
import {
  bindClientToolsForBundle,
  buildCapabilityBundleForRoot,
  listCapabilityBundleToolNames,
} from "./registry";
import { csvAgentCapability } from "./definitions";
import { buildCsvAgentDemoScenario } from "./csv-agent/demo";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { useDemoScenario } from "./shared/useDemoScenario";
import type { ShellWorkspaceRegistration } from "./types";
import type { ClientEffect } from "../types/analysis";
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

type CsvAgentTab = "agent" | "demo";

const DEFAULT_STATUS = "Load CSV files to start using the CSV agent.";
const DEFAULT_BRIEF =
  "Inspect the available CSVs, use safe aggregate queries, materialize reusable result artifacts, and hand off to charting when useful.";

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
        <CapabilitySectionTitle>Agent goal</CapabilitySectionTitle>
        <CapabilityMetaText>This brief is saved with the conversation so the CSV agent keeps the current objective in view.</CapabilityMetaText>
      </CapabilitySectionHeader>
      <CapabilityTextarea
        value={investigationBrief}
        onChange={(event) => setInvestigationBrief(event.target.value)}
        placeholder="Example: Investigate revenue concentration, create a chartable JSON artifact, and prepare it for the chart specialist."
      />
      <CapabilityHighlight>
        <CapabilityMetaText>
          This workspace is focused on CSV inspection, aggregate analysis, and reusable CSV or JSON artifact creation.
        </CapabilityMetaText>
      </CapabilityHighlight>
    </CapabilityPanel>
  );
}

export function CsvAgentPage({
  onRegisterWorkspace,
}: {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
}) {
  const {
    activePrefix,
    cwdPath,
    filesystem,
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
    setActivePrefix,
    workspaceContext,
    workspaceHydrated,
    getState,
    updateFilesystem,
    syncToolCatalog,
    appendReportEffects,
    workspaceStateMetadata,
  } = useCapabilityFileWorkspace({
    capabilityId: csvAgentCapability.id,
    capabilityTitle: csvAgentCapability.title,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "agent",
    allowedTabs: ["agent", "demo"],
  });
  const capabilityWorkspace = useMemo(
    () => ({
      activePrefix,
      cwdPath,
      entries,
      files,
      workspaceContext,
      setActivePrefix,
      createDirectory,
      changeDirectory,
      updateFilesystem,
      getState,
    }),
    [activePrefix, changeDirectory, createDirectory, cwdPath, entries, files, getState, setActivePrefix, updateFilesystem, workspaceContext],
  );
  const capabilityBundle = useMemo(
    () => buildCapabilityBundleForRoot(csvAgentCapability.id, capabilityWorkspace),
    [capabilityWorkspace],
  );
  const clientTools = useMemo(
    () => bindClientToolsForBundle(capabilityBundle, capabilityWorkspace),
    [capabilityBundle, capabilityWorkspace],
  );
  const clientToolCatalogKey = useMemo(
    () => listCapabilityBundleToolNames(capabilityBundle).join("|"),
    [capabilityBundle],
  );
  const {
    scenario: demoScenario,
    loading: demoLoading,
    error: demoError,
  } = useDemoScenario({
    active: activeWorkspaceTab === "demo",
    capabilityId: csvAgentCapability.id,
    ready: workspaceHydrated,
    buildDemoScenario: buildCsvAgentDemoScenario,
    setExecutionMode,
    setFiles,
    setStatus,
    setReportEffects,
  });

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: csvAgentCapability.id,
      title: "Files",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      activePrefix,
      cwdPath,
      filesystem,
      breadcrumbs,
      entries,
      accept: ".csv",
      onSelectFiles: handleFiles,
      onCreateDirectory: createDirectory,
      onChangeDirectory: changeDirectory,
      onRemoveEntry: handleRemoveEntry,
    });
  }, [activePrefix, breadcrumbs, changeDirectory, createDirectory, cwdPath, entries, filesystem, handleFiles, handleRemoveEntry, onRegisterWorkspace]);

  useEffect(() => {
    syncToolCatalog(clientToolCatalogKey ? clientToolCatalogKey.split("|") : []);
  }, [clientToolCatalogKey, syncToolCatalog]);

  return (
    <>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{csvAgentCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{csvAgentCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            Work directly with CSVs: inspect schemas, run safe aggregate queries, and create explicit chartable artifacts.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" />
      </CapabilityHeroRow>

      <CapabilityTabBar>
        {csvAgentCapability.tabs.map((tab) => (
          <CapabilityTabButton
            key={tab.id}
            data-testid={`csv-agent-tab-${tab.id}`}
            $active={activeWorkspaceTab === tab.id}
            onClick={() => setActiveWorkspaceTab(tab.id as CsvAgentTab)}
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
                <CapabilitySectionTitle>Workspace state</CapabilitySectionTitle>
                <CapabilityMetaText>{status}</CapabilityMetaText>
              </CapabilitySectionHeader>
              <MetaText>
                Prefix: {activePrefix}
              </MetaText>
              <MetaText>
                Files: {files.length ? files.map((file) => `${file.name} (${file.kind})`).join(", ") : "none yet"}
              </MetaText>
              <MetaText>
                Goal: {investigationBrief.trim() || "No goal set yet. Open the Goal tab to define the current CSV task."}
              </MetaText>
              {reportEffects.length ? <MetaText>Client effects captured this session: {reportEffects.length}</MetaText> : null}
            </CapabilityPanel>
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <ChatKitPane
              capabilityBundle={capabilityBundle}
              enabled
              files={files}
              workspaceState={workspaceStateMetadata}
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
            <CapabilityPanel data-testid="csv-agent-demo-workspace">
              <CapabilitySectionHeader>
                <CapabilitySectionTitle>Demo workspace</CapabilitySectionTitle>
                <CapabilityMetaText>
                  {demoLoading
                    ? "Preparing the curated CSV demo."
                    : demoError ?? status}
                </CapabilityMetaText>
              </CapabilitySectionHeader>
              <MetaText data-testid="csv-agent-demo-files">
                Files: {files.length ? files.map((file) => `${file.name} (${file.kind})`).join(", ") : "loading demo files"}
              </MetaText>
              <MetaText data-testid="csv-agent-demo-title">
                Demo: {demoScenario?.title ?? "Preparing scenario"}
              </MetaText>
              <MetaText data-testid="csv-agent-demo-effect-count">
                Effects captured this run: {reportEffects.length}
              </MetaText>
            </CapabilityPanel>
            {reportEffects.filter(isChartEffect).length ? (
              <ReportEffectsPanel data-testid="csv-agent-demo-effects">
                {reportEffects.filter(isChartEffect).map((effect, index) => (
                  <ReportEffectCard key={`${effect.type}-${effect.chartPlanId}-${index}`} data-testid="csv-agent-demo-chart-effect">
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
              workspaceState={workspaceStateMetadata}
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
