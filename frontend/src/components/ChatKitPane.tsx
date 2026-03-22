import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ChatKit, type UseChatKitOptions, useChatKit } from "@openai/chatkit-react";
import styled from "styled-components";

import {
  authenticatedFetch,
  getChatKitConfig,
  registerChatKitLocalFiles,
  setChatKitAttachmentHandler,
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
  AppThreadMetadata,
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  TourRequestedEffect,
} from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";
import type { AgentResourceRecord, ShellStateMetadata } from "../types/shell";

type ChatKitStarterPrompt = {
  label: string;
  prompt: string;
  icon?: "document" | "analytics" | "chart" | "bolt" | "check-circle";
};

export type ActiveToolInvocation = {
  name: string;
  params: Record<string, unknown>;
};

type TourSelection = {
  scenarioId: string;
  source: "default" | "upload";
  files?: File[];
};

type TourPickerActionPayload = {
  scenario_id?: string;
};

type TourScenarioSelectionHandler = (scenarioId: string) => Promise<void> | void;

type ScheduledChatPrompt = {
  id: string;
  prompt: string;
  model?: string;
  agentId: string;
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

function bindChatKitComposerFileInputs(
  host: HTMLElement | null,
  onFiles: (files: File[]) => void,
): () => void {
  if (!host || typeof MutationObserver === "undefined") {
    return () => undefined;
  }

  const cleanupByInput = new Map<HTMLInputElement, () => void>();
  let observer: MutationObserver | null = null;
  let frameId: number | null = null;
  let attempts = 0;

  const bindInput = (input: HTMLInputElement) => {
    if (cleanupByInput.has(input)) {
      return;
    }
    const handleChange = (event: Event) => {
      const files = (event.target as HTMLInputElement | null)?.files;
      if (!files?.length) {
        return;
      }
      onFiles(Array.from(files));
    };
    input.addEventListener("change", handleChange, true);
    cleanupByInput.set(input, () => {
      input.removeEventListener("change", handleChange, true);
    });
  };

  const scanInputs = (): boolean => {
    const shadowRoot = host.shadowRoot;
    if (!shadowRoot) {
      return false;
    }
    shadowRoot.querySelectorAll("input[type='file']").forEach((node) => {
      if (node instanceof HTMLInputElement) {
        bindInput(node);
      }
    });
    return true;
  };

  const startObserving = () => {
    const shadowRoot = host.shadowRoot;
    if (!shadowRoot) {
      return false;
    }
    observer = new MutationObserver(() => {
      scanInputs();
    });
    observer.observe(shadowRoot, {
      childList: true,
      subtree: true,
    });
    return true;
  };

  const connect = () => {
    attempts += 1;
    if (scanInputs()) {
      startObserving();
      return;
    }
    if (typeof window === "undefined" || attempts >= 24) {
      return;
    }
    frameId = window.requestAnimationFrame(connect);
  };

  connect();

  return () => {
    if (frameId !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(frameId);
    }
    observer?.disconnect();
    for (const cleanup of cleanupByInput.values()) {
      cleanup();
    }
  };
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

function toolIcon(tool: ClientToolName): "cube" | "analytics" | "chart" | "document" {
  switch (tool) {
    case "list_tour_scenarios":
    case "launch_tour_scenario":
    case "list_datasets":
    case "inspect_dataset_schema":
    case "list_reports":
    case "get_report":
    case "create_report":
    case "append_report_slide":
    case "remove_report_slide":
    case "list_image_files":
    case "inspect_image_file":
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
      return "document";
  }
  return "cube";
}

function buildStarterPrompts(): readonly ChatKitStarterPrompt[] {
  return [
    {
      label: "Summarize files",
      prompt: "Give me a concise summary of all workspace files, including likely business meaning, key columns, and the most important first questions to investigate.",
      icon: "document",
    },
    {
      label: "Find anomalies",
      prompt: "Investigate the workspace files for anomalies, outliers, or suspicious shifts. Validate the strongest ones with follow-up queries and charts before concluding.",
      icon: "analytics",
    },
    {
      label: "Suggest charts",
      prompt: "Review the workspace files and suggest the most informative charts to build first. Then create the strongest ones and explain what each chart reveals.",
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
  shellState?: ShellStateMetadata;
  investigationBrief?: string;
  threadOrigin: FeedbackOrigin;
}): AppThreadMetadata {
  return {
    investigation_brief: options.investigationBrief,
    surface_key:
      typeof window !== "undefined"
        ? window.location.pathname
        : options.agentBundle.root_agent_id,
    agent_bundle: options.agentBundle,
    shell_state: options.shellState,
    origin: options.threadOrigin,
  };
}

export function ChatKitHarness({
  agentBundle,
  files,
  shellState,
  investigationBrief,
  onEffects,
  onSelectAgent,
  defaultAgentId,
  onReplaceAgentResources,
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
  showComposerTools = true,
  composerToolIds,
  onToolActivity,
  onRunStart,
  attachmentConfig,
  onAddAttachments,
  onRemoveAgentResource,
  onSelectTourScenario,
  tourLauncher,
  onDismissTourLauncher,
  onSubmitTourSelection,
  scheduledPrompt,
  onScheduledPromptDispatched,
}: {
  agentBundle: AgentBundle;
  files: LocalWorkspaceFile[];
  shellState?: ShellStateMetadata;
  investigationBrief: string;
  onEffects: (effects: ClientEffect[]) => void;
  onSelectAgent?: (agentId: string) => void;
  defaultAgentId?: string;
  onReplaceAgentResources?: (agentId: string, resources: AgentResourceRecord[]) => void;
  clientTools: AgentClientTool[];
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
  showComposerTools?: boolean;
  composerToolIds?: string[];
  onToolActivity?: (activity: ActiveToolInvocation | null) => void;
  onRunStart?: () => void;
  attachmentConfig?: AgentAttachmentConfig;
  onAddAttachments?: (
    agentId: string,
    files: FileList | Iterable<File> | null | undefined,
  ) => Promise<LocalWorkspaceFile[]>;
  onRemoveAgentResource?: (agentId: string, resourceId: string) => void;
  onSelectTourScenario?: TourScenarioSelectionHandler;
  tourLauncher?: TourRequestedEffect | null;
  onDismissTourLauncher?: () => void;
  onSubmitTourSelection?: (selection: TourSelection) => Promise<void>;
  scheduledPrompt?: ScheduledChatPrompt | null;
  onScheduledPromptDispatched?: (promptId: string) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [activeClientToolName, setActiveClientToolName] = useState<string | null>(null);
  const [submittingTour, setSubmittingTour] = useState(false);
  const onEffectsRef = useRef(onEffects);
  const onSelectAgentRef = useRef(onSelectAgent);
  const onReplaceAgentResourcesRef = useRef(onReplaceAgentResources);
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
  const shellStateRef = useRef(shellState);
  const investigationBriefRef = useRef(investigationBrief);
  const threadOriginRef = useRef(threadOrigin);
  const onAddAttachmentsRef = useRef(onAddAttachments);
  const onRemoveAgentResourceRef = useRef(onRemoveAgentResource);
  const tourLauncherInputRef = useRef<HTMLInputElement | null>(null);
  const dispatchingScheduledPromptIdRef = useRef<string | null>(null);
  const pendingDefaultAgentResetRef = useRef(false);

  useEffect(() => {
    onEffectsRef.current = onEffects;
  }, [onEffects]);

  useEffect(() => {
    clientToolsRef.current = clientTools;
  }, [clientTools]);

  useEffect(() => {
    onSelectAgentRef.current = onSelectAgent;
  }, [onSelectAgent]);

  useEffect(() => {
    onReplaceAgentResourcesRef.current = onReplaceAgentResources;
  }, [onReplaceAgentResources]);

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
    shellStateRef.current = shellState;
  }, [shellState]);

  useEffect(() => {
    investigationBriefRef.current = investigationBrief;
  }, [investigationBrief]);

  useEffect(() => {
    threadOriginRef.current = threadOrigin;
  }, [threadOrigin]);

  useEffect(() => {
    onAddAttachmentsRef.current = onAddAttachments;
  }, [onAddAttachments]);

  useEffect(() => {
    onRemoveAgentResourceRef.current = onRemoveAgentResource;
  }, [onRemoveAgentResource]);

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
        shellState: shellStateRef.current,
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

  useEffect(() => {
    if (!attachmentConfig?.enabled) {
      setChatKitAttachmentHandler(null);
      return;
    }

    setChatKitAttachmentHandler(
      async ({ attachmentId, file }) => {
        const agentId = agentBundleRef.current.root_agent_id;
        const builtFiles = (await onAddAttachmentsRef.current?.(agentId, [file])) ?? [];
        return {
          agentId,
          resourceIds: builtFiles.map((builtFile) => builtFile.id),
        };
      },
      (record) => {
        for (const resourceId of record.resourceIds) {
          onRemoveAgentResourceRef.current?.(record.agentId, resourceId);
        }
      },
    );

    return () => {
      setChatKitAttachmentHandler(null);
    };
  }, [attachmentConfig?.enabled]);

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
        feedback: true,
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
          if (action.type === "submit_tour_picker") {
            const scenarioId =
              typeof (action.payload as TourPickerActionPayload | undefined)?.scenario_id ===
              "string"
                ? (action.payload as TourPickerActionPayload).scenario_id?.trim()
                : "";
            if (scenarioId) {
              await handleTourScenarioSelection(scenarioId);
            }
            await chatKitRef.current?.sendCustomAction(action, widgetItem.id);
            return;
          }

          await chatKitRef.current?.sendCustomAction(action, widgetItem.id);
          if (
            action.type !== "submit_feedback_session" &&
            action.type !== "cancel_tour_picker"
          ) {
            return;
          }
          if (action.type === "cancel_tour_picker") {
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
        scheduleScrollToBottom();
        if (activeClientToolRef.current) {
          setStatus(`Running ${formatToolLabel(activeClientToolRef.current)} locally.`);
        } else {
          scheduleIdleStatus(null);
        }
        if (
          pendingDefaultAgentResetRef.current &&
          defaultAgentId &&
          agentBundleRef.current.root_agent_id !== defaultAgentId
        ) {
          pendingDefaultAgentResetRef.current = false;
          onSelectAgentRef.current?.(defaultAgentId);
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
        autoScrollEnabledRef.current = true;
        resolveScrollTarget();
        scheduleScrollToBottom(true);
      },
      onThreadLoadEnd: () => {
        resolveScrollTarget();
        scheduleScrollToBottom(true);
      },
      onToolChange: ({ toolId }) => {
        if (!toolId) {
          pendingDefaultAgentResetRef.current = Boolean(defaultAgentId);
          return;
        }
        pendingDefaultAgentResetRef.current = false;
        if (!composerTools.some((tool) => tool.id === toolId)) {
          return;
        }
        onSelectAgentRef.current?.(toolId);
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
            selectAgent: (agentId) => {
              onSelectAgentRef.current?.(agentId);
            },
            replaceAgentResources: (agentId, resources) => {
              onReplaceAgentResourcesRef.current?.(agentId, resources);
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
          setStatus(`Sent ${formatToolLabel(name)} back to the agent.`);
          if (!runningRef.current) {
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
      colorScheme,
      composerPlaceholder,
      attachmentConfig?.enabled,
      agentBundle.root_agent_id,
      defaultAgentId,
      files.length,
      greeting,
      headerTitle,
      showChatKitHeader,
      showDictation,
      starterPrompts,
      threadOrigin,
      onToolActivity,
      onRunStart,
    ],
  );

  const chatKit = useChatKit(options);

  useEffect(() => {
    chatKitRef.current = chatKit;
  }, [chatKit]);

  useEffect(() => {
    if (!attachmentConfig?.enabled) {
      return;
    }
    return bindChatKitComposerFileInputs(
      chatKit.ref.current,
      registerChatKitLocalFiles,
    );
  }, [attachmentConfig?.enabled, chatKit]);

  useEffect(() => {
    if (
      !scheduledPrompt ||
      scheduledPrompt.agentId !== agentBundle.root_agent_id ||
      running ||
      activeClientToolName !== null ||
      dispatchingScheduledPromptIdRef.current === scheduledPrompt.id
    ) {
      return;
    }
    dispatchingScheduledPromptIdRef.current = scheduledPrompt.id;
    clearFinishStatusTimeout();
    setStatus("Continuing in the guided tour.");
    void chatKit
      .sendUserMessage({
        text: scheduledPrompt.prompt,
        model: scheduledPrompt.model ?? CHATKIT_DEFAULT_MODEL_ID,
        newThread: true,
      })
      .finally(() => {
        dispatchingScheduledPromptIdRef.current = null;
        onScheduledPromptDispatched?.(scheduledPrompt.id);
      });
  }, [
    activeClientToolName,
    agentBundle.root_agent_id,
    chatKit,
    onScheduledPromptDispatched,
    running,
    scheduledPrompt,
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

  async function submitTourSelection(selection: TourSelection) {
    if (!onSubmitTourSelection) {
      return;
    }
    clearFinishStatusTimeout();
    setSubmittingTour(true);
    setStatus(
      selection.source === "default"
        ? "Loading the built-in tour files."
        : "Preparing the uploaded tour files.",
    );
    try {
      await onSubmitTourSelection(selection);
      setStatus("Tour workspace is ready. Continuing automatically.");
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Unable to start the guided tour.";
      setStatus(message);
      throw error;
    } finally {
      setSubmittingTour(false);
    }
  }

  async function handleTourFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = "";
    if (!tourLauncher || !nextFiles.length) {
      return;
    }
    try {
      await submitTourSelection({
        scenarioId: tourLauncher.scenarioId,
        source: "upload",
        files: nextFiles,
      });
    } catch {
      // Status is already updated in submitTourSelection.
    }
  }

  async function handleTourScenarioSelection(scenarioId: string) {
    if (!onSelectTourScenario) {
      return;
    }
    clearFinishStatusTimeout();
    setSubmittingTour(true);
    setStatus("Opening the guided tour launcher.");
    try {
      await onSelectTourScenario(scenarioId);
      setStatus("Guided tour launcher is ready.");
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Unable to open the guided tour launcher.";
      setStatus(message);
      throw error;
    } finally {
      setSubmittingTour(false);
    }
  }

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
    submittingTour ||
    dispatchingScheduledPromptIdRef.current !== null;
  const quickActionList = quickActions ?? [];
  const hasStatusChrome = quickActionList.length > 0 || Boolean(status);
  const tourAccept = tourLauncher
    ? acceptMapToInputValue(tourLauncher.uploadConfig.accept)
    : undefined;

  return (
    <ChatKitPaneHarness>
      {tourLauncher ? (
        <input
          ref={tourLauncherInputRef}
          accept={tourAccept}
          data-testid="chatkit-tour-file-input"
          multiple={tourLauncher.uploadConfig.max_count > 1}
          onChange={(event) => void handleTourFileChange(event)}
          type="file"
          hidden
        />
      ) : null}
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
      {tourLauncher ? (
        <TourLauncherCard data-testid="chatkit-tour-launcher">
          <TourLauncherEyebrow>Guided Tour</TourLauncherEyebrow>
          <TourLauncherTitle>{tourLauncher.title}</TourLauncherTitle>
          <TourLauncherSummary>{tourLauncher.summary}</TourLauncherSummary>
          <TourLauncherMeta>
            {tourLauncher.uploadConfig.helper_text}
          </TourLauncherMeta>
          <TourLauncherMeta>
            Built-in default: {tourLauncher.defaultAssetCount} file
            {tourLauncher.defaultAssetCount === 1 ? "" : "s"}.
          </TourLauncherMeta>
          <TourLauncherActions>
            <TourLauncherButton
              disabled={isBusy}
              onClick={() => {
                tourLauncherInputRef.current?.click();
              }}
              type="button"
            >
              Upload your own file(s)
            </TourLauncherButton>
            <TourLauncherButton
              disabled={isBusy}
              onClick={() => {
                void submitTourSelection({
                  scenarioId: tourLauncher.scenarioId,
                  source: "default",
                }).catch(() => undefined);
              }}
              type="button"
            >
              Use built-in default
            </TourLauncherButton>
            <TourLauncherButton
              disabled={isBusy}
              onClick={onDismissTourLauncher}
              type="button"
            >
              Cancel
            </TourLauncherButton>
          </TourLauncherActions>
        </TourLauncherCard>
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
  shellState,
  investigationBrief,
  clientTools,
  onEffects,
  onSelectAgent,
  defaultAgentId,
  onReplaceAgentResources,
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
  showComposerTools = true,
  composerToolIds,
  onToolActivity,
  onRunStart,
  attachmentConfig,
  onAddAttachments,
  onRemoveAgentResource,
  onSelectTourScenario,
  tourLauncher,
  onDismissTourLauncher,
  onSubmitTourSelection,
  scheduledPrompt,
  onScheduledPromptDispatched,
}: {
  agentBundle: AgentBundle;
  enabled: boolean;
  files: LocalWorkspaceFile[];
  shellState?: ShellStateMetadata;
  investigationBrief: string;
  clientTools: AgentClientTool[];
  onEffects: (effects: ClientEffect[]) => void;
  onSelectAgent?: (agentId: string) => void;
  defaultAgentId?: string;
  onReplaceAgentResources?: (agentId: string, resources: AgentResourceRecord[]) => void;
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
  showComposerTools?: boolean;
  composerToolIds?: string[];
  onToolActivity?: (activity: ActiveToolInvocation | null) => void;
  onRunStart?: () => void;
  attachmentConfig?: AgentAttachmentConfig;
  onAddAttachments?: (
    agentId: string,
    files: FileList | Iterable<File> | null | undefined,
  ) => Promise<LocalWorkspaceFile[]>;
  onRemoveAgentResource?: (agentId: string, resourceId: string) => void;
  onSelectTourScenario?: TourScenarioSelectionHandler;
  tourLauncher?: TourRequestedEffect | null;
  onDismissTourLauncher?: () => void;
  onSubmitTourSelection?: (selection: TourSelection) => Promise<void>;
  scheduledPrompt?: ScheduledChatPrompt | null;
  onScheduledPromptDispatched?: (promptId: string) => void;
}) {
  const canInvestigate =
    enabled &&
    (
      files.length > 0 ||
      clientTools.length > 0 ||
      attachmentConfig?.enabled === true ||
      tourLauncher != null
    );
  const resolvedMeta =
    paneMeta ??
    (canInvestigate
      ? files.length > 0
        ? `${files.length} file${files.length === 1 ? " is" : "s are"} ready. Start with a summary, extraction, or investigation pass.`
        : attachmentConfig?.enabled
          ? "Attach one or more files to prepare this workspace."
          : "Start with a summary, extraction, or investigation pass."
      : enabled
        ? attachmentConfig?.enabled
          ? "Attach one or more files to start the investigation."
          : "Add one or more local files to start the investigation."
        : "Sign in to start analyzing local files.");

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
          <h2>{paneTitle ?? "Investigate your files"}</h2>
          <ChatKitPaneMeta>{resolvedMeta}</ChatKitPaneMeta>
        </>
      ) : null}
      {showDefaultModelMeta ? <ChatKitPaneMeta>{paneMeta ?? resolvedMeta}</ChatKitPaneMeta> : null}
      {canInvestigate ? (
        <ChatKitHarness
          agentBundle={agentBundle}
          files={files}
          shellState={shellState}
          investigationBrief={investigationBrief}
          clientTools={clientTools}
          onEffects={onEffects}
          onSelectAgent={onSelectAgent}
          defaultAgentId={defaultAgentId}
          onReplaceAgentResources={onReplaceAgentResources}
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
          showComposerTools={showComposerTools}
          composerToolIds={composerToolIds}
          onToolActivity={onToolActivity}
          onRunStart={onRunStart}
          attachmentConfig={attachmentConfig}
          onAddAttachments={onAddAttachments}
          onRemoveAgentResource={onRemoveAgentResource}
          onSelectTourScenario={onSelectTourScenario}
          tourLauncher={tourLauncher}
          onDismissTourLauncher={onDismissTourLauncher}
          onSubmitTourSelection={onSubmitTourSelection}
          scheduledPrompt={scheduledPrompt}
          onScheduledPromptDispatched={onScheduledPromptDispatched}
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

const TourLauncherCard = styled.section`
  display: grid;
  gap: 0.45rem;
  padding: 0.8rem 0.9rem;
  border-radius: 18px;
  border: 1px solid rgba(31, 41, 55, 0.1);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 242, 235, 0.88)),
    rgba(255, 255, 255, 0.84);
  box-shadow: 0 14px 32px rgba(32, 26, 20, 0.08);
`;

const TourLauncherEyebrow = styled.div`
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const TourLauncherTitle = styled.h3`
  margin: 0;
  font-size: 1rem;
  line-height: 1.1;
  color: var(--ink);
`;

const TourLauncherSummary = styled.p`
  margin: 0;
  color: var(--ink);
  font-size: 0.82rem;
  line-height: 1.45;
`;

const TourLauncherMeta = styled.p`
  margin: 0;
  color: var(--muted);
  font-size: 0.74rem;
  line-height: 1.45;
`;

const TourLauncherActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.12rem;
`;

const TourLauncherButton = styled.button`
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: 999px;
  padding: 0.5rem 0.85rem;
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;

  &:hover:enabled {
    transform: translateY(-1px);
    background: rgba(255, 255, 255, 0.98);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`;
