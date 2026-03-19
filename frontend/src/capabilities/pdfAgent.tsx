import { useEffect, useMemo } from "react";

import { AuthPanel } from "../components/AuthPanel";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import {
  bindClientToolsForBundle,
  buildCapabilityBundleForRoot,
  listCapabilityBundleToolNames,
} from "./registry";
import { pdfAgentCapability } from "./definitions";
import { buildPdfAgentDemoScenario } from "./pdf-agent/demo";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { useDemoScenario } from "./shared/useDemoScenario";
import { MetaText } from "../app/styles";
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

type PdfAgentTab = "agent" | "demo";

const DEFAULT_STATUS = "Load PDF files to start carving bounded page ranges.";
const DEFAULT_BRIEF =
  "Inspect the available PDFs, keep page selections bounded, and split them into the most useful sub-documents.";

function isPdfEffect(effect: ClientEffect): effect is Extract<ClientEffect, { type: "pdf_smart_split_completed" }> {
  return effect.type === "pdf_smart_split_completed";
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
        <CapabilityMetaText>This brief keeps the PDF agent focused on the current decomposition task.</CapabilityMetaText>
      </CapabilitySectionHeader>
      <CapabilityTextarea
        value={investigationBrief}
        onChange={(event) => setInvestigationBrief(event.target.value)}
        placeholder="Example: Extract the executive summary and appendix pages into separate sub-PDFs."
      />
      <CapabilityHighlight>
        <CapabilityMetaText>
          Inspect first, then either extract bounded page ranges or ask for a smart split that creates sub-PDFs, an index, and a ZIP.
        </CapabilityMetaText>
      </CapabilityHighlight>
    </CapabilityPanel>
  );
}

export function PdfAgentPage({
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
    capabilityId: pdfAgentCapability.id,
    capabilityTitle: pdfAgentCapability.title,
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
  } = useDemoScenario({
    active: activeWorkspaceTab === "demo",
    capabilityId: pdfAgentCapability.id,
    ready: workspaceHydrated,
    buildDemoScenario: buildPdfAgentDemoScenario,
    setExecutionMode,
    setFiles,
    setStatus,
    setReportEffects,
  });

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: pdfAgentCapability.id,
      title: "Files",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      activePrefix,
      cwdPath,
      filesystem,
      breadcrumbs,
      entries,
      accept: ".pdf",
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
          <CapabilityEyebrow>{pdfAgentCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{pdfAgentCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            Extract bounded page ranges from local PDFs and feed the derived sub-documents back into the workspace.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" />
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
                Goal: {investigationBrief.trim() || "No goal set yet. Open the Goal tab to define the current extraction task."}
              </MetaText>
              <MetaText>Use the sidebar workspace panel to load PDFs or remove them from the current session.</MetaText>
              {reportEffects.length ? <MetaText>Client effects captured this session: {reportEffects.length}</MetaText> : null}
            </CapabilityPanel>
            {reportEffects.filter(isPdfEffect).length ? (
              <ReportEffectsPanel>
                {reportEffects.filter(isPdfEffect).map((effect, index) => (
                  <ReportEffectCard key={`${effect.type}-${effect.archiveFileId}-${index}`}>
                    <h3>Smart split: {effect.sourceFileName}</h3>
                    <MetaText>{effect.markdown}</MetaText>
                    <MetaText>Archive ready: {effect.archiveFileName}</MetaText>
                    <MetaText>
                      Outputs: {effect.entries.map((entry) => `${entry.title} (${entry.startPage}-${entry.endPage})`).join(", ")}
                    </MetaText>
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
            <CapabilityPanel data-testid="pdf-agent-demo-workspace">
              <CapabilitySectionHeader>
                <CapabilitySectionTitle>Demo workspace</CapabilitySectionTitle>
                <CapabilityMetaText>
                  {demoLoading ? "Preparing the PDF demo." : demoError ?? status}
                </CapabilityMetaText>
              </CapabilitySectionHeader>
              <MetaText data-testid="pdf-agent-demo-files">
                Files: {files.length ? files.map((file) => `${file.name} (${file.kind})`).join(", ") : "loading demo files"}
              </MetaText>
              <MetaText data-testid="pdf-agent-demo-title">Demo: {demoScenario?.title ?? "Preparing scenario"}</MetaText>
            </CapabilityPanel>
            {reportEffects.filter(isPdfEffect).length ? (
              <ReportEffectsPanel data-testid="pdf-agent-demo-effects">
                {reportEffects.filter(isPdfEffect).map((effect, index) => (
                  <ReportEffectCard key={`${effect.type}-${effect.archiveFileId}-${index}`} data-testid="pdf-agent-demo-pdf-effect">
                    <h3>Smart split: {effect.sourceFileName}</h3>
                    <MetaText>{effect.markdown}</MetaText>
                    <MetaText>Archive ready: {effect.archiveFileName}</MetaText>
                    <MetaText>
                      Outputs: {effect.entries.map((entry) => `${entry.title} (${entry.startPage}-${entry.endPage})`).join(", ")}
                    </MetaText>
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
