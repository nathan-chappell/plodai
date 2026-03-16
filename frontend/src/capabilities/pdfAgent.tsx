import { useMemo } from "react";

import { AuthPanel } from "../components/AuthPanel";
import { ChatKitPane } from "../components/ChatKitPane";
import { WorkspaceInventoryPane } from "../components/WorkspaceInventoryPane";
import { buildPdfAgentManifest } from "./manifests";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { createWorkspaceClientTools } from "../lib/file-agent-tools";
import { MetaText } from "../app/styles";
import type { CapabilityDefinition } from "./types";
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
  ReportWorkspaceColumn,
  ReportWorkspaceLayout,
} from "./styles";

type PdfAgentTab = "agent" | "files" | "goal";

const DEFAULT_STATUS = "Load PDF files to start carving bounded page ranges.";
const DEFAULT_BRIEF =
  "Inspect the available PDFs, keep page selections bounded, and extract the smallest useful sub-documents.";

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
          The current PDF tool is intentionally narrow: inspect inventory first, then extract inclusive page ranges that can be reasoned about safely.
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
    { id: "files", label: "Files" },
    { id: "goal", label: "Goal" },
  ],
};

export function PdfAgentPage() {
  const {
    files,
    appendFiles,
    status,
    investigationBrief,
    setInvestigationBrief,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    reportEffects,
    setReportEffects,
    handleFiles,
    handleClearFiles,
  } = useCapabilityFileWorkspace({
    capabilityId: pdfAgentCapability.id,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "agent",
  });
  const capabilityManifest = useMemo(() => buildPdfAgentManifest(), []);
  const clientTools = useMemo(
    () => createWorkspaceClientTools(files, { includeCsvTools: false, includePdfRange: true }),
    [files],
  );

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
              {reportEffects.length ? <MetaText>Client effects captured this session: {reportEffects.length}</MetaText> : null}
            </CapabilityPanel>
          </ReportWorkspaceColumn>
          <ReportChatColumn>
            <ChatKitPane
              capabilityManifest={capabilityManifest}
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

      {activeWorkspaceTab === "files" ? (
        <WorkspaceInventoryPane files={files} accept=".pdf" onSelectFiles={handleFiles} onClearFiles={handleClearFiles} />
      ) : null}

      {activeWorkspaceTab === "goal" ? (
        <GoalPanel investigationBrief={investigationBrief} setInvestigationBrief={setInvestigationBrief} />
      ) : null}
    </>
  );
}
