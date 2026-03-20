import { useEffect, useMemo } from "react";

import { AuthPanel } from "../components/AuthPanel";
import {
  buildCapabilityQuickViewFacts,
  buildFolderRowsFromArtifacts,
  CapabilityQuickView,
  parseSavedChartArtifact,
  type CapabilityQuickViewFact,
  type CapabilityQuickViewGroup,
} from "../components/CapabilityQuickView";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import {
  bindClientToolsForBundle,
  buildCapabilityBundleForRoot,
  listCapabilityBundleToolNames,
} from "./runtime-registry";
import { chartAgentCapability } from "./definitions";
import { buildChartAgentDemoScenario } from "./chart-agent/demo";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { useDemoScenario } from "./shared/useDemoScenario";
import type { LocalWorkspaceFile } from "../types/report";
import type {
  ShellWorkspaceArtifact,
  ShellWorkspaceRegistration,
} from "./types";
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
  ReportWorkspaceColumn,
  ReportWorkspaceLayout,
} from "./styles";

type ChartAgentTab = "agent" | "demo";

const DEFAULT_STATUS = "Load CSV or JSON chartable artifacts to start using the Chart agent.";
const DEFAULT_BRIEF =
  "Inspect chartable artifacts, make a chart plan first, and render the clearest visual explanation possible.";

function buildChartQuickViewGroups(
  artifacts: ShellWorkspaceArtifact[],
): CapabilityQuickViewGroup[] {
  const relevantArtifacts = artifacts.filter((artifact) =>
    parseSavedChartArtifact(artifact.file) !== null,
  );

  return [
    {
      key: "saved-charts",
      label: "Saved charts",
      rows: buildFolderRowsFromArtifacts(relevantArtifacts),
    },
  ];
}

function buildChartQuickViewFacts(files: LocalWorkspaceFile[]) {
  return function buildPreviewFacts(
    artifact: ShellWorkspaceArtifact,
  ): CapabilityQuickViewFact[] {
    const savedChart = parseSavedChartArtifact(artifact.file);
    const extraFacts: CapabilityQuickViewFact[] = [];

    if (savedChart?.fileId) {
      const sourceFile =
        files.find((candidate) => candidate.id === savedChart.fileId) ?? null;
      extraFacts.push({
        key: "linked-source",
        value: sourceFile
          ? `Source ${sourceFile.name}`
          : `Source ${savedChart.fileId}`,
      });
    }

    return buildCapabilityQuickViewFacts(artifact, { extraFacts });
  };
}

export function ChartAgentPage({
  onRegisterWorkspace,
}: {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
}) {
  const {
    entries,
    files,
    setFiles,
    appendFiles,
    artifacts,
    setStatus,
    investigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    setReportEffects,
    handleFiles,
    handleRemoveEntry,
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
    capabilityId: chartAgentCapability.id,
    capabilityTitle: chartAgentCapability.title,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "agent",
    allowedTabs: ["agent", "demo"],
  });
  const capabilityWorkspace = useMemo(
    () => ({
      capabilityId: chartAgentCapability.id,
      capabilityTitle: chartAgentCapability.title,
      workspaceId: selectedWorkspaceId,
      entries,
      files,
      workspaceContext,
      updateFilesystem,
      getState,
    }),
    [entries, files, getState, selectedWorkspaceId, updateFilesystem, workspaceContext],
  );
  const capabilityBundle = useMemo(
    () => buildCapabilityBundleForRoot(chartAgentCapability.id, capabilityWorkspace),
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
    prepareDemoRun,
  } = useDemoScenario({
    active: activeWorkspaceTab === "demo",
    capabilityId: chartAgentCapability.id,
    ready: workspaceHydrated,
    buildDemoScenario: buildChartAgentDemoScenario,
    files,
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
      capabilityId: chartAgentCapability.id,
      title: "Workspace",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      artifacts,
      workspaces,
      activeWorkspaceId: selectedWorkspaceId,
      activeWorkspaceName: selectedWorkspaceName,
      activeWorkspaceKind: selectedWorkspaceKind,
      accept: ".csv,.json",
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

  const chartQuickViewGroups = useMemo(
    () => buildChartQuickViewGroups(artifacts),
    [artifacts],
  );
  const buildChartFacts = useMemo(
    () => buildChartQuickViewFacts(files),
    [files],
  );

  return (
    <CapabilityPage>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{chartAgentCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{chartAgentCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            Build polished charts from explicit CSV and JSON artifacts with a deliberate plan-first workflow.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" blendWithShell />
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
            <CapabilityQuickView
              emptyMessage="Rendered chart artifacts will appear here as the Chart agent saves them."
              groups={chartQuickViewGroups}
              buildPreviewFacts={buildChartFacts}
              dataTestId="chart-agent-quick-view"
            />
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <ChatKitPane
              capabilityBundle={capabilityBundle}
              enabled
              files={files}
              workspaceState={workspaceStateMetadata}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={appendReportEffects}
              onFilesAdded={appendFiles}
              greeting={chartAgentCapability.chatkitLead}
              composerPlaceholder={chartAgentCapability.chatkitPlaceholder}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <CapabilityQuickView
              emptyMessage="Rendered chart artifacts will appear here as the Chart agent saves them."
              groups={chartQuickViewGroups}
              buildPreviewFacts={buildChartFacts}
              dataTestId="chart-agent-quick-view"
            />
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <CapabilityDemoPane
              scenario={demoScenario}
              loading={demoLoading}
              error={demoError}
              capabilityBundle={capabilityBundle}
              files={files}
              workspaceState={workspaceStateMetadata}
              clientTools={clientTools}
              onEffects={appendReportEffects}
              onFilesAdded={appendFiles}
              onPrepareDemoRun={prepareDemoRun}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}
    </CapabilityPage>
  );
}
