import { useEffect, useMemo } from "react";

import { AuthPanel } from "../components/AuthPanel";
import { CapabilityDemoPane } from "../components/CapabilityDemoPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { buildPdfAgentDemoScenario } from "./pdf-agent/demo";
import { createPdfAgentClientTools } from "./pdf-agent/tools";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { buildPdfAgentBundle } from "./manifests";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { useDemoScenario } from "./shared/useDemoScenario";
import { MetaText } from "../app/styles";
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

export const pdfAgentCapability: CapabilityDefinition = {
  id: "pdf-agent",
  path: "/capabilities/pdf-agent",
  navLabel: "PDF Agent",
  title: "PDF Agent",
  eyebrow: "Capability",
  description: "Bounded PDF extraction and decomposition workspace.",
  tabs: [
    { id: "agent", label: "Agent" },
    { id: "demo", label: "Demo" },
  ],
};

export function PdfAgentPage({
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
    capabilityId: pdfAgentCapability.id,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "agent",
    allowedTabs: ["agent", "demo"],
  });
  const capabilityBundle = useMemo(() => buildPdfAgentBundle(), []);
  const clientTools = useMemo(() => createPdfAgentClientTools({ files }), [files]);
  const {
    scenario: demoScenario,
    loading: demoLoading,
    error: demoError,
  } = useDemoScenario({
    active: activeWorkspaceTab === "demo",
    buildDemoScenario: buildPdfAgentDemoScenario,
    setFiles,
    setStatus,
    setReportEffects,
  });

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: pdfAgentCapability.id,
      title: "Files",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      files,
      accept: ".pdf",
      onSelectFiles: handleFiles,
      onClearFiles: handleClearFiles,
      onRemoveFile: handleRemoveFile,
    });
  }, [files, handleClearFiles, handleFiles, handleRemoveFile, onRegisterWorkspace]);

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
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={(nextEffects) => setReportEffects((current) => [...nextEffects, ...current].slice(0, 8))}
              onFilesAdded={appendFiles}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
            <CapabilityPanel>
              <CapabilitySectionHeader>
                <CapabilitySectionTitle>Demo workspace</CapabilitySectionTitle>
                <CapabilityMetaText>
                  {demoLoading ? "Preparing the PDF demo." : demoError ?? status}
                </CapabilityMetaText>
              </CapabilitySectionHeader>
              <MetaText>
                Files: {files.length ? files.map((file) => `${file.name} (${file.kind})`).join(", ") : "loading demo files"}
              </MetaText>
              <MetaText>Demo: {demoScenario?.title ?? "Preparing scenario"}</MetaText>
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
            <CapabilityDemoPane
              scenario={demoScenario}
              loading={demoLoading}
              error={demoError}
              capabilityBundle={capabilityBundle}
              files={files}
              clientTools={clientTools}
              onEffects={(nextEffects) => setReportEffects((current) => [...nextEffects, ...current].slice(0, 8))}
              onFilesAdded={appendFiles}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}
    </>
  );
}
