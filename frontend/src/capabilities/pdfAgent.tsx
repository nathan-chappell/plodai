import { useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import styled from "styled-components";

import { AuthPanel } from "../components/AuthPanel";
import {
  buildFolderRowsFromArtifacts,
  CapabilityQuickView,
  PdfInlinePreview,
  renderDefaultCapabilityQuickViewPreview,
  type CapabilityQuickViewArtifactRow,
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
import { pdfAgentCapability } from "./definitions";
import { buildPdfAgentDemoScenario } from "./pdf-agent/demo";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import { useDemoScenario } from "./shared/useDemoScenario";
import { MetaText } from "../app/styles";
import type { ClientEffect } from "../types/analysis";
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

function isPdfIndexArtifact(artifact: ShellWorkspaceArtifact): boolean {
  return (
    artifact.path.startsWith("/artifacts/pdf/") &&
    artifact.file.kind === "other" &&
    artifact.file.extension.toLowerCase() === "md" &&
    typeof artifact.file.text_content === "string"
  );
}

function extractMarkdownLinks(markdown: string): string[] {
  return Array.from(markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function smartSplitBundleTitle(artifact: ShellWorkspaceArtifact): string {
  if (artifact.file.kind !== "other" || !artifact.file.text_content) {
    return artifact.file.name.replace(/\.md$/i, "");
  }
  const heading = artifact.file.text_content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || artifact.file.name.replace(/\.md$/i, "");
}

function buildPdfQuickViewGroups(
  artifacts: ShellWorkspaceArtifact[],
): CapabilityQuickViewGroup[] {
  const pdfArtifacts = artifacts.filter((artifact) =>
    artifact.path.startsWith("/artifacts/pdf/"),
  );
  const usedEntryIds = new Set<string>();
  const groups: CapabilityQuickViewGroup[] = [];

  const indexArtifacts = pdfArtifacts
    .filter(isPdfIndexArtifact)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  for (const indexArtifact of indexArtifacts) {
    const referencedNames = new Set(
      extractMarkdownLinks(
        indexArtifact.file.kind === "other" ? indexArtifact.file.text_content ?? "" : "",
      ).map((href) => basename(href)),
    );
    const stem = indexArtifact.file.name.replace(/\.md$/i, "");
    const bundleArtifacts = pdfArtifacts.filter((artifact) => {
      if (artifact.entryId === indexArtifact.entryId) {
        return true;
      }
      if (referencedNames.has(artifact.file.name)) {
        return true;
      }
      return artifact.file.name === `${stem}.zip`;
    });

    bundleArtifacts.forEach((artifact) => usedEntryIds.add(artifact.entryId));
    groups.push({
      key: indexArtifact.entryId,
      label: smartSplitBundleTitle(indexArtifact),
      rows: [
        {
          kind: "artifact",
          key: indexArtifact.entryId,
          artifact: indexArtifact,
          label: "index",
          meta: "markdown index",
        },
        ...bundleArtifacts
          .filter((artifact) => artifact.entryId !== indexArtifact.entryId)
          .sort((left, right) => left.file.name.localeCompare(right.file.name))
          .map(
            (artifact): CapabilityQuickViewArtifactRow => ({
              kind: "artifact",
              key: artifact.entryId,
              artifact,
              depth: 1,
            }),
          ),
      ],
    });
  }

  const remainingArtifacts = pdfArtifacts.filter(
    (artifact) => !usedEntryIds.has(artifact.entryId),
  );
  if (remainingArtifacts.length) {
    groups.push({
      key: "other-pdf-artifacts",
      label: "Other PDF artifacts",
      rows: buildFolderRowsFromArtifacts(remainingArtifacts, {
        stripPrefixes: ["/artifacts/pdf/"],
      }),
    });
  }

  return groups;
}

function renderPdfQuickViewPreview(args: CapabilityQuickViewRenderArgs) {
  const { selectedArtifact, artifactRows, selectArtifact } = args;
  if (isPdfIndexArtifact(selectedArtifact)) {
    const markdown =
      selectedArtifact.file.kind === "other"
        ? selectedArtifact.file.text_content ?? ""
        : "";
    return (
      <PdfPreviewSection>
        <PdfPreviewMetaRow>
          <PdfPreviewMetaChip>Smart split index</PdfPreviewMetaChip>
          <PdfPreviewMetaChip>{selectedArtifact.file.name}</PdfPreviewMetaChip>
        </PdfPreviewMetaRow>
        <PdfPreviewMarkdown>
          <ReactMarkdown
            components={{
              a: ({ href, children }) => {
                const target = href
                  ? artifactRows.find(
                      (row) =>
                        row.artifact.file.name === basename(href) ||
                        row.artifact.path.endsWith(`/${basename(href)}`),
                    )
                  : null;
                if (target) {
                  return (
                    <PdfPreviewLinkButton
                      onClick={() => selectArtifact(target.artifact.entryId)}
                      type="button"
                    >
                      {children}
                    </PdfPreviewLinkButton>
                  );
                }
                return (
                  <a href={href} rel="noreferrer" target="_blank">
                    {children}
                  </a>
                );
              },
            }}
          >
            {markdown}
          </ReactMarkdown>
        </PdfPreviewMarkdown>
      </PdfPreviewSection>
    );
  }

  if (selectedArtifact.file.kind === "pdf") {
    return <PdfInlinePreview file={selectedArtifact.file} />;
  }

  return renderDefaultCapabilityQuickViewPreview(args);
}

export function PdfAgentPage({
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
      capabilityId: pdfAgentCapability.id,
      title: "Workspace",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      artifacts,
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
    workspaces,
  ]);

  useEffect(() => {
    syncToolCatalog(clientToolCatalogKey ? clientToolCatalogKey.split("|") : []);
  }, [clientToolCatalogKey, syncToolCatalog]);

  const pdfQuickViewGroups = useMemo(
    () => buildPdfQuickViewGroups(artifacts),
    [artifacts],
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
            <CapabilityQuickView
              title="Smart splits"
              description="Review saved smart split bundles and preview their index or extracted PDFs."
              emptyMessage="Saved smart split bundles will appear here once the PDF agent creates them."
              groups={pdfQuickViewGroups}
              renderPreview={renderPdfQuickViewPreview}
              dataTestId="pdf-agent-quick-view"
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
              greeting={pdfAgentCapability.chatkitLead}
              composerPlaceholder={pdfAgentCapability.chatkitPlaceholder}
            />
          </ReportChatColumn>
        </ReportWorkspaceLayout>
      ) : null}

      {activeWorkspaceTab === "demo" ? (
        <ReportWorkspaceLayout>
          <ReportWorkspaceColumn>
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
    </CapabilityPage>
  );
}

const PdfPreviewSection = styled.div`
  display: grid;
  gap: 0.6rem;
`;

const PdfPreviewMetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
`;

const PdfPreviewMetaChip = styled.div`
  display: inline-flex;
  align-items: center;
  padding: 0.22rem 0.52rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.1);
  background: rgba(255, 255, 255, 0.82);
  font-size: 0.72rem;
  font-weight: 700;
`;

const PdfPreviewMarkdown = styled.div`
  display: grid;
  gap: 0.6rem;
  border-radius: var(--radius-md);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.84);
  padding: 0.8rem 0.9rem;
  line-height: 1.5;

  & > * {
    min-width: 0;
  }

  p,
  ul,
  ol,
  h1,
  h2,
  h3,
  h4 {
    margin: 0;
  }
`;

const PdfPreviewLinkButton = styled.button`
  border: 0;
  background: none;
  color: var(--accent-deep);
  font: inherit;
  font-weight: 700;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
`;
