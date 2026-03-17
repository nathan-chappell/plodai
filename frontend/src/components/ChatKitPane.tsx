import { useEffect, useMemo, useRef, useState } from "react";
import { ChatKit, type UseChatKitOptions, useChatKit } from "@openai/chatkit-react";

import { authenticatedFetch, getChatKitConfig, setChatKitMetadataGetter } from "../lib/api";
import type { CapabilityBundle, CapabilityClientTool } from "../capabilities/types";
import {
  ChatKitPaneCard,
  ChatKitPaneEmpty,
  ChatKitPaneHarnessMeta,
  ChatKitPaneMeta,
  ChatKitPanePill,
  ChatKitPaneSurface,
  ChatKitPaneToolbar,
  ChatKitPaneToolbarButton,
} from "./styles";
import type { ClientEffect, ClientToolCall, ClientToolName } from "../types/analysis";
import type { LocalWorkspaceFile } from "../types/report";

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

function toolIcon(tool: ClientToolName): "cube" | "analytics" | "chart" | "document" {
  switch (tool) {
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
}

function buildStarterPrompts(investigationBrief: string) {
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

export function ChatKitHarness({
  capabilityBundle,
  files,
  investigationBrief,
  onEffects,
  onFilesAdded,
  clientTools,
  headerTitle = "AI Portfolio",
  greeting,
  prompts,
  composerPlaceholder,
  quickActions,
  colorScheme = "dark",
  showDictation = true,
  surfaceMinHeight,
}: {
  capabilityBundle: CapabilityBundle;
  files: LocalWorkspaceFile[];
  investigationBrief: string;
  onEffects: (effects: ClientEffect[]) => void;
  onFilesAdded?: (files: LocalWorkspaceFile[]) => void;
  clientTools: CapabilityClientTool[];
  headerTitle?: string;
  greeting?: string;
  prompts?: ReadonlyArray<{ label: string; prompt: string; icon?: "document" | "analytics" | "chart" | "bolt" | "check-circle" }>;
  composerPlaceholder?: string;
  quickActions?: ChatKitQuickAction[];
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
    setChatKitMetadataGetter(() => ({
      surface_key:
        typeof window !== "undefined"
          ? window.location.pathname
          : capabilityBundle.root_capability_id,
      capability_bundle: capabilityBundle,
    }));
    return () => {
      setChatKitMetadataGetter(null);
    };
  }, [capabilityBundle]);

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
            : "Add local files to start the investigation."),
        prompts: starterPrompts.map((prompt) => ({
          label: prompt.label,
          prompt: prompt.prompt,
          icon: prompt.icon,
        })),
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
      },
      onResponseStart: () => {
        setRunning(true);
        setStatus("Agent run in progress.");
      },
      onResponseEnd: () => {
        setRunning(false);
        setStatus("Agent run finished.");
      },
      onThreadChange: ({ threadId: nextThreadId }) => {
        setThreadId(nextThreadId);
      },
      onClientTool: async ({ name, params }) => {
        const tool = clientToolsRef.current.find((candidate) => candidate.name === name);
        if (!tool) {
          throw new Error(`Unknown client tool: ${name}`);
        }
        return tool.handler(params as ClientToolCall<ClientToolName>["arguments"], {
          emitEffect: (effect) => onEffectsRef.current([effect]),
          emitEffects: (effects) => {
            if (effects.length) {
              onEffectsRef.current(effects);
            }
          },
          appendFiles: (nextFiles) => {
            if (nextFiles.length) {
              onFilesAddedRef.current?.(nextFiles);
            }
          },
        });
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
      files.length,
      greeting,
      headerTitle,
      investigationBrief,
      showDictation,
      starterPrompts,
    ],
  );

  const chatKit = useChatKit(options);

  async function handleQuickAction(action: ChatKitQuickAction) {
    const needsNewThread = !threadIdRef.current;
    setStatus(`Starting ${action.label.toLowerCase()}.`);
    await chatKit.sendUserMessage({
      text: action.prompt,
      model: action.model ?? CHATKIT_DEFAULT_MODEL_ID,
      newThread: needsNewThread,
    });
  }

  return (
    <>
      {quickActions?.length ? (
        <ChatKitPaneToolbar>
          {quickActions.map((action) => (
            <ChatKitPaneToolbarButton
              key={action.label}
              type="button"
              onClick={() => void handleQuickAction(action)}
              disabled={running}
            >
              {action.label}
            </ChatKitPaneToolbarButton>
          ))}
        </ChatKitPaneToolbar>
      ) : null}
      {status ? <ChatKitPaneHarnessMeta $light={colorScheme === "light"}>{status}</ChatKitPaneHarnessMeta> : null}
      <ChatKitPaneSurface $light={colorScheme === "light"} $minHeight={surfaceMinHeight}>
        <ChatKit control={chatKit.control} />
      </ChatKitPaneSurface>
    </>
  );
}

export function ChatKitPane({
  capabilityBundle,
  enabled,
  files,
  investigationBrief,
  clientTools,
  onEffects,
  onFilesAdded,
  headerTitle,
  greeting,
  prompts,
  composerPlaceholder,
  quickActions,
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
  investigationBrief: string;
  clientTools: CapabilityClientTool[];
  onEffects: (effects: ClientEffect[]) => void;
  onFilesAdded?: (files: LocalWorkspaceFile[]) => void;
  headerTitle?: string;
  greeting?: string;
  prompts?: ReadonlyArray<{ label: string; prompt: string; icon?: "document" | "analytics" | "chart" | "bolt" | "check-circle" }>;
  composerPlaceholder?: string;
  quickActions?: ChatKitQuickAction[];
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
  const canInvestigate = enabled && files.length > 0;
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
      {canInvestigate ? (
        <ChatKitHarness
          capabilityBundle={capabilityBundle}
          files={files}
          investigationBrief={investigationBrief}
          clientTools={clientTools}
          onEffects={onEffects}
          onFilesAdded={onFilesAdded}
          headerTitle={headerTitle}
          greeting={greeting}
          prompts={prompts}
          composerPlaceholder={composerPlaceholder}
          quickActions={quickActions}
          colorScheme={colorScheme}
          showDictation={showDictation}
          surfaceMinHeight={surfaceMinHeight}
        />
      ) : (
        <ChatKitPaneSurface $minHeight={surfaceMinHeight}>
          <ChatKitPaneEmpty>
            {emptyMessage ?? (enabled ? "The agent is ready once you add local CSV files." : "Sign in to open the analyst workspace.")}
          </ChatKitPaneEmpty>
        </ChatKitPaneSurface>
      )}
    </ChatKitPaneCard>
  );
}
