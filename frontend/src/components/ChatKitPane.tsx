import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { ChatKit, type UseChatKitOptions, useChatKit } from "@openai/chatkit-react";

import { DatasetChart } from "./DatasetChart";
import { authenticatedFetch, getChatKitConfig } from "../lib/api";
import { executeClientTool } from "../lib/chatkit-tools";
import { buildInitialThreadMetadata, buildThreadMetadataUpdateAction } from "../lib/thread-metadata";
import type {
  AppThreadMetadata,
  ChartRenderedEffect,
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  DataRow,
} from "../types/analysis";
import type { DatasetSummary, LocalDataset } from "../types/report";
import { emptyStateCss } from "../ui/primitives";

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
const CHATKIT_TOOLS: ClientToolName[] = ["list_attached_csv_files", "run_aggregate_query", "request_chart_render"];

const Card = styled.section`
  position: sticky;
  top: 1.5rem;
  background: linear-gradient(135deg, rgba(44, 62, 80, 0.96), rgba(26, 36, 47, 0.98));
  color: #f8f6f2;
  border-radius: var(--radius-xl);
  padding: 1.15rem;
  box-shadow: var(--shadow);
  display: grid;
  gap: 0.9rem;
`;

const Meta = styled.p`
  margin: 0;
  color: rgba(248, 246, 242, 0.74);
  line-height: 1.6;
`;

const Pill = styled.div`
  display: inline-flex;
  width: fit-content;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const Surface = styled.div`
  min-height: 560px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
`;

const Empty = styled.div`
  ${emptyStateCss};
  min-height: 560px;
  color: rgba(248, 246, 242, 0.74);
  padding: 1.5rem;
`;

const EffectPanel = styled.div`
  display: grid;
  gap: 0.8rem;
`;

const EffectCard = styled.div`
  background: rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 0.9rem;
`;

function isChartRenderedEffect(effect: ClientEffect): effect is ChartRenderedEffect {
  return effect.type === "chart_rendered";
}

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

function ConfiguredChatKit({
  datasets,
  investigationBrief,
  onEffects,
}: {
  datasets: LocalDataset[];
  investigationBrief: string;
  onEffects: (effects: ClientEffect[]) => void;
}) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const loadedDatasets = useMemo(
    () => datasets.map((dataset) => ({ ...dataset, rows: (dataset.rows as DataRow[]) ?? dataset.sample_rows })),
    [datasets],
  );

  const metadata = useMemo<AppThreadMetadata>(
    () =>
      buildInitialThreadMetadata({
        title: investigationBrief.trim()
          ? investigationBrief.trim().slice(0, 80)
          : datasets.length
            ? `Analysis of ${datasets.length} datasets`
            : "New report",
        investigation_brief: investigationBrief.trim() || undefined,
        dataset_ids: datasets.map((dataset) => dataset.id),
        datasets,
      }),
    [datasets, investigationBrief],
  );

  const starterPrompts = useMemo(() => buildStarterPrompts(investigationBrief), [investigationBrief]);

  const options = useMemo<UseChatKitOptions>(
    () => ({
      api: {
        url: getChatKitConfig().url,
        domainKey: getChatKitConfig().domainKey,
        fetch: authenticatedFetch,
      },
      theme: {
        colorScheme: "dark",
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
          text: "Report Foundry",
        },
      },
      startScreen: {
        greeting: datasets.length
          ? `Investigate ${datasets.length} attached file${datasets.length === 1 ? "" : "s"}.`
          : "Add CSV files to start the investigation.",
        prompts: starterPrompts.map((prompt) => ({
          label: prompt.label,
          prompt: prompt.prompt,
          icon: prompt.icon,
        })),
      },
      composer: {
        placeholder: investigationBrief.trim()
          ? `Work toward this goal: ${investigationBrief.trim().slice(0, 80)}`
          : "Ask the analyst to summarize, compare, or investigate your CSV files",
        attachments: {
          enabled: false,
        },
        models: CHATKIT_MODEL_CHOICES.map((choice) => ({
          ...choice,
          default: choice.id === CHATKIT_DEFAULT_MODEL_ID,
        })),
        tools: CHATKIT_TOOLS.map((tool) => ({
          id: tool,
          label: formatToolLabel(tool),
          icon: toolIcon(tool),
        })),
      },
      onClientTool: async ({ name, params }) => {
        const result = await executeClientTool(
          {
            name: name as ClientToolName,
            arguments: params as ClientToolCall<ClientToolName>["arguments"],
          },
          loadedDatasets,
        );
        if (result.effects.length) {
          onEffects(result.effects);
        }
        return result.payload;
      },
      onEffect: (event) => {
        if (event.name !== "chart_rendered" || !event.data) {
          return;
        }
        onEffects([event.data as ClientEffect]);
      },
      onThreadChange: ({ threadId }) => {
        setActiveThreadId(threadId);
      },
    }),
    [investigationBrief, loadedDatasets, onEffects, starterPrompts, datasets.length],
  );

  const chatKit = useChatKit(options);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }

    void chatKit.sendCustomAction(
      buildThreadMetadataUpdateAction({
        title: metadata.title,
        investigation_brief: metadata.investigation_brief,
        dataset_ids: metadata.dataset_ids,
        datasets: metadata.datasets,
      }),
    );
  }, [activeThreadId, chatKit, metadata]);

  return <ChatKit control={chatKit.control} />;
}

export function ChatKitPane({
  enabled,
  datasets,
  investigationBrief,
}: {
  enabled: boolean;
  datasets: LocalDataset[];
  investigationBrief: string;
}) {
  const [effects, setEffects] = useState<ClientEffect[]>([]);
  const canInvestigate = enabled && datasets.length > 0;

  return (
    <Card>
      <Pill>Analyst workspace</Pill>
      <h2>Investigate your CSV files</h2>
      <Meta>
        {canInvestigate
          ? `${datasets.length} CSV file${datasets.length === 1 ? " is" : "s are"} ready. ${investigationBrief.trim() ? `Current goal: ${investigationBrief.trim()}` : "Start with a summary, comparison, or anomaly hunt."}`
          : enabled
            ? "Add one or more CSV files to start the investigation."
            : "Sign in to start analyzing local CSV files."}
      </Meta>
      <Meta>Default model capability: {CHATKIT_DEFAULT_MODEL_LABEL}</Meta>
      <Surface>
        {canInvestigate ? (
          <ConfiguredChatKit
            datasets={datasets}
            investigationBrief={investigationBrief}
            onEffects={(nextEffects) => setEffects((current) => [...nextEffects, ...current].slice(0, 6))}
          />
        ) : (
          <Empty>
            {enabled
              ? "The agent is ready once you add local CSV files."
              : "Sign in to open the analyst workspace."}
          </Empty>
        )}
      </Surface>
      {effects.length ? (
        <EffectPanel>
          {effects.map((effect, index) => (
            <EffectCard key={`${effect.type}-${index}`}>
              {isChartRenderedEffect(effect) ? <DatasetChart spec={effect.chart} rows={effect.rows} /> : <Meta>{effect.type}</Meta>}
            </EffectCard>
          ))}
        </EffectPanel>
      ) : null}
    </Card>
  );
}



