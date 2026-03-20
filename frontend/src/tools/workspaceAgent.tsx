import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { sectionPanelCss } from "../app/styles";
import { useAppState } from "../app/context";
import { AuthPanel } from "../components/AuthPanel";
import type { ActiveToolInvocation, ChatKitQuickAction } from "../components/ChatKitPane";
import { ChatKitPane } from "../components/ChatKitPane";
import { LatestArtifactPreviewPane } from "../components/LatestArtifactPreviewPane";
import { WorkspaceReportDrawer } from "../components/WorkspaceReportDrawer";
import {
  bindClientToolsForBundle,
  buildCapabilityBundleForRoot,
  listCapabilityBundleToolNames,
} from "./runtime-registry";
import { SIDEBAR_WORKSPACE_DESCRIPTION } from "./constants";
import { workspaceAgentCapability } from "./definitions";
import { useCapabilityFileWorkspace } from "./fileWorkspace";
import type {
  CapabilityDemoScenario,
  ShellWorkspaceRegistration,
} from "./types";
import { buildWorkspaceAgentDemoScenario } from "./workspace-agent/demo";
import {
  CapabilityEyebrow,
  CapabilityHeader,
  CapabilityHeroRow,
  CapabilityPage,
  CapabilitySubhead,
  CapabilityTitle,
  ReportChatColumn,
  ReportWorkspaceLayout,
} from "./styles";

function demoNotesBullets(
  scenario: CapabilityDemoScenario | null,
): string[] {
  if (!scenario) {
    return [];
  }
  return [...(scenario.expectedOutcomes ?? []), ...(scenario.notes ?? [])]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function latestArtifactId(artifacts: { entryId: string; createdAt: string }[]): string | null {
  return [...artifacts]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .at(0)?.entryId ?? null;
}

export function WorkspaceAgentPage({
  onRegisterWorkspace,
}: {
  onRegisterWorkspace?: (registration: ShellWorkspaceRegistration | null) => void;
}) {
  const { user } = useAppState();
  if (!user) {
    return null;
  }

  const {
    entries,
    files,
    setFiles,
    appendFiles,
    artifacts,
    smartSplitBundles,
    setStatus,
    investigationBrief,
    setReportEffects,
    handleFiles,
    handleRemoveEntry,
    workspaceContext,
    workspaceHydrated,
    getState,
    updateFilesystem,
    syncToolCatalog,
    appendReportEffects,
    currentReport,
    workspaceStateMetadata,
    workspaces,
    selectedWorkspaceId,
    selectedWorkspaceName,
    selectedWorkspaceKind,
    selectWorkspace,
    createWorkspace,
    clearWorkspace,
  } = useCapabilityFileWorkspace({
    capabilityId: workspaceAgentCapability.id,
    capabilityTitle: workspaceAgentCapability.title,
    defaultStatus: "Add files or run the demo to start working in the unified workspace.",
    defaultBrief: "Investigate local files, route work to the right specialist, and keep the newest useful output in view.",
    defaultTab: "workspace",
    allowedTabs: ["workspace"],
  });

  const capabilityWorkspace = useMemo(
    () => ({
      capabilityId: workspaceAgentCapability.id,
      capabilityTitle: workspaceAgentCapability.title,
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
    () => buildCapabilityBundleForRoot(workspaceAgentCapability.id, capabilityWorkspace),
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
  const [demoScenario, setDemoScenario] = useState<CapabilityDemoScenario | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [activeToolActivity, setActiveToolActivity] = useState<ActiveToolInvocation | null>(null);
  const [pendingAnchorArtifactId, setPendingAnchorArtifactId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceHydrated) {
      return;
    }
    let cancelled = false;
    setDemoLoading(true);
    setDemoError(null);

    void Promise.resolve(buildWorkspaceAgentDemoScenario())
      .then((scenario) => {
        if (cancelled) {
          return;
        }
        setDemoScenario(scenario);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setDemoError(
          error instanceof Error
            ? error.message
            : "Unable to prepare the workspace demo.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setDemoLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceHydrated]);

  useEffect(() => {
    syncToolCatalog(clientToolCatalogKey ? clientToolCatalogKey.split("|") : []);
  }, [clientToolCatalogKey, syncToolCatalog]);

  useEffect(() => {
    onRegisterWorkspace?.({
      capabilityId: workspaceAgentCapability.id,
      title: "Workspace files",
      description: SIDEBAR_WORKSPACE_DESCRIPTION,
      artifacts,
      smartSplitBundles,
      workspaces,
      activeWorkspaceId: selectedWorkspaceId,
      activeWorkspaceName: selectedWorkspaceName,
      activeWorkspaceKind: selectedWorkspaceKind,
      accept: ".csv,.json,.pdf",
      onSelectFiles: handleFiles,
      onSelectWorkspace: selectWorkspace,
      onCreateWorkspace: createWorkspace,
      onClearWorkspace: clearWorkspace,
      clearActionLabel: "Clear workspace",
      onRemoveArtifact: handleRemoveEntry,
    });
  }, [
    artifacts,
    clearWorkspace,
    createWorkspace,
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

  const ensureDemoScenario = useCallback(async () => {
    if (demoScenario) {
      return demoScenario;
    }
    const scenario = await buildWorkspaceAgentDemoScenario();
    setDemoScenario(scenario);
    return scenario;
  }, [demoScenario]);

  const quickActions: ChatKitQuickAction[] | undefined = demoScenario || demoLoading || demoError === null
    ? [
        {
          label: "Run demo",
          prompt: demoScenario?.initialPrompt ?? "Run the workspace demo.",
          model: demoScenario?.model,
          beforeRun: async () => {
            const scenario = await ensureDemoScenario();
            setFiles(scenario.workspaceSeed);
            setReportEffects([]);
            setStatus(`Loaded demo files for ${scenario.title}.`);
          },
        },
      ]
    : undefined;

  const handleToolActivity = useCallback((activity: ActiveToolInvocation | null) => {
    if (activity) {
      setPendingAnchorArtifactId(latestArtifactId(artifacts));
      setActiveToolActivity(activity);
      return;
    }
    setActiveToolActivity(null);
    setPendingAnchorArtifactId(null);
  }, [artifacts]);

  const notes = demoNotesBullets(demoScenario);

  return (
    <CapabilityPage>
      <CapabilityHeroRow>
        <CapabilityHeader>
          <CapabilityEyebrow>{workspaceAgentCapability.eyebrow}</CapabilityEyebrow>
          <CapabilityTitle>{workspaceAgentCapability.title}</CapabilityTitle>
          <CapabilitySubhead>
            One shared chat workspace for CSV analysis, chart rendering, PDF decomposition, and compact reporting.
          </CapabilitySubhead>
        </CapabilityHeader>
        <AuthPanel mode="account" heading="Account" blendWithShell />
      </CapabilityHeroRow>

      <ReportWorkspaceLayout>
        <WorkspaceMainColumn>
          <WorkspacePreviewStage>
            <LatestArtifactPreviewPane
              artifacts={artifacts}
              smartSplitBundles={smartSplitBundles}
              pendingToolActivity={activeToolActivity}
              pendingAnchorArtifactId={pendingAnchorArtifactId}
              emptyMessage="The latest uploaded or created file will appear here."
              dataTestId="workspace-latest-preview"
            />
          </WorkspacePreviewStage>
          <WorkspaceReportDrawer
            currentReport={currentReport}
            dataTestId="workspace-report-drawer"
          />
        </WorkspaceMainColumn>

        <WorkspaceRail>
          {notes.length ? (
            <WorkspaceNotesCard data-testid="workspace-demo-notes">
              <WorkspaceNotesTitle>Demo notes</WorkspaceNotesTitle>
              <WorkspaceNotesList>
                {notes.map((note) => (
                  <WorkspaceNotesItem key={note}>{note}</WorkspaceNotesItem>
                ))}
              </WorkspaceNotesList>
            </WorkspaceNotesCard>
          ) : null}
          {demoError ? <WorkspaceMeta>{demoError}</WorkspaceMeta> : null}
          <WorkspaceChatPane>
            <ChatKitPane
              capabilityBundle={capabilityBundle}
              enabled
              files={files}
              workspaceState={workspaceStateMetadata}
              investigationBrief={investigationBrief}
              clientTools={clientTools}
              onEffects={appendReportEffects}
              onFilesAdded={appendFiles}
              greeting={workspaceAgentCapability.chatkitLead}
              composerPlaceholder={workspaceAgentCapability.chatkitPlaceholder}
              quickActions={quickActions}
              colorScheme="light"
              showChatKitHeader={false}
              surfaceMinHeight={760}
              onToolActivity={handleToolActivity}
            />
          </WorkspaceChatPane>
        </WorkspaceRail>
      </ReportWorkspaceLayout>
    </CapabilityPage>
  );
}

const WorkspaceMainColumn = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  gap: 0.72rem;
  grid-template-rows: minmax(0, 1fr) auto;

  @media (min-width: 1181px) {
    overflow: hidden;
  }

  @media (max-width: 1180px) {
    grid-template-rows: auto auto;
  }
`;

const WorkspacePreviewStage = styled.div`
  min-width: 0;
  min-height: 0;
  display: flex;

  > * {
    flex: 1 1 auto;
    min-height: 0;
  }

  @media (max-width: 1180px) {
    > * {
      min-height: 460px;
    }
  }
`;

const WorkspaceRail = styled.div`
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.72rem;

  @media (min-width: 1181px) {
    overflow: hidden;
  }
`;

const WorkspaceChatPane = styled(ReportChatColumn)`
  flex: 1 1 auto;
`;

const WorkspaceNotesCard = styled.section`
  ${sectionPanelCss("0.88rem", "0.4rem")};
  border-radius: var(--radius-xl);
`;

const WorkspaceNotesTitle = styled.strong`
  color: var(--ink);
  font-size: 0.88rem;
  line-height: 1.15;
`;

const WorkspaceNotesList = styled.ul`
  margin: 0;
  padding-left: 1rem;
  display: grid;
  gap: 0.3rem;
`;

const WorkspaceNotesItem = styled.li`
  color: var(--ink);
  font-size: 0.82rem;
  line-height: 1.45;
`;

const WorkspaceMeta = styled.div`
  color: var(--accent-deep);
  font-size: 0.78rem;
  font-weight: 700;
`;
