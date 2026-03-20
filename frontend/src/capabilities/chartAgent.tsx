import { useEffect, useMemo } from "react";
import styled from "styled-components";

import { AuthPanel } from "../components/AuthPanel";
import {
  buildFolderRowsFromArtifacts,
  CapabilityQuickView,
  parseSavedChartArtifact,
  renderDefaultCapabilityQuickViewPreview,
  type CapabilityQuickViewGroup,
  type CapabilityQuickViewRenderArgs,
} from "../components/CapabilityQuickView";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import {
  bindClientToolsForBundle,
  buildCapabilityBundleForRoot,
  listCapabilityBundleToolNames,
} from "./registry";
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
import { CapabilityMetaText } from "./styles";
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
    artifact.path.startsWith("/artifacts/charts/") &&
    parseSavedChartArtifact(artifact.file) !== null,
  );

  return [
    {
      key: "saved-charts",
      label: "Saved charts",
      rows: buildFolderRowsFromArtifacts(relevantArtifacts, {
        stripPrefixes: ["/artifacts/charts/"],
      }),
    },
  ];
}

function buildRenderChartQuickViewPreview(files: LocalWorkspaceFile[]) {
  return function renderChartQuickViewPreview(args: CapabilityQuickViewRenderArgs) {
    const savedChart = parseSavedChartArtifact(args.selectedArtifact.file);
    if (!savedChart) {
      return renderDefaultCapabilityQuickViewPreview(args);
    }
    const sourceFile = savedChart.fileId
      ? files.find((candidate) => candidate.id === savedChart.fileId) ?? null
      : null;
    return (
      <>
        <ChartPreviewMetaRow>
          <ChartPreviewMetaChip>
            {savedChart.chartPlanId ? `Plan ${savedChart.chartPlanId}` : "Saved chart"}
          </ChartPreviewMetaChip>
          <ChartPreviewMetaChip>
            {sourceFile
              ? `Source ${sourceFile.name}`
              : savedChart.fileId
                ? `Source ${savedChart.fileId}`
                : "Source file unavailable"}
          </ChartPreviewMetaChip>
        </ChartPreviewMetaRow>
        {renderDefaultCapabilityQuickViewPreview(args)}
        {!savedChart.imageDataUrl ? (
          <CapabilityMetaText>
            This chart artifact is saved in the workspace, but it does not have an inline image yet.
          </CapabilityMetaText>
        ) : null}
      </>
    );
  };
}

export function ChartAgentPage({
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
    capabilityId: chartAgentCapability.id,
    capabilityTitle: chartAgentCapability.title,
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
  const renderChartPreview = useMemo(
    () => buildRenderChartQuickViewPreview(files),
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
            <CapabilityQuickView
              title="Saved charts"
              description="Preview charts already rendered into the current workspace."
              emptyMessage="Rendered chart artifacts will appear here as the Chart agent saves them."
              groups={chartQuickViewGroups}
              renderPreview={renderChartPreview}
              dataTestId="chart-agent-quick-view"
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
              title="Saved charts"
              description="Preview charts already rendered into the current workspace."
              emptyMessage="Rendered chart artifacts will appear here as the Chart agent saves them."
              groups={chartQuickViewGroups}
              renderPreview={renderChartPreview}
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
              executionMode={executionMode}
              onExecutionModeChange={setExecutionMode}
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

const ChartPreviewMetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
`;

const ChartPreviewMetaChip = styled.div`
  display: inline-flex;
  align-items: center;
  padding: 0.22rem 0.52rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.1);
  background: rgba(255, 255, 255, 0.82);
  font-size: 0.72rem;
  font-weight: 700;
`;
