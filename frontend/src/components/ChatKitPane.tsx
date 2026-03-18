import { useEffect, useMemo, useRef, useState } from "react";
import { ChatKit, type UseChatKitOptions, useChatKit } from "@openai/chatkit-react";

import { authenticatedFetch, getChatKitConfig, setChatKitMetadataGetter } from "../lib/api";
import {
  buildFeedbackSummaryMessage,
  buildProvideFeedbackPrompt,
  type FeedbackActionPayload,
  type FeedbackOrigin,
} from "../lib/chatkit-feedback";
import { buildThreadMetadataUpdateAction } from "../lib/thread-metadata";
import { devLogger } from "../lib/dev-logging";
import { findChatKitScrollTarget, isNearScrollBottom } from "../lib/chatkit-autoscroll";
import type { CapabilityBundle, CapabilityClientTool } from "../capabilities/types";
import {
  ChatKitPaneCard,
  ChatKitPaneEmpty,
  ChatKitPaneHarnessMeta,
  ChatKitPaneMeta,
  ChatKitPaneModeButton,
  ChatKitPaneModeRow,
  ChatKitPanePill,
  ChatKitPaneSurface,
  ChatKitPaneToolbar,
  ChatKitPaneToolbarButton,
} from "./styles";
import type {
  AppThreadMetadata,
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  ExecutionMode,
  WorkspaceThreadContext,
} from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";

type ChatKitStarterPrompt = {
  label: string;
  prompt: string;
  icon?: "document" | "analytics" | "chart" | "bolt" | "check-circle";
};

const CHATKIT_DEFAULT_MODEL_ID = import.meta.env.VITE_CHATKIT_DEFAULT_MODEL ?? "lightweight";
const CHATKIT_MODEL_CHOICES = [
  {
    id: "lightweight",
    label: import.meta.env.VITE_CHATKIT_LIGHTWEIGHT_MODEL_LABEL ?? "Lightweight",
    description: "Fastest, cheapest exploration pass",
  },
  {
    id: "balanced",
    label: import.meta.env.VITE_CHATKIT_BALANCED_MODEL_LABEL ?? "Balanced",
    description: "Stronger reasoning for deeper analysis",
  },
  {
    id: "powerful",
    label: import.meta.env.VITE_CHATKIT_POWERFUL_MODEL_LABEL ?? "Powerful",
    description: "Best available capability for hard cases",
  },
] as const;

const CHATKIT_DEFAULT_MODEL_LABEL =
  CHATKIT_MODEL_CHOICES.find((choice) => choice.id === CHATKIT_DEFAULT_MODEL_ID)?.label ?? "Lightweight";

function formatToolLabel(tool: string): string {
  return tool
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugifyLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function scrollElementToBottom(element: HTMLElement): void {
  element.scrollTop = element.scrollHeight;
}

function toolIcon(tool: ClientToolName): "cube" | "analytics" | "chart" | "document" {
  switch (tool) {
    case "get_workspace_context":
    case "create_workspace_directory":
    case "change_workspace_directory":
    case "list_workspace_files":
    case "list_attached_csv_files":
    case "list_chartable_files":
    case "inspect_chartable_file_schema":
      return "cube";
    case "run_aggregate_query":
    case "create_csv_file":
    case "create_json_file":
      return "analytics";
    case "render_chart_from_file":
      return "chart";
    case "inspect_pdf_file":
    case "get_pdf_page_range":
    case "smart_split_pdf":
      return "document";
  }
  return "cube";
}

function buildStarterPrompts(investigationBrief: string): readonly ChatKitStarterPrompt[] {
  const briefSuffix = investigationBrief.trim()
    ? ` Focus on this goal: ${investigationBrief.trim()}`
    : "";

  return [
    {
      label: "Summarize files",
      prompt: `Give me a concise summary of all attached files, including likely business meaning, key columns, and the most important first questions to investigate.${briefSuffix}`,
      icon: "document",
    },
    {
      label: "Find anomalies",
      prompt: `Investigate the attached files for anomalies, outliers, or suspicious shifts. Validate the strongest ones with follow-up queries and charts before concluding.${briefSuffix}`,
      icon: "analytics",
    },
    {
      label: "Suggest charts",
      prompt: `Review the attached files and suggest the most informative charts to build first. Then create the strongest ones and explain what each chart reveals.${briefSuffix}`,
      icon: "chart",
    },
  ] as const;
}

export type ChatKitQuickAction = {
  label: string;
  prompt: string;
  model?: string;
};

const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  interactive: "Interactive",
  batch: "Batch",
};

export function buildChatKitRequestMetadata(options: {
  capabilityBundle: CapabilityBundle;
  workspaceContext?: WorkspaceThreadContext;
  workspaceBootstrap?: AppThreadMetadata["workspace_bootstrap"];
  threadOrigin: FeedbackOrigin;
  executionMode: ExecutionMode;
}): AppThreadMetadata {
  return {
    surface_key:
      typeof window !== "undefined"
        ? window.location.pathname
        : options.capabilityBundle.root_capability_id,
    capability_bundle: options.capabilityBundle,
    workspace_context: options.workspaceContext,
    workspace_bootstrap: options.workspaceBootstrap,
    workspace_contract_version: options.workspaceBootstrap ? "v1" : undefined,
    execution_mode: options.executionMode,
    origin: options.threadOrigin,
  };
}

export function ChatKitHarness({
  capabilityBundle,
  files,
  workspaceContext,
  workspaceBootstrap,
  executionMode,
  investigationBrief,
  onEffects,
  onFilesAdded,
  clientTools,
  headerTitle = "AI Portfolio",
  greeting,
  prompts,
  composerPlaceholder,
  quickActions,
  threadOrigin = "interactive",
  colorScheme = "dark",
  showDictation = true,
  surfaceMinHeight,
}: {
  capabilityBundle: CapabilityBundle;
  files: LocalWorkspaceFile[];
  workspaceContext?: WorkspaceThreadContext;
  workspaceBootstrap?: AppThreadMetadata["workspace_bootstrap"];
  executionMode: ExecutionMode;
  investigationBrief: string;
  onEffects: (effects: ClientEffect[]) => void;
  onFilesAdded?: (files: LocalWorkspaceFile[]) => LocalWorkspaceFile[] | void;
  clientTools: CapabilityClientTool[];
  headerTitle?: string;
  greeting?: string;
  prompts?: readonly ChatKitStarterPrompt[];
  composerPlaceholder?: string;
  quickActions?: ChatKitQuickAction[];
  threadOrigin?: FeedbackOrigin;
  colorScheme?: "dark" | "light";
  showDictation?: boolean;
  surfaceMinHeight?: number;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const onEffectsRef = useRef(onEffects);
  const onFilesAddedRef = useRef(onFilesAdded);
  const clientToolsRef = useRef(clientTools);
  const threadIdRef = useRef<string | null>(null);
  const chatKitRef = useRef<ReturnType<typeof useChatKit> | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const scrollTargetRef = useRef<HTMLElement | null>(null);
  const cleanupScrollListenerRef = useRef<(() => void) | null>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const lastExecutionModeRef = useRef<ExecutionMode | null>(null);

  useEffect(() => {
    onEffectsRef.current = onEffects;
  }, [onEffects]);

  useEffect(() => {
    onFilesAddedRef.current = onFilesAdded;
  }, [onFilesAdded]);

  useEffect(() => {
    clientToolsRef.current = clientTools;
  }, [clientTools]);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    setChatKitMetadataGetter(() =>
      buildChatKitRequestMetadata({
        capabilityBundle,
        workspaceContext,
        workspaceBootstrap,
        threadOrigin,
        executionMode,
      }),
    );
    return () => {
      setChatKitMetadataGetter(null);
    };
  }, [capabilityBundle, executionMode, threadOrigin, workspaceBootstrap, workspaceContext]);

  useEffect(() => {
    const previousMode = lastExecutionModeRef.current;
    lastExecutionModeRef.current = executionMode;
    if (!threadIdRef.current || previousMode === null || previousMode === executionMode) {
      return;
    }
    void chatKitRef.current?.sendCustomAction(
      buildThreadMetadataUpdateAction({
        execution_mode: executionMode,
      }),
    );
  }, [executionMode]);

  function resolveScrollTarget(): HTMLElement | null {
    const chatKitElement = chatKitRef.current?.ref.current;
    const fallback = surfaceRef.current;
    const nextTarget = chatKitElement ? findChatKitScrollTarget(chatKitElement, fallback) : fallback;
    if (scrollTargetRef.current === nextTarget) {
      return nextTarget;
    }

    cleanupScrollListenerRef.current?.();
    scrollTargetRef.current = nextTarget ?? null;

    if (!nextTarget) {
      cleanupScrollListenerRef.current = null;
      return null;
    }

    const handleScroll = () => {
      autoScrollEnabledRef.current = isNearScrollBottom(nextTarget);
    };

    nextTarget.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    cleanupScrollListenerRef.current = () => {
      nextTarget.removeEventListener("scroll", handleScroll);
    };
    return nextTarget;
  }

  function scheduleScrollToBottom(force = false): void {
    if (typeof window === "undefined") {
      return;
    }
    if (pendingScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingScrollFrameRef.current);
    }
    pendingScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingScrollFrameRef.current = null;
      const target = resolveScrollTarget();
      if (!target) {
        return;
      }
      if (!force && !autoScrollEnabledRef.current) {
        return;
      }
      scrollElementToBottom(target);
    });
  }

  const rootCapability = useMemo(
    () =>
      capabilityBundle.capabilities.find(
        (capability) => capability.capability_id === capabilityBundle.root_capability_id,
      ) ?? capabilityBundle.capabilities[0],
    [capabilityBundle],
  );
  const starterPrompts = useMemo(
    () => prompts ?? buildStarterPrompts(investigationBrief),
    [investigationBrief, prompts],
  );
  const chatKitTools = useMemo(
    () => rootCapability.client_tools.map((tool) => tool.name as ClientToolName),
    [rootCapability.client_tools],
  );
  const options = useMemo<UseChatKitOptions>(
    () => ({
      api: {
        url: getChatKitConfig().url,
        domainKey: getChatKitConfig().domainKey,
        fetch: authenticatedFetch,
      },
      theme: {
        colorScheme,
        radius: "round",
        density: "normal",
      },
      history: {
        enabled: true,
        showDelete: false,
        showRename: true,
      },
      threadItemActions: {
        feedback: false,
      },
      header: {
        title: {
          enabled: true,
          text: headerTitle,
        },
      },
      startScreen: {
        greeting:
          greeting ??
          (files.length
            ? `Investigate ${files.length} attached file${files.length === 1 ? "" : "s"}.`
            : "Manage the workspace or add local files to start the investigation."),
        prompts: starterPrompts.map((prompt) => ({
          label: prompt.label,
          prompt: prompt.prompt,
          icon: prompt.icon,
        })),
      },
      widgets: {
        onAction: async (action, widgetItem) => {
          await chatKitRef.current?.sendCustomAction(action, widgetItem.id);
          if (action.type !== "submit_feedback_details") {
            return;
          }
          await chatKitRef.current?.sendUserMessage({
            text: buildFeedbackSummaryMessage(action.payload as FeedbackActionPayload),
            newThread: false,
          });
        },
      },
      composer: {
        placeholder:
          composerPlaceholder ??
          (investigationBrief.trim()
            ? `Work toward this goal: ${investigationBrief.trim().slice(0, 80)}`
            : "Ask the agent to inspect, transform, or investigate your local files"),
        attachments: {
          enabled: false,
        },
        dictation: { enabled: showDictation },
        models: CHATKIT_MODEL_CHOICES.map((choice) => ({
          ...choice,
          default: choice.id === CHATKIT_DEFAULT_MODEL_ID,
        })),
        tools: chatKitTools.map((tool) => ({
          id: tool,
          label: formatToolLabel(tool),
          icon: toolIcon(tool),
        })),
      },
      onReady: () => {
        setStatus("ChatKit ready.");
        resolveScrollTarget();
        scheduleScrollToBottom(true);
      },
      onResponseStart: () => {
        setRunning(true);
        setStatus("Agent run in progress.");
        devLogger.responseStart({
          capabilityId: capabilityBundle.root_capability_id,
          fileCount: files.length,
          running: true,
          threadId: threadIdRef.current,
        });
      },
      onResponseEnd: () => {
        setRunning(false);
        setStatus("Agent run finished.");
        scheduleScrollToBottom();
        devLogger.responseEnd({
          capabilityId: capabilityBundle.root_capability_id,
          fileCount: files.length,
          running: false,
          threadId: threadIdRef.current,
        });
      },
      onThreadChange: ({ threadId: nextThreadId }) => {
        setThreadId(nextThreadId);
        autoScrollEnabledRef.current = true;
        resolveScrollTarget();
        scheduleScrollToBottom(true);
      },
      onThreadLoadEnd: () => {
        resolveScrollTarget();
        scheduleScrollToBottom(true);
      },
      onClientTool: async ({ name, params }) => {
        const tool = clientToolsRef.current.find((candidate) => candidate.name === name);
        if (!tool) {
          throw new Error(`Unknown client tool: ${name}`);
        }
        const startedAt = nowMs();
        let effectCount = 0;
        let appendedFileCount = 0;
        devLogger.clientToolStart({
          capabilityId: capabilityBundle.root_capability_id,
          fileCount: files.length,
          threadId: threadIdRef.current,
          toolName: name,
          args: params,
        });
        try {
          const result = await tool.handler(params as ClientToolCall<ClientToolName>["arguments"], {
            emitEffect: (effect) => {
              effectCount += 1;
              onEffectsRef.current([effect]);
            },
            emitEffects: (effects) => {
              effectCount += effects.length;
              if (effects.length) {
                onEffectsRef.current(effects);
              }
            },
            appendFiles: (nextFiles): LocalWorkspaceFile[] => {
              appendedFileCount += nextFiles.length;
              if (nextFiles.length) {
                return onFilesAddedRef.current?.(nextFiles) ?? nextFiles;
              }
              return nextFiles;
            },
          });
          const nextWorkspaceContext = extractWorkspaceContext(result);
          if (nextWorkspaceContext && threadIdRef.current) {
            await chatKitRef.current?.sendCustomAction(
              buildThreadMetadataUpdateAction({
                workspace_context: nextWorkspaceContext,
              }),
            );
          }
          devLogger.clientToolSuccess({
            capabilityId: capabilityBundle.root_capability_id,
            fileCount: files.length,
            threadId: threadIdRef.current,
            toolName: name,
            durationMs: Math.round(nowMs() - startedAt),
            effectCount,
            appendedFileCount,
            result,
          });
          return result;
        } catch (error) {
          devLogger.clientToolError({
            capabilityId: capabilityBundle.root_capability_id,
            fileCount: files.length,
            threadId: threadIdRef.current,
            toolName: name,
            durationMs: Math.round(nowMs() - startedAt),
            error,
          });
          throw error;
        }
      },
      onEffect: (event) => {
        if (!event.data) {
          return;
        }
        if (
          event.name !== "chart_rendered" &&
          event.name !== "report_section_appended" &&
          event.name !== "pdf_smart_split_completed"
        ) {
          return;
        }
        onEffectsRef.current([event.data as ClientEffect]);
      },
    }),
    [
      chatKitTools,
      colorScheme,
      composerPlaceholder,
      capabilityBundle.root_capability_id,
      executionMode,
      files.length,
      greeting,
      headerTitle,
      investigationBrief,
      showDictation,
      starterPrompts,
      threadOrigin,
    ],
  );

  const chatKit = useChatKit(options);

  useEffect(() => {
    chatKitRef.current = chatKit;
  }, [chatKit]);

  useEffect(() => {
    resolveScrollTarget();

    return () => {
      cleanupScrollListenerRef.current?.();
      cleanupScrollListenerRef.current = null;
      scrollTargetRef.current = null;
      if (pendingScrollFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(pendingScrollFrameRef.current);
        pendingScrollFrameRef.current = null;
      }
    };
  }, [chatKit]);

  async function handleQuickAction(action: ChatKitQuickAction) {
    const needsNewThread = !threadIdRef.current;
    setStatus(`Starting ${action.label.toLowerCase()}.`);
    await chatKit.sendUserMessage({
      text: action.prompt,
      model: action.model ?? CHATKIT_DEFAULT_MODEL_ID,
      newThread: needsNewThread,
    });
  }

  async function handleProvideFeedback() {
    if (!threadIdRef.current) {
      return;
    }
    setStatus("Starting feedback flow.");
    await chatKit.sendUserMessage({
      text: buildProvideFeedbackPrompt(),
      newThread: false,
    });
  }

  return (
    <>
      {quickActions?.length || threadId ? (
        <ChatKitPaneToolbar data-testid="chatkit-quick-actions">
          {(quickActions ?? []).map((action) => (
            <ChatKitPaneToolbarButton
              key={action.label}
              data-testid={`chatkit-quick-action-${slugifyLabel(action.label)}`}
              type="button"
              onClick={() => void handleQuickAction(action)}
              disabled={running}
            >
              {action.label}
            </ChatKitPaneToolbarButton>
          ))}
          <ChatKitPaneToolbarButton
            data-testid="chatkit-provide-feedback"
            type="button"
            onClick={() => void handleProvideFeedback()}
            disabled={running || !threadId}
          >
            Provide feedback
          </ChatKitPaneToolbarButton>
        </ChatKitPaneToolbar>
      ) : null}
      {status ? (
        <ChatKitPaneHarnessMeta $light={colorScheme === "light"} data-testid="chatkit-status">
          {status}
        </ChatKitPaneHarnessMeta>
      ) : null}
      <ChatKitPaneSurface
        ref={surfaceRef}
        $light={colorScheme === "light"}
        $minHeight={surfaceMinHeight}
        data-testid="chatkit-surface"
      >
        <ChatKit control={chatKit.control} />
      </ChatKitPaneSurface>
    </>
  );
}

export function ChatKitPane({
  capabilityBundle,
  enabled,
  files,
  workspaceContext,
  workspaceBootstrap,
  executionMode,
  onExecutionModeChange,
  investigationBrief,
  clientTools,
  onEffects,
  onFilesAdded,
  headerTitle,
  greeting,
  prompts,
  composerPlaceholder,
  quickActions,
  threadOrigin,
  colorScheme,
  showDictation,
  panePill,
  paneTitle,
  paneMeta,
  emptyMessage,
  showPaneHeader = true,
  showDefaultModelMeta = true,
  surfaceMinHeight,
}: {
  capabilityBundle: CapabilityBundle;
  enabled: boolean;
  files: LocalWorkspaceFile[];
  workspaceContext?: WorkspaceThreadContext;
  workspaceBootstrap?: AppThreadMetadata["workspace_bootstrap"];
  executionMode: ExecutionMode;
  onExecutionModeChange: (mode: ExecutionMode) => void;
  investigationBrief: string;
  clientTools: CapabilityClientTool[];
  onEffects: (effects: ClientEffect[]) => void;
  onFilesAdded?: (files: LocalWorkspaceFile[]) => LocalWorkspaceFile[] | void;
  headerTitle?: string;
  greeting?: string;
  prompts?: readonly ChatKitStarterPrompt[];
  composerPlaceholder?: string;
  quickActions?: ChatKitQuickAction[];
  threadOrigin?: FeedbackOrigin;
  colorScheme?: "dark" | "light";
  showDictation?: boolean;
  panePill?: string;
  paneTitle?: string;
  paneMeta?: string;
  emptyMessage?: string;
  showPaneHeader?: boolean;
  showDefaultModelMeta?: boolean;
  surfaceMinHeight?: number;
}) {
  const canInvestigate = enabled && (files.length > 0 || clientTools.length > 0);
  const resolvedMeta =
    paneMeta ??
    (canInvestigate
      ? `${files.length} file${files.length === 1 ? " is" : "s are"} ready. ${investigationBrief.trim() ? `Current goal: ${investigationBrief.trim()}` : "Start with a summary, extraction, or investigation pass."}`
      : enabled
        ? "Add one or more local files to start the investigation."
        : "Sign in to start analyzing local files.");

  return (
    <ChatKitPaneCard>
      {showPaneHeader ? (
        <>
          <ChatKitPanePill>{panePill ?? "Analyst workspace"}</ChatKitPanePill>
          <h2>{paneTitle ?? "Investigate your files"}</h2>
          <ChatKitPaneMeta>{resolvedMeta}</ChatKitPaneMeta>
        </>
      ) : null}
      {showDefaultModelMeta ? (
        <ChatKitPaneMeta>Default model capability: {CHATKIT_DEFAULT_MODEL_LABEL}</ChatKitPaneMeta>
      ) : null}
      <ChatKitPaneModeRow>
        <ChatKitPaneMeta>Run mode</ChatKitPaneMeta>
        {(["interactive", "batch"] as const).map((mode) => (
          <ChatKitPaneModeButton
            key={mode}
            type="button"
            $active={executionMode === mode}
            onClick={() => onExecutionModeChange(mode)}
            data-testid={`chatkit-execution-mode-${mode}`}
          >
            {EXECUTION_MODE_LABELS[mode]}
          </ChatKitPaneModeButton>
        ))}
      </ChatKitPaneModeRow>
      {canInvestigate ? (
        <ChatKitHarness
          capabilityBundle={capabilityBundle}
          files={files}
          workspaceContext={workspaceContext}
          workspaceBootstrap={workspaceBootstrap}
          executionMode={executionMode}
          investigationBrief={investigationBrief}
          clientTools={clientTools}
          onEffects={onEffects}
          onFilesAdded={onFilesAdded}
          headerTitle={headerTitle}
          greeting={greeting}
          prompts={prompts}
          composerPlaceholder={composerPlaceholder}
          quickActions={quickActions}
          threadOrigin={threadOrigin}
          colorScheme={colorScheme}
          showDictation={showDictation}
          surfaceMinHeight={surfaceMinHeight}
        />
      ) : (
        <ChatKitPaneSurface $minHeight={surfaceMinHeight} data-testid="chatkit-surface">
          <ChatKitPaneEmpty>
            {emptyMessage ?? (enabled ? "The agent is ready once you add local CSV files." : "Sign in to open the analyst workspace.")}
          </ChatKitPaneEmpty>
        </ChatKitPaneSurface>
      )}
    </ChatKitPaneCard>
  );
}

function extractWorkspaceContext(result: unknown): WorkspaceThreadContext | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }

  const rawWorkspaceContext = (result as { workspace_context?: unknown }).workspace_context;
  if (!rawWorkspaceContext || typeof rawWorkspaceContext !== "object" || Array.isArray(rawWorkspaceContext)) {
    return null;
  }

  const cwdPath = (rawWorkspaceContext as { cwd_path?: unknown }).cwd_path;
  const referencedItemIds = (rawWorkspaceContext as { referenced_item_ids?: unknown }).referenced_item_ids;
  if (typeof cwdPath !== "string" || !Array.isArray(referencedItemIds)) {
    return null;
  }

  return {
    cwd_path: cwdPath,
    referenced_item_ids: referencedItemIds.filter(
      (value): value is string => typeof value === "string" && Boolean(value),
    ),
  };
}
