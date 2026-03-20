import { useEffect, useMemo, useRef, useState } from "react";
import { ChatKit, type UseChatKitOptions, useChatKit } from "@openai/chatkit-react";

import { authenticatedFetch, getChatKitConfig, setChatKitMetadataGetter } from "../lib/api";
import { getToolProviderDefinition } from "../tools/definitions";
import {
  buildFeedbackSubmissionPrompt,
  buildProvideFeedbackPrompt,
  type FeedbackSessionActionPayload,
  type FeedbackOrigin,
} from "../lib/chatkit-feedback";
import { devLogger } from "../lib/dev-logging";
import { findChatKitScrollTarget, isNearScrollBottom } from "../lib/chatkit-autoscroll";
import type { ToolProviderBundle, ToolProviderClientTool } from "../tools/types";
import {
  ChatKitPaneCard,
  ChatKitPaneEmpty,
  ChatKitPaneFeedbackButton,
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
  AppThreadMetadata,
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  WorkspaceState,
} from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";

type ChatKitStarterPrompt = {
  label: string;
  prompt: string;
  icon?: "document" | "analytics" | "chart" | "bolt" | "check-circle";
};

export type ActiveToolInvocation = {
  name: string;
  params: Record<string, unknown>;
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

function listBundleToolDefinitions(capabilityBundle: ToolProviderBundle) {
  const seen = new Set<string>();
  const toolDefinitions: Array<ToolProviderBundle["tool_providers"][number]["client_tools"][number]> = [];

  for (const capability of capabilityBundle.tool_providers) {
    for (const tool of capability.client_tools) {
      if (seen.has(tool.name)) {
        continue;
      }
      seen.add(tool.name);
      toolDefinitions.push(tool);
    }
  }

  return toolDefinitions;
}

type ComposerToolOption = {
  id: string;
  label: string;
  icon: "cube" | "analytics" | "chart" | "document";
  shortLabel?: string;
  placeholderOverride?: string;
};

function listBundleComposerTools(capabilityBundle: ToolProviderBundle): ComposerToolOption[] {
  const capabilityComposerTools: Array<ComposerToolOption & { order: number }> = [];

  for (const capability of capabilityBundle.tool_providers) {
    const definition = getToolProviderDefinition(capability.tool_provider_id);
    if (!definition?.showInComposer) {
      continue;
    }
    capabilityComposerTools.push({
      id: capability.tool_provider_id,
      label: definition.composerLabel ?? definition.title,
      shortLabel: definition.composerShortLabel,
      placeholderOverride: definition.composerPlaceholder ?? definition.chatkitPlaceholder,
      icon: definition.composerIcon ?? "cube",
      order: definition.composerOrder ?? Number.MAX_SAFE_INTEGER,
    });
  }

  capabilityComposerTools.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.label.localeCompare(right.label);
  });

  if (capabilityComposerTools.length > 0) {
    return capabilityComposerTools.map(({ order: _order, ...tool }) => tool);
  }

  return listBundleToolDefinitions(capabilityBundle).map((tool) => ({
    id: tool.name as ClientToolName,
    label: tool.display?.label ?? formatToolLabel(tool.name),
    icon: toolIcon(tool.name as ClientToolName),
  }));
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
    case "list_csv_files":
    case "list_chartable_files":
    case "inspect_chartable_file_schema":
    case "list_reports":
    case "get_report":
    case "create_report":
    case "append_report_slide":
    case "remove_report_slide":
      return "cube";
    case "run_aggregate_query":
    case "create_csv_file":
    case "create_json_file":
      return "analytics";
    case "render_chart_from_file":
      return "chart";
    case "list_pdf_files":
    case "inspect_pdf_file":
    case "get_pdf_page_range":
    case "smart_split_pdf":
      return "document";
  }
  return "cube";
}

function buildStarterPrompts(): readonly ChatKitStarterPrompt[] {
  return [
    {
      label: "Summarize files",
      prompt: "Give me a concise summary of all attached files, including likely business meaning, key columns, and the most important first questions to investigate.",
      icon: "document",
    },
    {
      label: "Find anomalies",
      prompt: "Investigate the attached files for anomalies, outliers, or suspicious shifts. Validate the strongest ones with follow-up queries and charts before concluding.",
      icon: "analytics",
    },
    {
      label: "Suggest charts",
      prompt: "Review the attached files and suggest the most informative charts to build first. Then create the strongest ones and explain what each chart reveals.",
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
  capabilityBundle: ToolProviderBundle;
  workspaceState?: WorkspaceState;
  investigationBrief?: string;
  threadOrigin: FeedbackOrigin;
}): AppThreadMetadata {
  return {
    investigation_brief: options.investigationBrief,
    surface_key:
      typeof window !== "undefined"
        ? window.location.pathname
        : options.capabilityBundle.root_tool_provider_id,
    tool_provider_bundle: options.capabilityBundle,
    workspace_state: options.workspaceState,
    origin: options.threadOrigin,
  };
}

const FEEDBACK_ACTION_LABEL = "Feedback";

export function ChatKitHarness({
  capabilityBundle,
  files,
  workspaceState,
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
  showChatKitHeader = true,
  onToolActivity,
}: {
  capabilityBundle: ToolProviderBundle;
  files: LocalWorkspaceFile[];
  workspaceState?: WorkspaceState;
  investigationBrief: string;
  onEffects: (effects: ClientEffect[]) => void;
  onFilesAdded?: (files: LocalWorkspaceFile[]) => LocalWorkspaceFile[] | void;
  clientTools: ToolProviderClientTool[];
  headerTitle?: string;
  greeting?: string;
  prompts?: readonly ChatKitStarterPrompt[];
  composerPlaceholder?: string;
  quickActions?: ChatKitQuickAction[];
  threadOrigin?: FeedbackOrigin;
  colorScheme?: "dark" | "light";
  showDictation?: boolean;
  surfaceMinHeight?: number;
  showChatKitHeader?: boolean;
  onToolActivity?: (activity: ActiveToolInvocation | null) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [activeClientToolName, setActiveClientToolName] = useState<string | null>(null);
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
  const runningRef = useRef(false);
  const activeClientToolRef = useRef<string | null>(null);
  const finishStatusTimeoutRef = useRef<number | null>(null);
  const capabilityBundleRef = useRef(capabilityBundle);
  const workspaceStateRef = useRef(workspaceState);
  const investigationBriefRef = useRef(investigationBrief);
  const threadOriginRef = useRef(threadOrigin);

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
    activeClientToolRef.current = activeClientToolName;
  }, [activeClientToolName]);

  useEffect(() => {
    capabilityBundleRef.current = capabilityBundle;
  }, [capabilityBundle]);

  useEffect(() => {
    workspaceStateRef.current = workspaceState;
  }, [workspaceState]);

  useEffect(() => {
    investigationBriefRef.current = investigationBrief;
  }, [investigationBrief]);

  useEffect(() => {
    threadOriginRef.current = threadOrigin;
  }, [threadOrigin]);

  function clearFinishStatusTimeout() {
    if (finishStatusTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(finishStatusTimeoutRef.current);
      finishStatusTimeoutRef.current = null;
    }
  }

  function scheduleIdleStatus(nextStatus: string) {
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
        capabilityBundle: capabilityBundleRef.current,
        workspaceState: workspaceStateRef.current,
        investigationBrief: investigationBriefRef.current,
        threadOrigin: threadOriginRef.current,
      }),
    );
    return () => {
      setChatKitMetadataGetter(null);
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
  const composerTools = useMemo(
    () => listBundleComposerTools(capabilityBundle),
    [capabilityBundle],
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
        density: "compact",
        typography: {
          baseSize: 14,
        },
      },
      history: {
        enabled: true,
        showDelete: false,
        showRename: true,
      },
      threadItemActions: {
        feedback: false,
      },
      header: showChatKitHeader
        ? {
            enabled: true,
            title: {
              enabled: true,
              text: headerTitle,
            },
          }
        : {
            enabled: false,
          },
      startScreen: {
        greeting: greeting ?? "Inspect local files and create the next useful artifact.",
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
      composer: {
        placeholder:
          composerPlaceholder ??
          "Ask the agent to inspect, transform, or investigate your local files",
        attachments: {
          enabled: false,
        },
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
        })),
      },
      onReady: () => {
        clearFinishStatusTimeout();
        setStatus("Chat ready.");
        resolveScrollTarget();
        scheduleScrollToBottom(true);
      },
      onResponseStart: () => {
        clearFinishStatusTimeout();
        runningRef.current = true;
        setRunning(true);
        setStatus("Agent run in progress.");
        devLogger.responseStart({
          capabilityId: capabilityBundle.root_tool_provider_id,
          fileCount: files.length,
          running: true,
          threadId: threadIdRef.current,
        });
      },
      onResponseEnd: () => {
        runningRef.current = false;
        setRunning(false);
        scheduleScrollToBottom();
        if (activeClientToolRef.current) {
          setStatus(`Running ${formatToolLabel(activeClientToolRef.current)} locally.`);
        } else {
          scheduleIdleStatus("Agent run finished.");
        }
        devLogger.responseEnd({
          capabilityId: capabilityBundle.root_tool_provider_id,
          fileCount: files.length,
          running: false,
          threadId: threadIdRef.current,
        });
      },
      onThreadChange: ({ threadId: nextThreadId }) => {
        threadIdRef.current = nextThreadId;
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
        let appendedFileCount = 0;
        devLogger.clientToolStart({
          capabilityId: capabilityBundle.root_tool_provider_id,
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
          devLogger.clientToolSuccess({
            capabilityId: capabilityBundle.root_tool_provider_id,
            fileCount: files.length,
            threadId: threadIdRef.current,
            toolName: name,
            durationMs: Math.round(nowMs() - startedAt),
            effectCount,
            appendedFileCount,
            result,
          });
          setStatus(`Sent ${formatToolLabel(name)} back to the agent.`);
          if (!runningRef.current) {
            scheduleIdleStatus("Agent run finished.");
          }
          return result;
        } catch (error) {
          devLogger.clientToolError({
            capabilityId: capabilityBundle.root_tool_provider_id,
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
      colorScheme,
      composerPlaceholder,
      capabilityBundle.root_tool_provider_id,
      files.length,
      greeting,
      headerTitle,
      showChatKitHeader,
      showDictation,
      starterPrompts,
      threadOrigin,
      onToolActivity,
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

  async function handleProvideFeedback() {
    const busy = runningRef.current || Boolean(activeClientToolRef.current);
    if (!threadIdRef.current || busy) {
      return;
    }
    clearFinishStatusTimeout();
    setStatus("Starting feedback flow.");
    await chatKit.sendUserMessage({
      text: buildProvideFeedbackPrompt(),
      newThread: false,
    });
  }

  const isBusy = running || activeClientToolName !== null;
  const feedbackActionTitle = !threadId
    ? "Feedback is available after the first assistant response."
    : isBusy
      ? "Wait for the current run to finish before opening feedback."
      : "Open the feedback flow for the latest assistant response in this thread.";

  return (
    <ChatKitPaneHarness>
      <ChatKitPaneStatusRow data-testid="chatkit-top-row">
        <ChatKitPaneStatusActions data-testid="chatkit-header-controls">
          <ChatKitPaneToolbar data-testid="chatkit-quick-actions">
            {(quickActions ?? []).map((action) => (
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
            <ChatKitPaneFeedbackButton
              aria-label={FEEDBACK_ACTION_LABEL}
              data-testid="chatkit-provide-feedback"
              type="button"
              onClick={() => void handleProvideFeedback()}
              disabled={isBusy || !threadId}
              title={feedbackActionTitle}
            >
              {FEEDBACK_ACTION_LABEL}
            </ChatKitPaneFeedbackButton>
          </ChatKitPaneToolbar>
          <ChatKitPaneStatusText $light={colorScheme === "light"} data-testid="chatkit-status">
            {status}
          </ChatKitPaneStatusText>
        </ChatKitPaneStatusActions>
      </ChatKitPaneStatusRow>
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
  capabilityBundle,
  enabled,
  files,
  workspaceState,
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
  showPaneHeader = false,
  showDefaultModelMeta = false,
  surfaceMinHeight,
  showChatKitHeader = true,
  onToolActivity,
}: {
  capabilityBundle: ToolProviderBundle;
  enabled: boolean;
  files: LocalWorkspaceFile[];
  workspaceState?: WorkspaceState;
  investigationBrief: string;
  clientTools: ToolProviderClientTool[];
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
  showChatKitHeader?: boolean;
  onToolActivity?: (activity: ActiveToolInvocation | null) => void;
}) {
  const canInvestigate = enabled && (files.length > 0 || clientTools.length > 0);
  const resolvedMeta =
    paneMeta ??
    (canInvestigate
      ? `${files.length} file${files.length === 1 ? " is" : "s are"} ready. Start with a summary, extraction, or investigation pass.`
      : enabled
        ? "Add one or more local files to start the investigation."
        : "Sign in to start analyzing local files.");

  useEffect(() => {
    devLogger.chatKitGate({
      capabilityId: capabilityBundle.root_tool_provider_id,
      clientToolCount: clientTools.length,
      enabled,
      canInvestigate,
      fileCount: files.length,
      emptyMessage,
    });
  }, [capabilityBundle.root_tool_provider_id, canInvestigate, clientTools.length, emptyMessage, enabled, files.length]);

  return (
    <ChatKitPaneCard>
      {showPaneHeader ? (
        <>
          <ChatKitPanePill>{panePill ?? "Analyst workspace"}</ChatKitPanePill>
          <h2>{paneTitle ?? "Investigate your files"}</h2>
          <ChatKitPaneMeta>{resolvedMeta}</ChatKitPaneMeta>
        </>
      ) : null}
      {showDefaultModelMeta ? <ChatKitPaneMeta>{paneMeta ?? resolvedMeta}</ChatKitPaneMeta> : null}
      {canInvestigate ? (
        <ChatKitHarness
          capabilityBundle={capabilityBundle}
          files={files}
          workspaceState={workspaceState}
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
          showChatKitHeader={showChatKitHeader}
          onToolActivity={onToolActivity}
        />
      ) : (
        <ChatKitPaneSurface $minHeight={surfaceMinHeight} data-testid="chatkit-surface">
          <ChatKitPaneEmpty>
            {emptyMessage ?? (enabled ? "Add local files or derived artifacts to start this workspace." : "Sign in to open the workspace.")}
          </ChatKitPaneEmpty>
        </ChatKitPaneSurface>
      )}
    </ChatKitPaneCard>
  );
}
