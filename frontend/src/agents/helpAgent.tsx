import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type UIEvent,
} from "react";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import { useAppState } from "../app/context";
import { useAgentShell } from "../app/workspace";
import { ChatKitPane } from "../components/ChatKitPane";
import { AgentPreviewPane } from "../components/AgentPreviewPane";
import {
  buildAgentBundleForRoot,
  bindClientToolsForAgentBundle,
} from "./runtime-registry";
import { helpAgentDefinition, runtimeAgentDefinitions } from "./definitions";
import { AgentPage } from "./styles";
import type { AgentRuntimeContext } from "./types";
import type { AgentResourceRecord } from "../types/shell";

const HELP_STARTER_PROMPTS = [
  {
    label: "What can this workspace do?",
    prompt:
      "Explain the available agent flows in this workspace and when I should use each one.",
    icon: "document" as const,
  },
  {
    label: "Guide me to the right surface",
    prompt:
      "Compare the available workspace surfaces and recommend the best one for my current task.",
    icon: "bolt" as const,
  },
  {
    label: "Review current outputs",
    prompt:
      "Review the visible exports in this workspace, explain what each is for, and suggest the best next step.",
    icon: "chart" as const,
  },
] as const;

const HELP_WORKSPACE_PANES = [
  { id: "browser", label: "Browser" },
  { id: "chat", label: "Chat" },
  { id: "outputs", label: "Preview" },
] as const;

const DEFAULT_HELP_PANE_ID = "browser";
const MOBILE_HELP_LAYOUT_BREAKPOINT = 980;

const SELECTABLE_AGENT_IDS = runtimeAgentDefinitions
  .filter((agent) => !["feedback-agent"].includes(agent.id))
  .map((agent) => agent.id);

type HelpWorkspacePaneId = (typeof HELP_WORKSPACE_PANES)[number]["id"];

function isHelpWorkspacePaneId(value: string | null | undefined): value is HelpWorkspacePaneId {
  return HELP_WORKSPACE_PANES.some((pane) => pane.id === value);
}

function normalizeHelpWorkspacePaneId(
  value: string | null | undefined,
): HelpWorkspacePaneId {
  if (value === "overview") {
    return "browser";
  }
  return isHelpWorkspacePaneId(value) ? value : DEFAULT_HELP_PANE_ID;
}

function summarizeBrowserResource(resource: AgentResourceRecord): string {
  if (resource.summary) {
    return resource.summary;
  }
  if (resource.payload.type === "report") {
    return resource.payload.report.slides.length === 1
      ? "1 slide"
      : `${resource.payload.report.slides.length} slides`;
  }
  if (resource.payload.type === "dataset") {
    return `${resource.payload.file.row_count} rows`;
  }
  if (resource.payload.type === "document" && resource.payload.file.kind === "pdf") {
    return `${resource.payload.file.page_count} pages`;
  }
  if (resource.payload.type === "image") {
    return `${resource.payload.file.width} x ${resource.payload.file.height}`;
  }
  return resource.kind;
}

function useIsMobileHelpLayout() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_HELP_LAYOUT_BREAKPOINT : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncViewport = () => {
      setIsMobile(window.innerWidth <= MOBILE_HELP_LAYOUT_BREAKPOINT);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  return isMobile;
}

function WorkspaceBrowserPanel({
  currentWorkspaceId,
  onClear,
  onSelectResource,
  onSelectWorkspace,
  onUpload,
  resources,
  selectedResourceId,
}: {
  currentWorkspaceId: string;
  onClear: () => void;
  onSelectResource: (resource: AgentResourceRecord) => void;
  onSelectWorkspace: (agentId: string) => void;
  onUpload: () => void;
  resources: AgentResourceRecord[];
  selectedResourceId: string | null;
}) {
  const [filterQuery, setFilterQuery] = useState("");
  const normalizedQuery = filterQuery.trim().toLowerCase();
  const agentDefinitionsById = useMemo(
    () =>
      new Map(
        runtimeAgentDefinitions.map((agentDefinition) => [
          agentDefinition.id,
          agentDefinition,
        ]),
      ),
    [],
  );
  const filteredResources = useMemo(
    () =>
      resources.filter((resource) => {
        if (!normalizedQuery) {
          return true;
        }
        const haystack = [
          resource.title,
          resource.summary ?? "",
          resource.kind,
          agentDefinitionsById.get(resource.owner_agent_id)?.title ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    [agentDefinitionsById, normalizedQuery, resources],
  );
  const resourceGroups = useMemo(
    () =>
      SELECTABLE_AGENT_IDS.map((agentId) => {
        const agentDefinition =
          agentDefinitionsById.get(agentId) ?? helpAgentDefinition;
        const resourcesForAgent = filteredResources.filter(
          (resource) => resource.owner_agent_id === agentId,
        );
        return {
          agentDefinition,
          matchesAgentQuery: !normalizedQuery
            ? true
            : [agentDefinition.title, agentDefinition.description ?? ""]
                .join(" ")
                .toLowerCase()
                .includes(normalizedQuery),
          resources: resourcesForAgent,
        };
      }).filter(
        ({ agentDefinition, matchesAgentQuery, resources: resourcesForAgent }) =>
          !normalizedQuery ||
          matchesAgentQuery ||
          resourcesForAgent.length > 0 ||
          agentDefinition.id === currentWorkspaceId,
      ),
    [
      agentDefinitionsById,
      currentWorkspaceId,
      filteredResources,
      normalizedQuery,
    ],
  );
  const currentWorkspaceLabel =
    agentDefinitionsById.get(currentWorkspaceId)?.title ?? currentWorkspaceId;

  return (
    <OverviewPanel data-testid="help-workspace-overview">
      <OverviewHeader>
        <div>
          <OverviewTitle>Workspace browser</OverviewTitle>
          <OverviewDescription>Current workspace: {currentWorkspaceLabel}</OverviewDescription>
        </div>
        <OverviewActionRow>
          <OverviewActionButton onClick={onUpload} type="button">
            Upload
          </OverviewActionButton>
          <OverviewActionButton onClick={onClear} type="button">
            Clear
          </OverviewActionButton>
        </OverviewActionRow>
      </OverviewHeader>

      <FilterPanel>
        <FilterInput
          aria-label="Filter artifacts"
          data-testid="help-workspace-filter-input"
          onChange={(event) => setFilterQuery(event.target.value)}
          placeholder="Filter artifacts"
          type="search"
          value={filterQuery}
        />
      </FilterPanel>

      <TreePanel data-testid="help-workspace-tree">
        {resourceGroups.length ? (
          resourceGroups.map(({ agentDefinition, resources: resourcesForAgent }) => (
            <TreeGroup key={agentDefinition.id}>
              <TreeGroupHeader
                $active={agentDefinition.id === currentWorkspaceId}
                onClick={() => onSelectWorkspace(agentDefinition.id)}
                type="button"
              >
                <span>{agentDefinition.title}</span>
                <TreeGroupMeta>
                  {agentDefinition.id === currentWorkspaceId
                    ? `Current${resourcesForAgent.length ? ` · ${resourcesForAgent.length}` : ""}`
                    : `${resourcesForAgent.length} artifact${resourcesForAgent.length === 1 ? "" : "s"}`}
                </TreeGroupMeta>
              </TreeGroupHeader>
              {resourcesForAgent.length ? (
                <TreeGroupChildren>
                  {resourcesForAgent.map((resource) => (
                    <TreeLeafButton
                      key={resource.id}
                      $active={resource.id === selectedResourceId}
                      data-testid={`help-workspace-resource-${resource.id}`}
                      onClick={() => onSelectResource(resource)}
                      type="button"
                    >
                      <TreeLeafMeta>{resource.kind}</TreeLeafMeta>
                      <strong>{resource.title}</strong>
                      <span>{summarizeBrowserResource(resource)}</span>
                    </TreeLeafButton>
                  ))}
                </TreeGroupChildren>
              ) : agentDefinition.id === currentWorkspaceId ? (
                <EmptyTreeNote>No artifacts yet.</EmptyTreeNote>
              ) : null}
            </TreeGroup>
          ))
        ) : (
          <EmptyTreeState>No artifacts match the current filter.</EmptyTreeState>
        )}
      </TreePanel>
    </OverviewPanel>
  );
}

export function HelpAgentPage() {
  const { user } = useAppState();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobilePagerRef = useRef<HTMLDivElement | null>(null);
  const isMobileLayout = useIsMobileHelpLayout();
  const {
    hydrated,
    selectedAgentId,
    selectedAgentDefinition,
    selectedAgentState,
    selectedAgentResources,
    selectedAgentFiles,
    selectedAgentPreview,
    sharedResources,
    shellStateMetadata,
    selectAgent,
    getAgentState,
    updateAgentState,
    replaceAgentResources,
    clearSelectedAgentState,
    handleSelectFiles,
    resolveResource,
    getPreviewResources,
  } = useAgentShell();
  const [selectedPreviewResourceId, setSelectedPreviewResourceId] = useState<string | null>(
    selectedAgentPreview.items[0]?.resource_id ?? null,
  );

  const activeAgent = selectedAgentDefinition ?? helpAgentDefinition;
  const activePaneId = normalizeHelpWorkspacePaneId(selectedAgentState.active_tab);

  const runtimeContext = useMemo<AgentRuntimeContext>(
    () => ({
      activeAgentId: selectedAgentId,
      getAgentState: (agentId) => getAgentState(agentId ?? selectedAgentId),
      updateAgentState: (agentId, updater) =>
        updateAgentState(agentId ?? selectedAgentId, updater),
      replaceAgentResources: (agentId, resources) =>
        replaceAgentResources(agentId ?? selectedAgentId, resources),
      listAgentResources: (agentId) => getPreviewResources(agentId ?? selectedAgentId),
      listSharedResources: () => sharedResources,
      resolveResource,
      selectAgent,
    }),
    [
      getAgentState,
      getPreviewResources,
      replaceAgentResources,
      resolveResource,
      selectAgent,
      selectedAgentId,
      sharedResources,
      updateAgentState,
    ],
  );

  const agentBundle = useMemo(
    () => buildAgentBundleForRoot(selectedAgentId, runtimeContext),
    [runtimeContext, selectedAgentId],
  );
  const clientTools = useMemo(
    () => bindClientToolsForAgentBundle(agentBundle, runtimeContext),
    [agentBundle, runtimeContext],
  );

  const persistActivePane = useCallback(
    (paneId: HelpWorkspacePaneId) => {
      updateAgentState(selectedAgentId, (state) =>
        state.active_tab === paneId
          ? state
          : {
              ...state,
              active_tab: paneId,
            },
      );
    },
    [selectedAgentId, updateAgentState],
  );

  const scrollMobilePaneIntoView = useCallback(
    (paneId: HelpWorkspacePaneId, behavior: ScrollBehavior = "smooth") => {
      const pager = mobilePagerRef.current;
      if (!pager) {
        return;
      }
      const paneIndex = HELP_WORKSPACE_PANES.findIndex((pane) => pane.id === paneId);
      if (paneIndex < 0) {
        return;
      }
      pager.scrollTo({
        left: paneIndex * pager.clientWidth,
        behavior,
      });
    },
    [],
  );

  useEffect(() => {
    if (selectedAgentState.active_tab === activePaneId) {
      return;
    }
    persistActivePane(activePaneId);
  }, [activePaneId, persistActivePane, selectedAgentState.active_tab]);

  useEffect(() => {
    setSelectedPreviewResourceId((current) =>
      current && selectedAgentPreview.items.some((item) => item.resource_id === current)
        ? current
        : selectedAgentPreview.items[0]?.resource_id ?? null,
    );
  }, [selectedAgentPreview]);

  useEffect(() => {
    if (!isMobileLayout || typeof window === "undefined") {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollMobilePaneIntoView(activePaneId, "auto");
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activePaneId, isMobileLayout, scrollMobilePaneIntoView]);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      await handleSelectFiles(selectedAgentId, event.target.files);
      event.target.value = "";
    },
    [handleSelectFiles, selectedAgentId],
  );

  const handlePaneChange = useCallback(
    (paneId: HelpWorkspacePaneId) => {
      persistActivePane(paneId);
      if (isMobileLayout) {
        scrollMobilePaneIntoView(paneId);
      }
    },
    [isMobileLayout, persistActivePane, scrollMobilePaneIntoView],
  );

  const handleMobilePagerScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const pager = event.currentTarget;
      const nextIndex = Math.round(pager.scrollLeft / Math.max(pager.clientWidth, 1));
      const nextPane =
        HELP_WORKSPACE_PANES[Math.min(Math.max(nextIndex, 0), HELP_WORKSPACE_PANES.length - 1)];
      if (nextPane && nextPane.id !== activePaneId) {
        persistActivePane(nextPane.id);
      }
    },
    [activePaneId, persistActivePane],
  );

  const handleRunStart = useCallback(() => {
    handlePaneChange("chat");
  }, [handlePaneChange]);

  const handleWorkspaceSelection = useCallback(
    (agentId: string) => {
      selectAgent(agentId);
    },
    [selectAgent],
  );

  const handleResourceSelection = useCallback(
    (resource: AgentResourceRecord) => {
      setSelectedPreviewResourceId(resource.id);
      if (selectedAgentId !== resource.owner_agent_id) {
        selectAgent(resource.owner_agent_id);
      }
      handlePaneChange("outputs");
    },
    [handlePaneChange, selectAgent, selectedAgentId],
  );

  if (!user) {
    return null;
  }

  const browserPane = (
    <WorkspaceBrowserPanel
      currentWorkspaceId={selectedAgentId}
      onClear={() => clearSelectedAgentState()}
      onSelectResource={handleResourceSelection}
      onSelectWorkspace={handleWorkspaceSelection}
      onUpload={() => fileInputRef.current?.click()}
      resources={sharedResources}
      selectedResourceId={selectedPreviewResourceId}
    />
  );

  const outputsPane = (
    <AgentPreviewPane
      assetResources={sharedResources}
      previewModel={selectedAgentPreview}
      resources={selectedAgentResources}
      selectedResourceId={selectedPreviewResourceId}
    />
  );

  const chatPane = (
    <ChatKitPane
      agentBundle={agentBundle}
      enabled={hydrated}
      files={selectedAgentFiles}
      shellState={shellStateMetadata}
      investigationBrief={activeAgent.chatkitLead}
      clientTools={clientTools}
      onEffects={() => undefined}
      onSelectAgent={selectAgent}
      onReplaceAgentResources={replaceAgentResources}
      greeting={activeAgent.chatkitLead}
      prompts={selectedAgentId === "help-agent" ? HELP_STARTER_PROMPTS : undefined}
      composerPlaceholder={activeAgent.chatkitPlaceholder}
      colorScheme="light"
      showChatKitHeader={false}
      showComposerTools
      composerToolIds={SELECTABLE_AGENT_IDS}
      surfaceMinHeight={560}
      onRunStart={handleRunStart}
    />
  );

  return (
    <AgentPage>
      <HiddenFileInput
        accept=".csv,.json,.pdf,.png,.jpg,.jpeg,.webp,.md,.txt,.zip"
        multiple
        onChange={(event) => void handleFileChange(event)}
        ref={fileInputRef}
        type="file"
      />

      {isMobileLayout ? (
        <>
          <MobilePaneTabs data-testid="help-workspace-mobile-tabs">
            {HELP_WORKSPACE_PANES.map((pane) => (
              <MobilePaneTabButton
                key={pane.id}
                $active={pane.id === activePaneId}
                aria-pressed={pane.id === activePaneId}
                data-testid={`help-workspace-mobile-tab-${pane.id}`}
                onClick={() => handlePaneChange(pane.id)}
                type="button"
              >
                {pane.label}
              </MobilePaneTabButton>
            ))}
          </MobilePaneTabs>

          <MobilePanePager
            data-testid="help-workspace-mobile-pager"
            onScroll={handleMobilePagerScroll}
            ref={mobilePagerRef}
          >
            <MobilePane data-testid="help-workspace-pane-browser">
              {browserPane}
            </MobilePane>
            <MobilePane data-testid="help-workspace-pane-chat">
              {chatPane}
            </MobilePane>
            <MobilePane data-testid="help-workspace-pane-outputs">
              {outputsPane}
            </MobilePane>
          </MobilePanePager>
        </>
      ) : (
        <DesktopShellLayout>
          <DesktopOverviewColumn>{browserPane}</DesktopOverviewColumn>

          <DesktopMainStage>
            <DesktopOutputsColumn>{outputsPane}</DesktopOutputsColumn>
            <DesktopChatColumn>{chatPane}</DesktopChatColumn>
          </DesktopMainStage>
        </DesktopShellLayout>
      )}
    </AgentPage>
  );
}

const HiddenFileInput = styled.input`
  display: none;
`;

const DesktopShellLayout = styled.section`
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(220px, 248px) minmax(0, 1fr);
  gap: 0.72rem;
  align-items: stretch;

  @media (max-width: 1320px) {
    grid-template-columns: 1fr;
    height: auto;
  }
`;

const DesktopOverviewColumn = styled.div`
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  position: sticky;
  top: 0;

  @media (max-width: 1320px) {
    position: static;
  }
`;

const DesktopMainStage = styled.section`
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.62fr) minmax(320px, 0.72fr);
  grid-template-areas: "outputs chat";
  gap: 0.72rem;
  align-items: stretch;

  @media (max-width: 1320px) {
    grid-template-columns: 1fr;
    grid-template-areas:
      "chat"
      "outputs";
  }
`;

const DesktopOutputsColumn = styled.div`
  grid-area: outputs;
  min-width: 0;
  min-height: 0;
`;

const DesktopChatColumn = styled.div`
  grid-area: chat;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const OverviewPanel = styled.section`
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 0.62rem;
  padding: 0.82rem;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(31, 41, 55, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(248, 242, 235, 0.88)),
    rgba(255, 255, 255, 0.8);
  box-shadow: 0 18px 44px rgba(32, 26, 20, 0.08);
`;

const OverviewHeader = styled.div`
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 0.55rem;
`;

const OverviewTitle = styled.h2`
  margin: 0;
  font-size: 0.98rem;
  line-height: 1.08;
  color: var(--ink);
`;

const OverviewDescription = styled.p`
  margin: 0;
  color: var(--muted);
  font-size: 0.73rem;
  line-height: 1.35;
`;

const OverviewActionRow = styled.div`
  display: flex;
  gap: 0.38rem;
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const OverviewActionButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.08);
  border-radius: 999px;
  padding: 0.44rem 0.74rem;
  background: rgba(255, 255, 255, 0.82);
  color: var(--ink);
  font: inherit;
  font-size: 0.74rem;
  font-weight: 700;
  cursor: pointer;
`;

const FilterPanel = styled.div`
  min-width: 0;
`;

const FilterInput = styled.input`
  width: 100%;
  border-radius: 14px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.84);
  color: var(--ink);
  padding: 0.62rem 0.72rem;
  font: inherit;
  font-size: 0.78rem;

  &::placeholder {
    color: color-mix(in srgb, var(--muted) 76%, white 24%);
  }
`;

const TreePanel = styled.div`
  min-height: 0;
  height: 100%;
  display: grid;
  align-content: start;
  gap: 0.62rem;
  overflow: auto;
  padding-right: 0.12rem;
`;

const TreeGroup = styled.section`
  display: grid;
  gap: 0.28rem;
`;

const TreeGroupHeader = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.62rem;
  border-radius: 14px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? "color-mix(in srgb, var(--accent) 34%, rgba(31, 41, 55, 0.08))"
        : "rgba(31, 41, 55, 0.08)"};
  background: ${({ $active }) =>
    $active
      ? "color-mix(in srgb, var(--accent) 8%, white 92%)"
      : "rgba(255, 255, 255, 0.52)"};
  color: var(--ink);
  cursor: pointer;
  font: inherit;

  span {
    font-size: 0.77rem;
    font-weight: 800;
    line-height: 1.2;
  }
`;

const TreeGroupMeta = styled.div`
  color: var(--muted);
  font-size: 0.66rem;
  line-height: 1.25;
  white-space: nowrap;
`;

const TreeGroupChildren = styled.div`
  display: grid;
  gap: 0.26rem;
  padding-left: 0.72rem;
  border-left: 1px solid rgba(31, 41, 55, 0.08);
  margin-left: 0.46rem;
`;

const TreeLeafButton = styled.button<{ $active: boolean }>`
  display: grid;
  gap: 0.14rem;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.58rem;
  border-radius: 12px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? "color-mix(in srgb, var(--accent) 36%, rgba(31, 41, 55, 0.08))"
        : "rgba(31, 41, 55, 0.08)"};
  background: ${({ $active }) =>
    $active
      ? "rgba(255, 248, 242, 0.96)"
      : "rgba(255, 255, 255, 0.74)"};
  cursor: pointer;
  font: inherit;

  strong {
    font-size: 0.74rem;
    line-height: 1.2;
    color: var(--ink);
  }

  span {
    font-size: 0.66rem;
    line-height: 1.32;
    color: var(--muted);
  }
`;

const TreeLeafMeta = styled.div`
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const EmptyTreeNote = styled(MetaText)`
  padding-left: 0.72rem;
  font-size: 0.72rem;
`;

const EmptyTreeState = styled(MetaText)`
  padding: 0.2rem 0;
  font-size: 0.76rem;
`;

const MobilePaneTabs = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.12rem;
  width: fit-content;
  padding: 0.16rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.58);
`;

const MobilePaneTabButton = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: 999px;
  padding: 0.42rem 0.8rem;
  background: ${({ $active }) => ($active ? "var(--ink)" : "transparent")};
  color: ${({ $active }) => ($active ? "#fffaf4" : "var(--muted)")};
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
`;

const MobilePanePager = styled.section`
  min-height: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 100%;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const MobilePane = styled.section`
  min-width: 0;
  min-height: 0;
  scroll-snap-align: start;
`;
