import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";

import { MetaText } from "../app/styles";
import { useAppState } from "../app/context";
import { useAgentShell } from "../app/workspace";
import { ChatKitPane } from "../components/ChatKitPane";
import { AgentPreviewPane } from "../components/AgentPreviewPane";
import { AuthPanel } from "../components/AuthPanel";
import {
  buildAgentPreviewModel,
  isGeneratedResource,
  isUploadedResource,
  listFileResources,
} from "../lib/shell-resources";
import {
  bindClientToolsForAgentBundle,
  buildAgentBundleForRoot,
} from "./runtime-registry";
import { defaultAgentDefinition, runtimeAgentDefinitions } from "./definitions";
import { AgentPage } from "./styles";
import type { AgentRuntimeContext } from "./types";
import type { AgentResourceRecord, WorkspaceContextRecord } from "../types/shell";
import type {
  ClientEffect,
  TourRequestedEffect,
} from "../types/analysis";
import {
  getDefaultTourScenario,
  loadDefaultTourScenarioDefaultFiles,
} from "./default-agent/tour-catalog";

const DEFAULT_STARTER_PROMPTS = [
  {
    label: "Start report tour",
    prompt: "Start the report tour.",
    icon: "document" as const,
  },
  {
    label: "Start document tour",
    prompt: "Start the document tour.",
    icon: "bolt" as const,
  },
  {
    label: "Help me choose a tour",
    prompt:
      "Open the guided tour picker so I can choose the best guided tour for a first walkthrough. Do not answer in prose first.",
    icon: "chart" as const,
  },
] as const;

const REPORT_STARTER_PROMPTS = [
  {
    label: "Draft a summary",
    prompt: "Turn the current workspace artifacts into a concise executive summary.",
    icon: "document" as const,
  },
  {
    label: "Build a report update",
    prompt: "Create a stakeholder-ready report update backed by the current exports.",
    icon: "bolt" as const,
  },
  {
    label: "Review report outputs",
    prompt: "Review the current report outputs and tell me what is missing or weak.",
    icon: "chart" as const,
  },
] as const;

const ANALYSIS_STARTER_PROMPTS = [
  {
    label: "Summarize datasets",
    prompt: "Summarize the current datasets and suggest the most useful next table to create.",
    icon: "analytics" as const,
  },
  {
    label: "Compare segments",
    prompt: "Compare the main segments in the current data and note the biggest differences.",
    icon: "chart" as const,
  },
  {
    label: "Create a derived table",
    prompt: "Create a reusable derived dataset from the current files.",
    icon: "bolt" as const,
  },
] as const;

const CHART_STARTER_PROMPTS = [
  {
    label: "Suggest a chart",
    prompt: "Suggest the clearest chart for the current data and explain why it fits.",
    icon: "chart" as const,
  },
  {
    label: "Build a chart",
    prompt: "Create a polished chart from the current dataset.",
    icon: "bolt" as const,
  },
  {
    label: "Compare chart options",
    prompt: "Compare two chart options for the current workspace data and recommend one.",
    icon: "analytics" as const,
  },
] as const;

const DOCUMENT_STARTER_PROMPTS = [
  {
    label: "Inspect the PDF",
    prompt: "Inspect the current PDF and summarize its structure.",
    icon: "document" as const,
  },
  {
    label: "Extract key pages",
    prompt: "Extract the most useful pages or sections from the current document.",
    icon: "bolt" as const,
  },
  {
    label: "Split the packet",
    prompt: "Split the current packet into useful sections I can review separately.",
    icon: "chart" as const,
  },
] as const;

const AGRICULTURE_STARTER_PROMPTS = [
  {
    label: "Inspect plant photos",
    prompt: "Inspect the current plant photos and summarize what is visibly happening.",
    icon: "document" as const,
  },
  {
    label: "Find likely issues",
    prompt: "List the most likely issues suggested by the photos and explain the visible evidence.",
    icon: "analytics" as const,
  },
  {
    label: "Suggest next steps",
    prompt: "Suggest practical next steps based on the current plant photos.",
    icon: "bolt" as const,
  },
] as const;

const WORKSPACE_PANES = [
  { id: "browser", label: "Browser" },
  { id: "chat", label: "Chat" },
  { id: "outputs", label: "Preview" },
  { id: "account", label: "Account" },
] as const;

const DEFAULT_PANE_ID = "browser";
const DEFAULT_AGENT_ID = "default-agent";
const MOBILE_LAYOUT_BREAKPOINT = 980;

const SURFACED_SPECIALIST_AGENT_IDS = [
  "report-agent",
  "document-agent",
  "agriculture-agent",
] as const;

type WorkspacePaneId = (typeof WORKSPACE_PANES)[number]["id"];

type ScheduledChatPrompt = {
  id: string;
  prompt: string;
  model?: string;
  agentId: string;
};

type WorkspaceInventoryTab = "files" | "artifacts";

function isWorkspacePaneId(value: string | null | undefined): value is WorkspacePaneId {
  return WORKSPACE_PANES.some((pane) => pane.id === value);
}

function normalizeWorkspacePaneId(
  value: string | null | undefined,
): WorkspacePaneId {
  if (value === "overview") {
    return "browser";
  }
  return isWorkspacePaneId(value) ? value : DEFAULT_PANE_ID;
}

function inventoryTabLabel(tab: WorkspaceInventoryTab): string {
  return tab === "files" ? "files" : "artifacts";
}

function acceptMapToInputValue(
  accept: Record<string, readonly string[]> | undefined,
): string | undefined {
  if (!accept) {
    return undefined;
  }
  const values = new Set<string>();
  for (const [mimeType, extensions] of Object.entries(accept)) {
    if (mimeType.trim()) {
      values.add(mimeType.trim());
    }
    for (const extension of extensions) {
      if (extension.trim()) {
        values.add(extension.trim());
      }
    }
  }
  return values.size ? Array.from(values).join(",") : undefined;
}

const WORKSPACE_UPLOAD_ACCEPT = acceptMapToInputValue(defaultAgentDefinition.attachmentConfig.accept);
const WORKSPACE_UPLOAD_MULTIPLE = (defaultAgentDefinition.attachmentConfig.maxCount ?? 1) > 1;

function buildTypeLabel(resource: AgentResourceRecord): string {
  switch (resource.kind) {
    case "dataset":
      return "Data";
    case "chart":
      return "Chart";
    case "document":
      return "Document";
    case "image":
      return "Image";
    case "report":
      return "Report";
    case "text":
      return "Text";
    case "blob":
      return "Other";
  }
}

function useIsMobileWorkspaceLayout() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncViewport = () => {
      setIsMobile(window.innerWidth <= MOBILE_LAYOUT_BREAKPOINT);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  return isMobile;
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

function buildTourRequestedEffectFromScenario(
  scenario: NonNullable<Awaited<ReturnType<typeof getDefaultTourScenario>>>,
): TourRequestedEffect {
  return {
    type: "tour_requested",
    scenarioId: scenario.id,
    title: scenario.title,
    summary: scenario.summary,
    workspaceName: scenario.workspace_name,
    targetAgentId: scenario.target_agent_id,
    uploadConfig: scenario.upload_config,
    defaultAssetCount: scenario.default_assets.length,
  };
}

function getStarterPromptsForAgent(agentId: string) {
  switch (agentId) {
    case "report-agent":
      return REPORT_STARTER_PROMPTS;
    case "analysis-agent":
      return ANALYSIS_STARTER_PROMPTS;
    case "chart-agent":
      return CHART_STARTER_PROMPTS;
    case "document-agent":
      return DOCUMENT_STARTER_PROMPTS;
    case "agriculture-agent":
      return AGRICULTURE_STARTER_PROMPTS;
    default:
      return DEFAULT_STARTER_PROMPTS;
  }
}

function WorkspaceBrowserPanel({
  activeContextId,
  activeContextName,
  artifactResources,
  contexts,
  onClear,
  onCreateContext,
  onUploadFiles,
  onSelectContext,
  onSelectResource,
  uploadedResources,
  selectedResourceId,
}: {
  activeContextId: string;
  activeContextName: string;
  artifactResources: AgentResourceRecord[];
  contexts: WorkspaceContextRecord[];
  onClear: () => void;
  onCreateContext: () => void;
  onUploadFiles: (files: FileList | Iterable<File> | null | undefined) => Promise<void>;
  onSelectContext: (contextId: string) => void;
  onSelectResource: (resource: AgentResourceRecord) => void;
  uploadedResources: AgentResourceRecord[];
  selectedResourceId: string | null;
}) {
  const [filterQuery, setFilterQuery] = useState("");
  const [activeTab, setActiveTab] = useState<WorkspaceInventoryTab>("files");
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const resources = activeTab === "files" ? uploadedResources : artifactResources;
  const normalizedQuery = filterQuery.trim().toLowerCase();
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
          buildTypeLabel(resource),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      }),
    [normalizedQuery, resources],
  );
  const activeContext = useMemo(
    () => contexts.find((context) => context.id === activeContextId) ?? null,
    [activeContextId, contexts],
  );
  const selectedContextId = activeContext?.id ?? activeContextId;
  const fileCount = uploadedResources.length;
  const artifactCount = artifactResources.length;
  const contextResourceCount = resources.length;

  return (
    <OverviewPanel data-testid="workspace-browser">
      <input
        ref={uploadInputRef}
        accept={WORKSPACE_UPLOAD_ACCEPT}
        data-testid="workspace-file-input"
        hidden
        multiple={WORKSPACE_UPLOAD_MULTIPLE}
        onChange={(event) => {
          const nextFiles = event.target.files;
          event.target.value = "";
          void onUploadFiles(nextFiles);
        }}
        type="file"
      />
      <OverviewHeader>
        <div>
          <OverviewTitle>Workspace</OverviewTitle>
          <OverviewDescription>{activeContextName}</OverviewDescription>
          <OverviewMeta>
            Keep uploads separate from model-created artifacts while you work.
          </OverviewMeta>
        </div>
      </OverviewHeader>

      <WorkspaceToolbar>
        <OverviewHeaderContent>
          <OverviewSelect
            aria-label="Select workspace context"
            data-testid="workspace-context-selector"
            onChange={(event) => {
              const nextContextId = event.target.value.trim();
              if (!nextContextId) {
                return;
              }
              onSelectContext(nextContextId);
            }}
            value={selectedContextId}
          >
            {contexts.map((context) => (
              <option key={context.id} value={context.id}>
                {context.name}
              </option>
            ))}
          </OverviewSelect>
        </OverviewHeaderContent>
        <OverviewActionRow>
          <OverviewActionButton onClick={onCreateContext} type="button">
            New
          </OverviewActionButton>
          <OverviewActionButton onClick={onClear} type="button">
            Clear
          </OverviewActionButton>
        </OverviewActionRow>
      </WorkspaceToolbar>

      <InventoryToolbar>
        <UploadActionButton
          onClick={() => {
            setActiveTab("files");
            uploadInputRef.current?.click();
          }}
          type="button"
        >
          Upload file
        </UploadActionButton>
        <InventoryTabs data-testid="workspace-inventory-tabs">
          <InventoryTabButton
            $active={activeTab === "files"}
            aria-pressed={activeTab === "files"}
            data-testid="workspace-inventory-tab-files"
            onClick={() => setActiveTab("files")}
            type="button"
          >
            Files
            <InventoryTabCount>{fileCount}</InventoryTabCount>
          </InventoryTabButton>
          <InventoryTabButton
            $active={activeTab === "artifacts"}
            aria-pressed={activeTab === "artifacts"}
            data-testid="workspace-inventory-tab-artifacts"
            onClick={() => setActiveTab("artifacts")}
            type="button"
          >
            Artifacts
            <InventoryTabCount>{artifactCount}</InventoryTabCount>
          </InventoryTabButton>
        </InventoryTabs>
      </InventoryToolbar>

      <FilterPanel>
        <FilterInput
          aria-label={`Filter ${inventoryTabLabel(activeTab)}`}
          data-testid="workspace-filter-input"
          onChange={(event) => setFilterQuery(event.target.value)}
          placeholder={`Filter ${inventoryTabLabel(activeTab)}`}
          type="search"
          value={filterQuery}
        />
      </FilterPanel>

      <TreePanel data-testid="workspace-resource-tree">
        {filteredResources.length ? (
          filteredResources.map((resource) => (
            <TreeLeafButton
              key={resource.id}
              $active={resource.id === selectedResourceId}
              data-testid={`workspace-resource-${resource.id}`}
              onClick={() => onSelectResource(resource)}
              type="button"
            >
              <TreeLeafMeta>{buildTypeLabel(resource)}</TreeLeafMeta>
              <strong>{resource.title}</strong>
              <span>{summarizeBrowserResource(resource)}</span>
            </TreeLeafButton>
          ))
        ) : (
          <EmptyTreeState>
            {normalizedQuery
              ? `No ${inventoryTabLabel(activeTab)} match the current filter.`
              : activeTab === "files"
                ? "No uploaded files in this workspace yet."
                : "No artifacts in this workspace yet."}
          </EmptyTreeState>
        )}
      </TreePanel>
    </OverviewPanel>
  );
}

function AccountPane() {
  return (
    <AccountPaneShell data-testid="workspace-account-pane">
      <AccountPaneTitle>Account</AccountPaneTitle>
      <AccountPaneMeta>Identity and credit status stay here on mobile.</AccountPaneMeta>
      <AuthPanel mode="account" compact />
    </AccountPaneShell>
  );
}

export function DefaultAgentPage() {
  const { user } = useAppState();
  const isMobileLayout = useIsMobileWorkspaceLayout();
  const {
    hydrated,
    contexts,
    activeContextId,
    activeContextName,
    selectedAgentId,
    selectedAgentDefinition,
    selectedAgentState,
    sharedResources,
    shellStateMetadata,
    selectAgent,
    selectContextAndAgent,
    createContext,
    getAgentState,
    updateAgentState,
    replaceAgentResources,
    clearSelectedAgentState,
    handleSelectFiles,
    resolveResource,
    getPreviewResources,
  } = useAgentShell();
  const [selectedPreviewResourceId, setSelectedPreviewResourceId] = useState<string | null>(null);
  const [pendingTour, setPendingTour] = useState<TourRequestedEffect | null>(null);
  const [scheduledPrompt, setScheduledPrompt] = useState<ScheduledChatPrompt | null>(null);

  const activeAgent = selectedAgentDefinition ?? defaultAgentDefinition;
  const activePaneId = normalizeWorkspacePaneId(selectedAgentState.active_tab);
  const [hasMountedMobileChatPane, setHasMountedMobileChatPane] = useState(
    () => !isMobileLayout || activePaneId === "chat",
  );
  const uploadedResources = useMemo(
    () => sharedResources.filter((resource) => isUploadedResource(resource)),
    [sharedResources],
  );
  const generatedResources = useMemo(
    () => sharedResources.filter((resource) => isGeneratedResource(resource)),
    [sharedResources],
  );
  const workspaceFiles = useMemo(
    () => listFileResources(sharedResources),
    [sharedResources],
  );
  const workspacePreviewModel = useMemo(
    () =>
      buildAgentPreviewModel({
        agentId: DEFAULT_AGENT_ID,
        title: "Workspace",
        resources: generatedResources,
      }),
    [generatedResources],
  );

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
    (paneId: WorkspacePaneId) => {
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

  useEffect(() => {
    if (selectedAgentState.active_tab === activePaneId) {
      return;
    }
    persistActivePane(activePaneId);
  }, [activePaneId, persistActivePane, selectedAgentState.active_tab]);

  useEffect(() => {
    if (!isMobileLayout || activePaneId === "chat") {
      setHasMountedMobileChatPane(true);
    }
  }, [activePaneId, isMobileLayout]);

  useEffect(() => {
    setSelectedPreviewResourceId((current) =>
      current && sharedResources.some((resource) => resource.id === current)
        ? current
        : generatedResources[0]?.id ?? uploadedResources[0]?.id ?? null,
    );
  }, [generatedResources, sharedResources, uploadedResources]);

  const handlePaneChange = useCallback(
    (paneId: WorkspacePaneId) => {
      persistActivePane(paneId);
    },
    [persistActivePane],
  );

  const handleRunStart = useCallback(() => {
    handlePaneChange("chat");
  }, [handlePaneChange]);

  const handleClientEffects = useCallback(
    (effects: ClientEffect[]) => {
      for (const effect of effects) {
        if (effect.type === "tour_requested") {
          setPendingTour(effect);
          handlePaneChange("chat");
        }
      }
    },
    [handlePaneChange],
  );

  const handleDismissTour = useCallback(() => {
    setPendingTour(null);
  }, []);

  const handleSelectTourScenario = useCallback(
    async (scenarioId: string) => {
      const scenario = await getDefaultTourScenario(scenarioId);
      if (!scenario) {
        throw new Error(`Unknown tour scenario: ${scenarioId}`);
      }
      setPendingTour(buildTourRequestedEffectFromScenario(scenario));
      handlePaneChange("chat");
    },
    [handlePaneChange],
  );

  const handleSubmitTourSelection = useCallback(
    async (selection: {
      scenarioId: string;
      source: "default" | "upload";
      files?: File[];
    }) => {
      const scenario = await getDefaultTourScenario(selection.scenarioId);
      if (!scenario) {
        throw new Error(`Unknown tour scenario: ${selection.scenarioId}`);
      }
      const sourceFiles =
        selection.source === "default"
          ? await loadDefaultTourScenarioDefaultFiles(scenario.id)
          : selection.files ?? [];
      if (!sourceFiles.length) {
        throw new Error("Select at least one file to continue the tour.");
      }
      const nextContextId = createContext({
        agentId: scenario.target_agent_id,
        name: scenario.workspace_name,
      });
      await handleSelectFiles(scenario.target_agent_id, sourceFiles, {
        contextId: nextContextId,
      });
      selectContextAndAgent(nextContextId, scenario.target_agent_id);
      setPendingTour(null);
      setSelectedPreviewResourceId(null);
      handlePaneChange("chat");
      setScheduledPrompt({
        id: `tour:${scenario.id}:${Date.now()}`,
        prompt: scenario.launch_prompt,
        model: scenario.model,
        agentId: scenario.target_agent_id,
      });
    },
    [createContext, handlePaneChange, handleSelectFiles, selectContextAndAgent],
  );

  const handleScheduledPromptDispatched = useCallback((promptId: string) => {
    setScheduledPrompt((current) => (current?.id === promptId ? null : current));
  }, []);

  const handleSelectContext = useCallback(
    (contextId: string) => {
      const nextContext = contexts.find((context) => context.id === contextId);
      selectContextAndAgent(
        contextId,
        nextContext?.selected_agent_id ?? DEFAULT_AGENT_ID,
      );
    },
    [contexts, selectContextAndAgent],
  );

  const handleResourceSelection = useCallback(
    (resource: AgentResourceRecord) => {
      setSelectedPreviewResourceId(resource.id);
      handlePaneChange("outputs");
    },
    [handlePaneChange],
  );

  const handleWorkspaceUpload = useCallback(
    async (files: FileList | Iterable<File> | null | undefined) => {
      const builtFiles = await handleSelectFiles(selectedAgentId, files);
      if (!builtFiles.length) {
        return;
      }
      setSelectedPreviewResourceId(builtFiles[0]?.id ?? null);
    },
    [handleSelectFiles, selectedAgentId],
  );

  if (!user) {
    return null;
  }

  const browserPane = (
    <WorkspaceBrowserPanel
      activeContextId={activeContextId}
      activeContextName={activeContextName}
      artifactResources={generatedResources}
      contexts={contexts}
      onClear={() => clearSelectedAgentState()}
      onCreateContext={() => {
        createContext({ agentId: DEFAULT_AGENT_ID });
      }}
      onUploadFiles={handleWorkspaceUpload}
      onSelectContext={handleSelectContext}
      onSelectResource={handleResourceSelection}
      uploadedResources={uploadedResources}
      selectedResourceId={selectedPreviewResourceId}
    />
  );

  const outputsPane = (
    <AgentPreviewPane
      assetResources={sharedResources}
      previewModel={workspacePreviewModel}
      resources={sharedResources}
      selectedResourceId={selectedPreviewResourceId}
    />
  );

  const chatPane = (
    <ChatKitPane
      agentBundle={agentBundle}
      enabled={hydrated}
      files={workspaceFiles}
      shellState={shellStateMetadata}
      investigationBrief=""
      clientTools={clientTools}
      onEffects={handleClientEffects}
      onSelectAgent={selectAgent}
      onReplaceAgentResources={replaceAgentResources}
      defaultAgentId={DEFAULT_AGENT_ID}
      greeting={activeAgent.chatkitLead}
      prompts={getStarterPromptsForAgent(selectedAgentId)}
      composerPlaceholder={activeAgent.chatkitPlaceholder}
      colorScheme="light"
      showChatKitHeader={false}
      showComposerTools
      composerToolIds={[...SURFACED_SPECIALIST_AGENT_IDS]}
      surfaceMinHeight={isMobileLayout ? 420 : 560}
      onRunStart={handleRunStart}
      onSelectTourScenario={handleSelectTourScenario}
      tourLauncher={pendingTour}
      onDismissTourLauncher={handleDismissTour}
      onSubmitTourSelection={handleSubmitTourSelection}
      scheduledPrompt={scheduledPrompt}
      onScheduledPromptDispatched={handleScheduledPromptDispatched}
    />
  );

  const accountPane = <AccountPane />;

  return (
    <AgentPage>
      {isMobileLayout ? (
        <>
          <MobilePaneTabs data-testid="workspace-mobile-tabs">
            {WORKSPACE_PANES.map((pane) => (
              <MobilePaneTabButton
                key={pane.id}
                $active={pane.id === activePaneId}
                aria-pressed={pane.id === activePaneId}
                data-testid={`workspace-mobile-tab-${pane.id}`}
                onClick={() => handlePaneChange(pane.id)}
                type="button"
              >
                {pane.label}
              </MobilePaneTabButton>
            ))}
          </MobilePaneTabs>

          <MobilePaneStack>
            <MobilePane data-testid="workspace-pane-browser" hidden={activePaneId !== "browser"}>
              {browserPane}
            </MobilePane>
            <MobilePane data-testid="workspace-pane-chat" hidden={activePaneId !== "chat"}>
              {activePaneId === "chat" || hasMountedMobileChatPane ? chatPane : null}
            </MobilePane>
            <MobilePane data-testid="workspace-pane-outputs" hidden={activePaneId !== "outputs"}>
              {outputsPane}
            </MobilePane>
            <MobilePane data-testid="workspace-pane-account" hidden={activePaneId !== "account"}>
              {accountPane}
            </MobilePane>
          </MobilePaneStack>
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

const DesktopShellLayout = styled.section`
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(248px, 292px) minmax(0, 1fr);
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
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
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
  display: grid;
  gap: 0.2rem;
`;

const OverviewHeaderContent = styled.div`
  min-width: 0;
  flex: 1;
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

const OverviewMeta = styled.p`
  margin: 0.18rem 0 0;
  color: var(--muted);
  font-size: 0.7rem;
  line-height: 1.4;
`;

const WorkspaceToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 0.55rem;

  @media (max-width: 740px) {
    flex-wrap: wrap;
  }
`;

const OverviewSelect = styled.select`
  width: 100%;
  max-width: 100%;
  border-radius: 14px;
  border: 1px solid rgba(31, 41, 55, 0.12);
  background: rgba(255, 255, 255, 0.86);
  color: var(--ink);
  padding: 0.58rem 0.72rem;
  font: inherit;
  font-size: 0.76rem;
`;

const OverviewActionRow = styled.div`
  display: flex;
  gap: 0.38rem;
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const InventoryToolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  flex-wrap: wrap;
`;

const UploadActionButton = styled.button`
  border: 1px solid color-mix(in srgb, var(--accent) 24%, rgba(31, 41, 55, 0.08));
  border-radius: 999px;
  padding: 0.46rem 0.82rem;
  background: color-mix(in srgb, var(--accent) 10%, white 90%);
  color: var(--accent-deep);
  font: inherit;
  font-size: 0.74rem;
  font-weight: 800;
  cursor: pointer;
`;

const InventoryTabs = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  padding: 0.16rem;
  border-radius: 999px;
  border: 1px solid rgba(31, 41, 55, 0.08);
  background: rgba(255, 255, 255, 0.68);
`;

const InventoryTabButton = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: 999px;
  padding: 0.38rem 0.7rem;
  background: ${({ $active }) =>
    $active ? "color-mix(in srgb, var(--accent) 16%, white 84%)" : "transparent"};
  color: ${({ $active }) => ($active ? "var(--accent-deep)" : "var(--muted)")};
  font: inherit;
  font-size: 0.73rem;
  font-weight: 700;
  cursor: pointer;
`;

const InventoryTabCount = styled.span`
  margin-left: 0.34rem;
  font-size: 0.68rem;
  opacity: 0.78;
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

const EmptyTreeState = styled(MetaText)`
  padding: 0.2rem 0;
  font-size: 0.76rem;
`;

const AccountPaneShell = styled(OverviewPanel)`
  grid-template-rows: auto auto minmax(0, 1fr);
`;

const AccountPaneTitle = styled.h2`
  margin: 0;
  font-size: 0.98rem;
  line-height: 1.08;
  color: var(--ink);
`;

const AccountPaneMeta = styled(MetaText)`
  margin: 0;
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

const MobilePaneStack = styled.section`
  min-height: 0;
`;

const MobilePane = styled.section`
  min-width: 0;
  min-height: 0;
`;
