import { useEffect, useMemo, useRef, useState } from "react";
import { ChatKit, type UseChatKitOptions, useChatKit } from "@openai/chatkit-react";

import { authenticatedFetch, getChatKitConfig } from "../lib/api";
import type { CapabilityClientTool } from "../capabilities/types";
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
import type { ClientEffect, ClientToolCall, ClientToolName, DataRow } from "../types/analysis";
import type { LocalDataset } from "../types/report";

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
const FALLBACK_CHATKIT_TOOLS: ClientToolName[] = ["list_attached_csv_files", "run_aggregate_query", "request_chart_render"];
const REGISTER_CLIENT_TOOLS_ACTION = "register_client_tools";

function formatToolLabel(tool: string): string {
  return tool
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toolIcon(tool: ClientToolName): "cube" | "analytics" | "chart" {
  switch (tool) {
    case "list_attached_csv_files":
      return "cube";
    case "run_aggregate_query":
      return "analytics";
    case "request_chart_render":
      return "chart";
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
  capabilityId,
  datasets,
  investigationBrief,
  onEffects,
  clientTools,
  headerTitle = "AI Portfolio",
  greeting,
  prompts,
  composerPlaceholder,
  quickActions,
  colorScheme = "dark",
  showDictation = true,
}: {
  capabilityId: string;
  datasets: LocalDataset[];
  investigationBrief: string;
  onEffects: (effects: ClientEffect[]) => void;
  clientTools: CapabilityClientTool[];
  headerTitle?: string;
  greeting?: string;
  prompts?: ReadonlyArray<{ label: string; prompt: string; icon?: "document" | "analytics" | "chart" | "bolt" | "check-circle" }>;
  composerPlaceholder?: string;
  quickActions?: ChatKitQuickAction[];
  colorScheme?: "dark" | "light";
  showDictation?: boolean;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);

  const loadedDatasets = useMemo(
    () => datasets.map((dataset) => ({ ...dataset, rows: (dataset.rows as DataRow[]) ?? dataset.sample_rows })),
    [datasets],
  );
  const loadedDatasetsRef = useRef(loadedDatasets);
  const onEffectsRef = useRef(onEffects);
  const clientToolsRef = useRef(clientTools);
  const registeredCatalogRef = useRef<string | null>(null);

  useEffect(() => {
    loadedDatasetsRef.current = loadedDatasets;
  }, [loadedDatasets]);

  useEffect(() => {
    onEffectsRef.current = onEffects;
  }, [onEffects]);

  useEffect(() => {
    clientToolsRef.current = clientTools;
  }, [clientTools]);

  const starterPrompts = useMemo(
    () => prompts ?? buildStarterPrompts(investigationBrief),
    [investigationBrief, prompts],
  );
  const chatKitTools = useMemo(
    () => (clientTools.length ? clientTools.map((tool) => tool.name as ClientToolName) : FALLBACK_CHATKIT_TOOLS),
    [clientTools],
  );
  const clientToolCatalog = useMemo(
    () =>
      clientTools.map(({ handler: _handler, ...tool }) => ({
        ...tool,
        strict: tool.strict ?? true,
      })),
    [clientTools],
  );
  const clientToolCatalogKey = useMemo(
    () => JSON.stringify({ capabilityId, tools: clientToolCatalog }),
    [capabilityId, clientToolCatalog],
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
          (datasets.length
            ? `Investigate ${datasets.length} attached file${datasets.length === 1 ? "" : "s"}.`
            : "Add CSV files to start the investigation."),
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
            : "Ask the analyst to summarize, compare, or investigate your CSV files"),
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
        });
      },
      onEffect: (event) => {
        if (!event.data) {
          return;
        }
        if (event.name !== "chart_rendered" && event.name !== "report_section_appended") {
          return;
        }
        onEffectsRef.current([event.data as ClientEffect]);
      },
    }),
    [
      chatKitTools,
      colorScheme,
      composerPlaceholder,
      datasets.length,
      greeting,
      headerTitle,
      investigationBrief,
      showDictation,
      starterPrompts,
    ],
  );

  const chatKit = useChatKit(options);

  useEffect(() => {
    if (!threadId || !clientToolCatalog.length) {
      return;
    }
    const registrationKey = `${threadId}:${clientToolCatalogKey}`;
    if (registeredCatalogRef.current === registrationKey) {
      return;
    }
    registeredCatalogRef.current = registrationKey;
    void chatKit
      .sendCustomAction({
        type: REGISTER_CLIENT_TOOLS_ACTION,
        payload: {
          capability_id: capabilityId,
          client_tools: clientToolCatalog,
        },
      })
      .then(() => setStatus("Client tools registered for this capability."))
      .catch((error) => {
        registeredCatalogRef.current = null;
        setStatus(error instanceof Error ? error.message : "Unable to register client tools.");
      });
  }, [capabilityId, chatKit, clientToolCatalog, clientToolCatalogKey, threadId]);

  async function handleQuickAction(action: ChatKitQuickAction) {
    setStatus(`Starting ${action.label.toLowerCase()}.`);
    await chatKit.sendUserMessage({
      text: action.prompt,
      model: action.model ?? CHATKIT_DEFAULT_MODEL_ID,
      newThread: true,
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
      <ChatKitPaneSurface $light={colorScheme === "light"}>
        <ChatKit control={chatKit.control} />
      </ChatKitPaneSurface>
    </>
  );
}

export function ChatKitPane({
  capabilityId,
  enabled,
  datasets,
  investigationBrief,
  clientTools,
  onEffects,
}: {
  capabilityId: string;
  enabled: boolean;
  datasets: LocalDataset[];
  investigationBrief: string;
  clientTools: CapabilityClientTool[];
  onEffects: (effects: ClientEffect[]) => void;
}) {
  const canInvestigate = enabled && datasets.length > 0;

  return (
    <ChatKitPaneCard>
      <ChatKitPanePill>Analyst workspace</ChatKitPanePill>
      <h2>Investigate your CSV files</h2>
      <ChatKitPaneMeta>
        {canInvestigate
          ? `${datasets.length} CSV file${datasets.length === 1 ? " is" : "s are"} ready. ${investigationBrief.trim() ? `Current goal: ${investigationBrief.trim()}` : "Start with a summary, comparison, or anomaly hunt."}`
          : enabled
            ? "Add one or more CSV files to start the investigation."
            : "Sign in to start analyzing local CSV files."}
      </ChatKitPaneMeta>
      <ChatKitPaneMeta>Default model capability: {CHATKIT_DEFAULT_MODEL_LABEL}</ChatKitPaneMeta>
      {canInvestigate ? (
        <ChatKitHarness
          capabilityId={capabilityId}
          datasets={datasets}
          investigationBrief={investigationBrief}
          clientTools={clientTools}
          onEffects={onEffects}
        />
      ) : (
        <ChatKitPaneSurface>
          <ChatKitPaneEmpty>
            {enabled
              ? "The agent is ready once you add local CSV files."
              : "Sign in to open the analyst workspace."}
          </ChatKitPaneEmpty>
        </ChatKitPaneSurface>
      )}
    </ChatKitPaneCard>
  );
}
