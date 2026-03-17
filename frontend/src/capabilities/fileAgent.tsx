import { useEffect, useMemo } from "react";

import { AuthPanel } from "../components/AuthPanel";
import { ChatKitPane } from "../components/ChatKitPane";
import { buildFileAgentManifest } from "./manifests";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { createWorkspaceClientTools } from "../lib/file-agent-tools";
import { MetaText } from "../app/styles";
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
  ReportWorkspaceColumn,
  ReportWorkspaceLayout,
} from "./styles";

type FileAgentTab = "agent" | "goal";

const DEFAULT_STATUS = "Load CSV or PDF files to start using the file agent.";
const DEFAULT_BRIEF =
  "Inspect the available files, use safe transformations, and create derived artifacts when they make the workspace more useful.";

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
        <CapabilityMetaText>This brief is saved with the conversation so the file agent keeps the current objective in view.</CapabilityMetaText>
      </CapabilitySectionHeader>
      <CapabilityTextarea
        value={investigationBrief}
        onChange={(event) => setInvestigationBrief(event.target.value)}
        placeholder="Example: Filter the sales dataset into a narrower CSV and extract the appendix pages from the attached PDF."
      />
      <CapabilityHighlight>
        <CapabilityMetaText>
          This workspace is meant for file operations first: inspect inventories, query CSVs, create derived CSVs, and carve bounded PDF ranges.
        </CapabilityMetaText>
      </CapabilityHighlight>
    </CapabilityPanel>
  );
}

export const fileAgentCapability: CapabilityDefinition = {
  id: "file-agent",
  path: "/capabilities/file-agent",
  navLabel: "File Agent",
  title: "File Agent",
  eyebrow: "Capability",
  description: "Structured file operations across CSV and PDF inputs.",
  tabs: [
    { id: "agent", label: "Agent" },
    { id: "goal", label: "Goal" },
  ],
};

export function FileAgentPage({
  onRegisterWorkspace,
}: {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
}) {
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
    handleRemoveFile,
  } = useCapabilityFileWorkspace({
    capabilityId: fileAgentCapability.id,
    defaultStatus: DEFAULT_STATUS,
    defaultBrief: DEFAULT_BRIEF,
    defaultTab: "agent",
    allowedTabs: ["agent", "goal"],
  });
  const capabilityManifest = useMemo(() => buildFileAgentManifest(), []);
  const clientTools = useMemo(
    () => createWorkspaceClientTools(files, { includeCsvCreation: true, includePdfRange: true }),
    [files],
  );

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: fileAgentCapability.id,
      title: "Files",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      files,
      onSelectFiles: handleFiles,
      onClearFiles: handleClearFiles,
      onRemoveFile: handleRemoveFile,
    });
  }, [files, handleClearFiles, handleFiles, handleRemoveFile, onRegisterWorkspace]);

  return (
    <>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{fileAgentCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{fileAgentCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            Work directly with local files: inspect the inventory, query CSVs safely, and create derived CSV or PDF artifacts.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" />
      </CapabilityHeroRow>

      <CapabilityTabBar>
        {fileAgentCapability.tabs.map((tab) => (
          <CapabilityTabButton
            key={tab.id}
            $active={activeWorkspaceTab === tab.id}
            onClick={() => setActiveWorkspaceTab(tab.id as FileAgentTab)}
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
                Goal: {investigationBrief.trim() || "No goal set yet. Open the Goal tab to define the current file operation."}
              </MetaText>
              <MetaText>
                Manage files from the sidebar workspace panel whenever you need to add or remove inputs.
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

      {activeWorkspaceTab === "goal" ? (
        <GoalPanel investigationBrief={investigationBrief} setInvestigationBrief={setInvestigationBrief} />
      ) : null}
    </>
  );
}
