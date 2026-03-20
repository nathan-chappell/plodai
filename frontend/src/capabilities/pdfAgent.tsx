import { useEffect, useMemo } from "react";

import { AuthPanel } from "../components/AuthPanel";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { PdfSmartSplitExplorer } from "../components/PdfSmartSplitExplorer";
import {
  bindClientToolsForBundle,
  buildCapabilityBundleForRoot,
  listCapabilityBundleToolNames,
} from "./runtime-registry";
import { pdfAgentCapability } from "./definitions";
import { buildPdfAgentDemoScenario } from "./pdf-agent/demo";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { useDemoScenario } from "./shared/useDemoScenario";
import type { ShellWorkspaceRegistration } from "./types";
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

type PdfAgentTab = "agent" | "demo";

const DEFAULT_STATUS = "Load PDF files to start carving bounded page ranges.";
const DEFAULT_BRIEF =
  "Inspect the available PDFs, keep page selections bounded, and split them into the most useful sub-documents.";

export function PdfAgentPage({
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
    smartSplitBundles,
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
    capabilityId: pdfAgentCapability.id,
    capabilityTitle: pdfAgentCapability.title,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "agent",
    allowedTabs: ["agent", "demo"],
  });
  const capabilityWorkspace = useMemo(
    () => ({
      capabilityId: pdfAgentCapability.id,
      capabilityTitle: pdfAgentCapability.title,
      workspaceId: selectedWorkspaceId,
      entries,
      files,
      workspaceContext,
      updateFilesystem,
      getState,
    }),
    [
      entries,
      files,
      getState,
      selectedWorkspaceId,
      updateFilesystem,
      workspaceContext,
    ],
  );
  const capabilityBundle = useMemo(
    () => buildCapabilityBundleForRoot(pdfAgentCapability.id, capabilityWorkspace),
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
    capabilityId: pdfAgentCapability.id,
    ready: workspaceHydrated,
    buildDemoScenario: buildPdfAgentDemoScenario,
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
  }, [
    activeWorkspaceTab,
    clearWorkspace,
    demoScenario,
    selectedWorkspaceKind,
    setFiles,
    setReportEffects,
    setStatus,
  ]);

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: pdfAgentCapability.id,
      title: "Workspace",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      artifacts,
      smartSplitBundles,
      workspaces,
      activeWorkspaceId: selectedWorkspaceId,
      activeWorkspaceName: selectedWorkspaceName,
      activeWorkspaceKind: selectedWorkspaceKind,
      accept: ".pdf",
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
    smartSplitBundles,
    workspaces,
  ]);

  useEffect(() => {
    syncToolCatalog(clientToolCatalogKey ? clientToolCatalogKey.split("|") : []);
  }, [clientToolCatalogKey, syncToolCatalog]);

  const smartSplitPane = (
    <PdfSmartSplitExplorer
      title="Smart splits"
      description="Review persisted smart split bundles and open extracted sub-documents without guessing from filenames."
      emptyMessage="Saved smart split bundles will appear here once the PDF agent creates them."
      bundles={smartSplitBundles}
      artifacts={artifacts}
      dataTestId="pdf-agent-quick-view"
    />
  );

  return (
    <CapabilityPage>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{pdfAgentCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{pdfAgentCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            Extract bounded page ranges from local PDFs and feed the derived sub-documents back into the workspace.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" blendWithShell />
      </CapabilityHeroRow>

      <CapabilityTabBar>
        {pdfAgentCapability.tabs.map((tab) => (
          <CapabilityTabButton
            key={tab.id}
            data-testid={`pdf-agent-tab-${tab.id}`}
            $active={activeWorkspaceTab === tab.id}
            onClick={() => setActiveWorkspaceTab(tab.id as PdfAgentTab)}
            type="button"
          >
            {tab.label}
          </CapabilityTabButton>
        ))}
      </CapabilityTabBar>

      {activeWorkspaceTab === "agent" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>{smartSplitPane}</ReportWorkspaceColumn>
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
              greeting={pdfAgentCapability.chatkitLead}
              composerPlaceholder={pdfAgentCapability.chatkitPlaceholder}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>{smartSplitPane}</ReportWorkspaceColumn>
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
