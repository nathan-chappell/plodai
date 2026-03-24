import { useEffect, useMemo, useRef, useState } from "react";
import type { Entity, Widgets } from "@openai/chatkit";
import { ChatKit, type UseChatKitOptions, useChatKit } from "@openai/chatkit-react";

import {
  authenticatedFetch,
  getChatKitConfig,
  setChatKitMetadataGetter,
  setChatKitNativeFeedbackHandler,
} from "../lib/api";
import { getAgentDefinition } from "../agents/definitions";
import type { AgentAttachmentConfig, AgentBundle, AgentClientTool } from "../agents/types";
import {
  buildFeedbackSubmissionPrompt,
  buildNativeFeedbackPrompt,
  type FeedbackSessionActionPayload,
  type FeedbackOrigin,
} from "../lib/chatkit-feedback";
import { devLogger } from "../lib/dev-logging";
import { findChatKitScrollTarget, isNearScrollBottom } from "../lib/chatkit-autoscroll";
import {
  ChatKitPaneCard,
  ChatKitPaneEmpty,
  ChatKitPaneHarness,
  ChatKitPaneMeta,
  ChatKitPanePill,
  ChatKitPaneStatusActions,
  ChatKitPaneStatusRow,
  ChatKitPaneStatusText,
  ChatKitPaneSurface,
  ChatKitPaneToolbar,
  ChatKitPaneToolbarButton,
} from "./styles";
import type {
  AppChatMetadata,
  ClientEffect,
  ClientToolCall,
  ClientToolName,
} from "../types/analysis";
import type { LocalAttachment } from "../types/report";
import type { WorkspaceState } from "../types/workspace";

type ChatKitStarterPrompt = {
  label: string;
  prompt: string;
  icon?: "document" | "analytics" | "chart" | "bolt" | "check-circle";
};

export type ActiveToolInvocation = {
  name: string;
  params: Record<string, unknown>;
};

export type ChatKitComposerDraft = {
  id: string;
  prompt: string;
  model?: string;
};

export type ChatKitEntityConfig = {
  enabled: boolean;
  showComposerMenu?: boolean;
  onTagSearch: (query: string) => Promise<Entity[]>;
  onClick?: (entity: Entity) => void;
  onRequestPreview?: (
    entity: Entity,
  ) => Promise<{ preview: Widgets.BasicRoot | null }>;
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
    description: "Best available model for hard cases",
  },
] as const;

function formatToolLabel(tool: string): string {
  return tool
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type ComposerToolOption = {
  id: string;
  label: string;
  icon: "cube" | "analytics" | "chart" | "document";
  shortLabel?: string;
  placeholderOverride?: string;
};

function buildComposerToolOption(agentId: string): (ComposerToolOption & { order: number }) | null {
  const definition = getAgentDefinition(agentId);
  if (!definition) {
    return null;
  }
  return {
    id: agentId,
    label: definition.composerLabel ?? definition.title,
    shortLabel: definition.composerShortLabel,
    placeholderOverride: definition.composerPlaceholder ?? definition.chatkitPlaceholder,
    icon: definition.composerIcon ?? "cube",
    order: definition.composerOrder ?? Number.MAX_SAFE_INTEGER,
  };
}

function listAgentComposerTools(agentIds: string[]): ComposerToolOption[] {
  const agentComposerTools: Array<ComposerToolOption & { order: number }> = [];
  const seenAgentIds = new Set<string>();

  for (const agentId of agentIds) {
    if (seenAgentIds.has(agentId)) {
      continue;
    }
    seenAgentIds.add(agentId);
    const tool = buildComposerToolOption(agentId);
    if (!tool) {
      continue;
    }
    agentComposerTools.push(tool);
  }

  agentComposerTools.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.label.localeCompare(right.label);
  });

  return agentComposerTools.map(({ order: _order, ...tool }) => tool);
}

function listBundleComposerTools(agentBundle: AgentBundle): ComposerToolOption[] {
  return listAgentComposerTools(
    agentBundle.agents
      .map((agent) => agent.agent_id)
      .filter((agentId) => Boolean(getAgentDefinition(agentId)?.showInComposer)),
  );
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
    case "list_datasets":
    case "inspect_dataset_schema":
    case "list_reports":
    case "get_report":
    case "create_report":
    case "append_report_slide":
    case "remove_report_slide":
    case "get_farm_state":
    case "save_farm_state":
      return "cube";
    case "run_aggregate_query":
    case "create_dataset":
      return "analytics";
    case "render_chart_from_dataset":
      return "chart";
    case "list_pdf_files":
    case "inspect_pdf_file":
    case "get_pdf_page_range":
    case "smart_split_pdf":
    case "list_document_files":
    case "inspect_document_file":
    case "replace_document_text":
    case "fill_document_form":
    case "append_document_appendix_from_dataset":
    case "merge_document_files":
    case "smart_split_document":
    case "delete_document_file":
      return "document";
  }
  return "cube";
}

function buildStarterPrompts(): readonly ChatKitStarterPrompt[] {
  return [
    {
      label: "Summarize uploads",
      prompt: "Give me a concise summary of the current workspace uploads, including likely business meaning, key columns, and the most important first questions to investigate.",
      icon: "document",
    },
    {
      label: "Find anomalies",
      prompt: "Investigate the current workspace uploads for anomalies, outliers, or suspicious shifts. Validate the strongest ones with follow-up queries and charts before concluding.",
      icon: "analytics",
    },
    {
      label: "Suggest charts",
      prompt: "Review the current workspace uploads and suggest the most informative charts to build first. Then create the strongest ones and explain what each chart reveals.",
      icon: "chart",
    },
  ] as const;
}

export type ChatKitQuickAction = {
  label: string;
  prompt: string;
  model?: string;
  beforeRun?: () => Promise<unknown> | void;
};

export function buildChatKitRequestMetadata(options: {
  agentBundle: AgentBundle;
  workspaceState?: WorkspaceState;
  investigationBrief?: string;
  threadOrigin: FeedbackOrigin;
}): AppChatMetadata {
  return {
    investigation_brief: options.investigationBrief,
    surface_key:
      typeof window !== "undefined"
        ? window.location.pathname
        : options.agentBundle.root_agent_id,
    agent_bundle: options.agentBundle,
    workspace_state: options.workspaceState,
    origin: options.threadOrigin,
  };
}

export function ChatKitHarness({
  agentBundle,
  files,
  workspaceState,
  investigationBrief,
  onEffects,
  clientTools,
  headerTitle,
  greeting,
  prompts,
  composerPlaceholder,
  quickActions,
  activeChatId,
  onActiveChatChange,
  composerDraft,
  onComposerDraftApplied,
  threadOrigin = "interactive",
  colorScheme = "dark",
  showDictation = true,
  surfaceMinHeight,
  showChatKitHeader = true,
  showComposerTools = true,
  composerToolIds,
  onToolActivity,
  onRunStart,
  onRunEnd,
  attachmentConfig,
  entitiesConfig,
}: {
  agentBundle: AgentBundle;
  files: LocalAttachment[];
  workspaceState?: WorkspaceState;
  investigationBrief: string;
  onEffects: (effects: ClientEffect[]) => void;
  clientTools: AgentClientTool[];
  headerTitle?: string;
  greeting?: string;
  prompts?: readonly ChatKitStarterPrompt[];
  composerPlaceholder?: string;
  quickActions?: ChatKitQuickAction[];
  activeChatId?: string | null;
  onActiveChatChange?: (chatId: string | null) => Promise<void> | void;
  composerDraft?: ChatKitComposerDraft | null;
  onComposerDraftApplied?: (draftId: string) => void;
  threadOrigin?: FeedbackOrigin;
  colorScheme?: "dark" | "light";
  showDictation?: boolean;
  surfaceMinHeight?: number;
  showChatKitHeader?: boolean;
  showComposerTools?: boolean;
  composerToolIds?: string[];
  onToolActivity?: (activity: ActiveToolInvocation | null) => void;
  onRunStart?: () => void;
  onRunEnd?: () => void;
  attachmentConfig?: AgentAttachmentConfig;
  entitiesConfig?: ChatKitEntityConfig;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(activeChatId ?? null);
  const [activeClientToolName, setActiveClientToolName] = useState<string | null>(null);
  const onEffectsRef = useRef(onEffects);
  const clientToolsRef = useRef(clientTools);
  const threadIdRef = useRef<string | null>(null);
  const chatKitRef = useRef<ReturnType<typeof useChatKit> | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const scrollTargetRef = useRef<HTMLElement | null>(null);
  const cleanupScrollListenerRef = useRef<(() => void) | null>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const activeClientToolRef = useRef<string | null>(null);
  const finishStatusTimeoutRef = useRef<number | null>(null);
  const agentBundleRef = useRef(agentBundle);
  const workspaceStateRef = useRef(workspaceState);
  const investigationBriefRef = useRef(investigationBrief);
  const threadOriginRef = useRef(threadOrigin);
  const onActiveChatChangeRef = useRef(onActiveChatChange);
  const applyingComposerDraftIdRef = useRef<string | null>(null);

  useEffect(() => {
    onEffectsRef.current = onEffects;
  }, [onEffects]);

  useEffect(() => {
    clientToolsRef.current = clientTools;
  }, [clientTools]);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    activeClientToolRef.current = activeClientToolName;
  }, [activeClientToolName]);

  useEffect(() => {
    agentBundleRef.current = agentBundle;
  }, [agentBundle]);

  useEffect(() => {
    workspaceStateRef.current = workspaceState;
  }, [workspaceState]);

  useEffect(() => {
    investigationBriefRef.current = investigationBrief;
  }, [investigationBrief]);

  useEffect(() => {
    threadOriginRef.current = threadOrigin;
  }, [threadOrigin]);

  useEffect(() => {
    onActiveChatChangeRef.current = onActiveChatChange;
  }, [onActiveChatChange]);

  function clearFinishStatusTimeout() {
    if (finishStatusTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(finishStatusTimeoutRef.current);
      finishStatusTimeoutRef.current = null;
    }
  }

  function scheduleIdleStatus(nextStatus: string | null) {
    if (typeof window === "undefined") {
      setStatus(nextStatus);
      return;
    }
    clearFinishStatusTimeout();
    finishStatusTimeoutRef.current = window.setTimeout(() => {
      finishStatusTimeoutRef.current = null;
      if (!runningRef.current && !activeClientToolRef.current) {
        setStatus(nextStatus);
      }
    }, 180);
  }

  useEffect(() => {
    setChatKitMetadataGetter(() =>
      buildChatKitRequestMetadata({
        agentBundle: agentBundleRef.current,
        workspaceState: workspaceStateRef.current,
        investigationBrief: investigationBriefRef.current,
        threadOrigin: threadOriginRef.current,
      }),
    );
    return () => {
      setChatKitMetadataGetter(null);
    };
  }, []);

  useEffect(() => {
    setChatKitNativeFeedbackHandler(async ({ kind }) => {
      clearFinishStatusTimeout();
      setStatus("Starting feedback flow.");
      await chatKitRef.current?.sendUserMessage({
        text: buildNativeFeedbackPrompt(kind),
        newThread: false,
      });
    });
    return () => {
      setChatKitNativeFeedbackHandler(null);
    };
  }, []);

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

  const starterPrompts = useMemo(() => prompts ?? buildStarterPrompts(), [prompts]);
  const composerAttachments = useMemo(
    () =>
      attachmentConfig?.enabled
        ? {
            enabled: true,
            accept: attachmentConfig.accept
              ? Object.fromEntries(
                  Object.entries(attachmentConfig.accept).map(([mimeType, extensions]) => [
                    mimeType,
                    [...extensions],
                  ]),
                )
              : undefined,
            maxCount: attachmentConfig.maxCount,
            maxSize: attachmentConfig.maxSize,
          }
        : {
            enabled: false,
          },
    [attachmentConfig],
  );
  const composerTools = useMemo(
    () =>
      !showComposerTools
        ? []
        : composerToolIds?.length
          ? listAgentComposerTools(composerToolIds)
          : listBundleComposerTools(agentBundle),
    [agentBundle, composerToolIds, showComposerTools],
  );
  const options = useMemo<UseChatKitOptions>(
    () => ({
      api: {
        url: getChatKitConfig().url,
        domainKey: getChatKitConfig().domainKey,
        fetch: authenticatedFetch,
        uploadStrategy: attachmentConfig?.enabled
          ? {
              type: "two_phase",
            }
          : undefined,
      },
      initialThread: activeChatId ?? null,
      theme: {
        colorScheme,
        radius: "round",
        density: "compact",
        typography: {
          baseSize: 14,
        },
      },
      history: {
        enabled: true,
        showDelete: false,
        showRename: false,
      },
      threadItemActions: {
        feedback: true,
      },
      header: showChatKitHeader
        ? {
            enabled: true,
            title: {
              enabled: true,
              ...(headerTitle ? { text: headerTitle } : {}),
            },
          }
        : {
            enabled: false,
          },
      startScreen: {
        greeting: greeting ?? "Review uploads, create useful outputs, and decide the next step.",
        prompts: starterPrompts.map((prompt) => ({
          label: prompt.label,
          prompt: prompt.prompt,
          icon: prompt.icon,
        })),
      },
      widgets: {
        onAction: async (action, widgetItem) => {
          await chatKitRef.current?.sendCustomAction(action, widgetItem.id);
          if (action.type !== "submit_feedback_session") {
            return;
          }
          await chatKitRef.current?.sendUserMessage({
            text: buildFeedbackSubmissionPrompt(
              action.payload as FeedbackSessionActionPayload,
            ),
            newThread: false,
          });
        },
      },
      entities: entitiesConfig?.enabled
        ? {
            showComposerMenu: entitiesConfig.showComposerMenu ?? true,
            onTagSearch: entitiesConfig.onTagSearch,
            onClick: entitiesConfig.onClick,
            onRequestPreview: entitiesConfig.onRequestPreview,
          }
        : undefined,
      composer: {
        placeholder:
          composerPlaceholder ??
          "Ask the agent to inspect uploads, create outputs, or investigate this workspace",
        attachments: composerAttachments,
        dictation: { enabled: showDictation },
        models: CHATKIT_MODEL_CHOICES.map((choice) => ({
          ...choice,
          default: choice.id === CHATKIT_DEFAULT_MODEL_ID,
        })),
        tools: composerTools.map((tool) => ({
          id: tool.id,
          label: tool.label,
          icon: tool.icon,
          shortLabel: tool.shortLabel,
          placeholderOverride: tool.placeholderOverride,
          persistent: false,
        })),
      },
      onReady: () => {
        clearFinishStatusTimeout();
        setStatus(null);
        resolveScrollTarget();
        scheduleScrollToBottom(true);
      },
      onResponseStart: () => {
        clearFinishStatusTimeout();
        runningRef.current = true;
        setRunning(true);
        onRunStart?.();
        setStatus("Agent run in progress.");
        devLogger.responseStart({
          agentId: agentBundle.root_agent_id,
          fileCount: files.length,
          running: true,
          threadId: threadIdRef.current,
        });
      },
      onResponseEnd: () => {
        runningRef.current = false;
        setRunning(false);
        onRunEnd?.();
        scheduleScrollToBottom();
        if (activeClientToolRef.current) {
          setStatus(`Running ${formatToolLabel(activeClientToolRef.current)} locally.`);
        } else {
          scheduleIdleStatus(null);
        }
        devLogger.responseEnd({
          agentId: agentBundle.root_agent_id,
          fileCount: files.length,
          running: false,
          threadId: threadIdRef.current,
        });
      },
      onThreadChange: ({ threadId: nextThreadId }) => {
        threadIdRef.current = nextThreadId;
        setThreadId(nextThreadId);
        void onActiveChatChangeRef.current?.(nextThreadId ?? null);
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
        clearFinishStatusTimeout();
        activeClientToolRef.current = name;
        setActiveClientToolName(name);
        onToolActivity?.({
          name,
          params: params as Record<string, unknown>,
        });
        setStatus(`Running ${formatToolLabel(name)} locally.`);
        const startedAt = nowMs();
        let effectCount = 0;
        devLogger.clientToolStart({
          agentId: agentBundle.root_agent_id,
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
          });
          devLogger.clientToolSuccess({
            agentId: agentBundle.root_agent_id,
            fileCount: files.length,
            threadId: threadIdRef.current,
            toolName: name,
            durationMs: Math.round(nowMs() - startedAt),
            effectCount,
            result,
          });
          if (runningRef.current) {
            setStatus("Agent run in progress.");
          } else {
            scheduleIdleStatus(null);
          }
          return result;
        } catch (error) {
          devLogger.clientToolError({
            agentId: agentBundle.root_agent_id,
            fileCount: files.length,
            threadId: threadIdRef.current,
            toolName: name,
            durationMs: Math.round(nowMs() - startedAt),
            error,
          });
          throw error;
        } finally {
          if (activeClientToolRef.current === name) {
            activeClientToolRef.current = null;
          }
          setActiveClientToolName((current) => (current === name ? null : current));
          onToolActivity?.(null);
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
      composerTools,
      composerAttachments,
      activeChatId,
      colorScheme,
      composerPlaceholder,
      attachmentConfig?.enabled,
      agentBundle.root_agent_id,
      files.length,
      greeting,
      headerTitle,
      showChatKitHeader,
      showDictation,
      starterPrompts,
      entitiesConfig,
      onToolActivity,
      onRunStart,
      onRunEnd,
    ],
  );

  const chatKit = useChatKit(options);

  useEffect(() => {
    chatKitRef.current = chatKit;
  }, [chatKit]);

  useEffect(() => {
    if (activeChatId === undefined) {
      return;
    }
    if (threadIdRef.current === activeChatId) {
      return;
    }
    threadIdRef.current = activeChatId;
    setThreadId(activeChatId ?? null);
    void chatKit.setThreadId(activeChatId ?? null);
  }, [activeChatId, chatKit]);

  useEffect(() => {
    if (
      !composerDraft ||
      running ||
      activeClientToolName !== null ||
      applyingComposerDraftIdRef.current === composerDraft.id
    ) {
      return;
    }
    applyingComposerDraftIdRef.current = composerDraft.id;
    clearFinishStatusTimeout();
    setStatus("Prompt loaded into the composer.");
    void chatKit
      .setComposerValue({
        text: composerDraft.prompt,
        selectedModelId: composerDraft.model ?? undefined,
      })
      .then(async () => {
        await chatKit.focusComposer().catch(() => undefined);
      })
      .finally(() => {
        applyingComposerDraftIdRef.current = null;
        onComposerDraftApplied?.(composerDraft.id);
        if (!runningRef.current && !activeClientToolRef.current) {
          scheduleIdleStatus(null);
        }
      });
  }, [
    activeClientToolName,
    chatKit,
    composerDraft,
    onComposerDraftApplied,
    running,
  ]);

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
      clearFinishStatusTimeout();
    };
  }, [chatKit]);

  async function handleQuickAction(action: ChatKitQuickAction) {
    const needsNewThread = !threadIdRef.current;
    setStatus(`Starting ${action.label.toLowerCase()}.`);
    await action.beforeRun?.();
    await chatKit.sendUserMessage({
      text: action.prompt,
      model: action.model ?? CHATKIT_DEFAULT_MODEL_ID,
      newThread: needsNewThread,
    });
  }

  const isBusy =
    running ||
    activeClientToolName !== null ||
    applyingComposerDraftIdRef.current !== null;
  const quickActionList = quickActions ?? [];
  const hasStatusChrome = quickActionList.length > 0 || Boolean(status);

  return (
    <ChatKitPaneHarness>
      {hasStatusChrome ? (
        <ChatKitPaneStatusRow data-testid="chatkit-top-row">
          <ChatKitPaneStatusActions data-testid="chatkit-header-controls">
            <ChatKitPaneToolbar data-testid="chatkit-quick-actions">
              {quickActionList.map((action) => (
                <ChatKitPaneToolbarButton
                  key={action.label}
                  data-testid={`chatkit-quick-action-${slugifyLabel(action.label)}`}
                  type="button"
                  onClick={() => void handleQuickAction(action)}
                  disabled={isBusy}
                >
                  {action.label}
                </ChatKitPaneToolbarButton>
              ))}
            </ChatKitPaneToolbar>
            <ChatKitPaneStatusText $light={colorScheme === "light"} data-testid="chatkit-status">
              {status}
            </ChatKitPaneStatusText>
          </ChatKitPaneStatusActions>
        </ChatKitPaneStatusRow>
      ) : null}
      <ChatKitPaneSurface
        ref={surfaceRef}
        $light={colorScheme === "light"}
        $minHeight={surfaceMinHeight}
        data-testid="chatkit-surface"
      >
        <ChatKit control={chatKit.control} />
      </ChatKitPaneSurface>
    </ChatKitPaneHarness>
  );
}

export function ChatKitPane({
  agentBundle,
  enabled,
  files,
  workspaceState,
  investigationBrief,
  clientTools,
  onEffects,
  headerTitle,
  greeting,
  prompts,
  composerPlaceholder,
  quickActions,
  activeChatId,
  onActiveChatChange,
  composerDraft,
  onComposerDraftApplied,
  threadOrigin,
  colorScheme,
  showDictation,
  panePill,
  paneTitle,
  paneMeta,
  emptyMessage,
  showPaneHeader = false,
  showDefaultModelMeta = false,
  surfaceMinHeight,
  showChatKitHeader = true,
  showComposerTools = true,
  composerToolIds,
  onToolActivity,
  onRunStart,
  onRunEnd,
  attachmentConfig,
  entitiesConfig,
}: {
  agentBundle: AgentBundle;
  enabled: boolean;
  files: LocalAttachment[];
  workspaceState?: WorkspaceState;
  investigationBrief: string;
  clientTools: AgentClientTool[];
  onEffects: (effects: ClientEffect[]) => void;
  headerTitle?: string;
  greeting?: string;
  prompts?: readonly ChatKitStarterPrompt[];
  composerPlaceholder?: string;
  quickActions?: ChatKitQuickAction[];
  activeChatId?: string | null;
  onActiveChatChange?: (chatId: string | null) => Promise<void> | void;
  composerDraft?: ChatKitComposerDraft | null;
  onComposerDraftApplied?: (draftId: string) => void;
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
  showChatKitHeader?: boolean;
  showComposerTools?: boolean;
  composerToolIds?: string[];
  onToolActivity?: (activity: ActiveToolInvocation | null) => void;
  onRunStart?: () => void;
  onRunEnd?: () => void;
  attachmentConfig?: AgentAttachmentConfig;
  entitiesConfig?: ChatKitEntityConfig;
}) {
  const canInvestigate =
    enabled &&
    (
      files.length > 0 ||
      clientTools.length > 0 ||
      attachmentConfig?.enabled === true
    );
  const resolvedMeta =
    paneMeta ??
    (canInvestigate
      ? files.length > 0
        ? `${files.length} upload${files.length === 1 ? " is" : "s are"} ready. Start with a summary, extraction, or investigation pass.`
        : attachmentConfig?.enabled
          ? "Attach one or more files to prepare this workspace."
          : "Start with a summary, extraction, or investigation pass."
      : enabled
        ? attachmentConfig?.enabled
          ? "Attach one or more files to start the workspace."
          : "Add one or more uploads to start the workspace."
        : "Sign in to start working in this workspace.");

  useEffect(() => {
    devLogger.chatKitGate({
      agentId: agentBundle.root_agent_id,
      clientToolCount: clientTools.length,
      enabled,
      canInvestigate,
      fileCount: files.length,
      emptyMessage,
    });
  }, [agentBundle.root_agent_id, canInvestigate, clientTools.length, emptyMessage, enabled, files.length]);

  return (
    <ChatKitPaneCard>
      {showPaneHeader ? (
        <>
          <ChatKitPanePill>{panePill ?? "Analyst workspace"}</ChatKitPanePill>
          <h2>{paneTitle ?? "Chat with your workspace"}</h2>
          <ChatKitPaneMeta>{resolvedMeta}</ChatKitPaneMeta>
        </>
      ) : null}
      {showDefaultModelMeta ? <ChatKitPaneMeta>{paneMeta ?? resolvedMeta}</ChatKitPaneMeta> : null}
      {canInvestigate ? (
        <ChatKitHarness
          agentBundle={agentBundle}
          files={files}
          workspaceState={workspaceState}
          investigationBrief={investigationBrief}
          clientTools={clientTools}
          onEffects={onEffects}
          headerTitle={headerTitle}
          greeting={greeting}
          prompts={prompts}
          composerPlaceholder={composerPlaceholder}
          quickActions={quickActions}
          activeChatId={activeChatId}
          onActiveChatChange={onActiveChatChange}
          composerDraft={composerDraft}
          onComposerDraftApplied={onComposerDraftApplied}
          threadOrigin={threadOrigin}
          colorScheme={colorScheme}
          showDictation={showDictation}
          surfaceMinHeight={surfaceMinHeight}
          showChatKitHeader={showChatKitHeader}
          showComposerTools={showComposerTools}
          composerToolIds={composerToolIds}
          onToolActivity={onToolActivity}
          onRunStart={onRunStart}
          onRunEnd={onRunEnd}
          attachmentConfig={attachmentConfig}
          entitiesConfig={entitiesConfig}
        />
      ) : (
        <ChatKitPaneSurface $minHeight={surfaceMinHeight} data-testid="chatkit-surface">
          <ChatKitPaneEmpty>
            {emptyMessage ?? (enabled ? "Add uploads or ask the agent to create the first workspace item." : "Sign in to open the workspace.")}
          </ChatKitPaneEmpty>
        </ChatKitPaneSurface>
      )}
    </ChatKitPaneCard>
  );
}
