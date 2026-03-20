import { useEffect, useMemo } from "react";

import { AuthPanel } from "../components/AuthPanel";
import {
  buildFolderRowsFromArtifacts,
  CapabilityQuickView,
  type CapabilityQuickViewGroup,
} from "../components/CapabilityQuickView";
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
import type {
  ShellWorkspaceArtifact,
  ShellWorkspaceRegistration,
} from "./types";
import type { ClientEffect } from "../types/analysis";
import {
  CapabilityPage,
  CapabilityEyebrow,
  CapabilityHeader,
  CapabilityHeroRow,
  CapabilitySubhead,
  CapabilityTabBar,
  CapabilityTabButton,
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

function buildCsvQuickViewGroups(
  artifacts: ShellWorkspaceArtifact[],
): CapabilityQuickViewGroup[] {
  const relevantArtifacts = artifacts.filter(
    (artifact) =>
      artifact.source !== "uploaded" &&
      (artifact.file.kind === "csv" || artifact.file.kind === "json") &&
      !artifact.path.startsWith("/reports/") &&
      !artifact.path.startsWith("/artifacts/charts/"),
  );

  return [
    {
      key: "csv-results",
      label: "Materialized results",
      rows: buildFolderRowsFromArtifacts(relevantArtifacts, {
        stripPrefixes: ["/artifacts/data/"],
      }),
    },
  ];
}

export function CsvAgentPage({
  onRegisterWorkspace,
}: {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
}) {
  const {
    activePrefix,
    cwdPath,
    entries,
    files,
    setFiles,
    appendFiles,
    artifacts,
    setStatus,
    investigationBrief,
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
    workspaces,
    selectedWorkspaceId,
    selectedWorkspaceName,
    selectedWorkspaceKind,
    selectWorkspace,
    createWorkspace,
    clearWorkspace,
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

  const handleClearWorkspace = useMemo(() => {
    if (selectedWorkspaceKind === "demo" && activeWorkspaceTab === "demo") {
      return () => {
        if (!demoScenario) {
          return;
        }
        setFiles(demoScenario.workspaceSeed);
        setReportEffects([]);
        setStatus(`Reset demo workspace for ${demoScenario.title}.`);
      };
    }
    return clearWorkspace;
  }, [activeWorkspaceTab, clearWorkspace, demoScenario, selectedWorkspaceKind, setFiles, setReportEffects, setStatus]);

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: csvAgentCapability.id,
      title: "Workspace",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      artifacts,
      workspaces,
      activeWorkspaceId: selectedWorkspaceId,
      activeWorkspaceName: selectedWorkspaceName,
      activeWorkspaceKind: selectedWorkspaceKind,
      accept: ".csv",
      onSelectFiles: handleFiles,
      onSelectWorkspace: selectWorkspace,
      onCreateWorkspace: createWorkspace,
      onClearWorkspace: handleClearWorkspace,
      clearActionLabel:
        selectedWorkspaceKind === "demo" && activeWorkspaceTab === "demo"
          ? "Reset demo workspace"
          : "Clear workspace",
      clearActionDisabled:
        selectedWorkspaceKind === "demo" && activeWorkspaceTab === "demo" && !demoScenario,
      onRemoveArtifact: handleRemoveEntry,
    });
  }, [
    activeWorkspaceTab,
    artifacts,
    createWorkspace,
    demoScenario,
    handleClearWorkspace,
    handleFiles,
    handleRemoveEntry,
    onRegisterWorkspace,
    selectWorkspace,
    selectedWorkspaceId,
    selectedWorkspaceKind,
    selectedWorkspaceName,
    workspaces,
  ]);

  useEffect(() => {
    syncToolCatalog(clientToolCatalogKey ? clientToolCatalogKey.split("|") : []);
  }, [clientToolCatalogKey, syncToolCatalog]);

  const csvQuickViewGroups = useMemo(
    () => buildCsvQuickViewGroups(artifacts),
    [artifacts],
  );

  return (
    <CapabilityPage>
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
            <CapabilityQuickView
              title="CSV results"
              description="Review reusable CSV and JSON outputs from the current workspace."
              emptyMessage="Materialized CSV and JSON results will appear here as the agent creates them."
              groups={csvQuickViewGroups}
              dataTestId="csv-agent-quick-view"
            />
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
              greeting={csvAgentCapability.chatkitLead}
              composerPlaceholder={csvAgentCapability.chatkitPlaceholder}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
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
    </CapabilityPage>
  );
}
