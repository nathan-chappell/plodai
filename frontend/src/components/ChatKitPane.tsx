import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { ChatKit, type UseChatKitOptions, useChatKit } from "@openai/chatkit-react";

import { DatasetChart } from "./DatasetChart";
import { authenticatedFetch, getChatKitConfig } from "../lib/api";
import { executeClientTool } from "../lib/chatkit-tools";
import { buildInitialThreadMetadata, buildThreadMetadataUpdateAction } from "../lib/thread-metadata";
import type { AppThreadMetadata, ChartRenderedEffect, ClientEffect, ClientToolCall, ClientToolName, DataRow } from "../types/analysis";
import type { DatasetSummary } from "../types/report";
import { emptyStateCss } from "../ui/primitives";

const CHATKIT_MODEL_ID = import.meta.env.VITE_CHATKIT_MODEL ?? "default";
const CHATKIT_MODEL_LABEL = import.meta.env.VITE_CHATKIT_MODEL_LABEL ?? "Foundry Analyst";
const CHATKIT_NOTES = [
  "Always stream agent responses.",
  "The agent should explore, compare segments, validate anomalies, and draft findings proactively.",
  "Client chart rendering returns both structured chart data and a rendered image for follow-up reasoning.",
  "Thread metadata carries dataset summaries and other app state for the active conversation.",
] as const;
const CHATKIT_TOOLS: ClientToolName[] = ["list_accessible_datasets", "run_aggregate_query", "request_chart_render"];

const Card = styled.section`
  background: linear-gradient(135deg, rgba(44, 62, 80, 0.94), rgba(26, 36, 47, 0.96));
  color: #f8f6f2;
  border-radius: var(--radius-xl);
  padding: 1.3rem;
  box-shadow: var(--shadow);
  display: grid;
  gap: 0.9rem;
  min-height: 540px;
`;

const Meta = styled.p`
  margin: 0;
  color: rgba(248, 246, 242, 0.74);
  line-height: 1.65;
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

const List = styled.ul`
  margin: 0;
  padding-left: 1.1rem;
  color: rgba(248, 246, 242, 0.88);
  display: grid;
  gap: 0.45rem;
`;

const Surface = styled.div`
  min-height: 360px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
`;

const Empty = styled.div`
  ${emptyStateCss};
  min-height: 360px;
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



function formatToolLabel(tool: string): string {
  return tool
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toolIcon(tool: ClientToolName): "cube" | "analytics" | "chart" {
  switch (tool) {
    case "list_accessible_datasets":
      return "cube";
    case "run_aggregate_query":
      return "analytics";
    case "request_chart_render":
      return "chart";
  }
}

function isChartRenderedEffect(effect: ClientEffect): effect is ChartRenderedEffect {
  return effect.type === "chart_rendered";
}

function ConfiguredChatKit({ datasets, onEffects }: { datasets: DatasetSummary[]; onEffects: (effects: ClientEffect[]) => void }) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const loadedDatasets = useMemo(
    () => datasets.map((dataset) => ({ ...dataset, rows: dataset.sample_rows as DataRow[] })),
    [datasets],
  );

  const metadata = useMemo<AppThreadMetadata>(
    () =>
      buildInitialThreadMetadata({
        title: datasets.length ? `Analysis of ${datasets.length} datasets` : "New report",
        dataset_ids: datasets.map((dataset) => dataset.id),
        datasets,
      }),
    [datasets],
  );

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
        greeting: "What should we investigate in these CSVs?",
        prompts: [
          {
            label: "Find anomalies",
            prompt: "Explore the uploaded datasets, find meaningful anomalies, validate them, and build a concise report.",
            icon: "analytics",
          },
          {
            label: "Compare segments",
            prompt: "Compare the most important segments in the uploaded datasets and explain the strongest differences.",
            icon: "chart",
          },
          {
            label: "Executive summary",
            prompt: "Investigate the uploaded datasets thoroughly and prepare an executive summary with charts and caveats.",
            icon: "sparkle",
          },
        ],
      },
      composer: {
        placeholder: "Ask the analyst to investigate your datasets",
        models: [
          {
            id: CHATKIT_MODEL_ID,
            label: CHATKIT_MODEL_LABEL,
            description: "Exploratory CSV analyst",
            default: true,
          },
        ],
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
    [loadedDatasets, onEffects],
  );

  const chatKit = useChatKit(options);

  useEffect(() => {
    if (!activeThreadId || !datasets.length) {
      return;
    }

    void chatKit.sendCustomAction(
      buildThreadMetadataUpdateAction({
        title: metadata.title,
        dataset_ids: metadata.dataset_ids,
        datasets: metadata.datasets,
      }),
    );
  }, [activeThreadId, chatKit, datasets.length, metadata]);

  return <ChatKit control={chatKit.control} />;
}

export function ChatKitPane({ enabled, datasets }: { enabled: boolean; datasets: DatasetSummary[] }) {
  const [effects, setEffects] = useState<ClientEffect[]>([]);

  return (
    <Card>
      <Pill>ChatKit Surface</Pill>
      <h2>Conversation Surface</h2>
      <Meta>Model: {CHATKIT_MODEL_LABEL}</Meta>
      <List>
        {CHATKIT_TOOLS.map((tool) => (
          <li key={tool}>{formatToolLabel(tool)}</li>
        ))}
      </List>
      <List>
        {CHATKIT_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </List>
      <Surface>
        {enabled ? (
          <ConfiguredChatKit
            datasets={datasets}
            onEffects={(nextEffects) => setEffects((current) => [...nextEffects, ...current].slice(0, 6))}
          />
        ) : (
          <Empty>Sign in to start an investigation.</Empty>
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
      <Meta>{enabled ? "ChatKit is ready." : "Sign in to inspect ChatKit settings."}</Meta>
    </Card>
  );
}

