import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import styled from "styled-components";
import * as ChatKitReact from "@openai/chatkit-react";

import { DatasetChart } from "./DatasetChart";
import { apiRequest, authenticatedFetch, getChatKitConfig } from "../lib/api";
import { executeClientTool } from "../lib/chatkit-tools";
import type { ChatKitConfig } from "../types/auth";
import type {
  ChartRenderedEffect,
  ClientEffect,
  ClientToolCall,
  ClientToolName,
  DataRow,
} from "../types/analysis";
import type { DatasetSummary } from "../types/report";

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
  min-height: 360px;
  display: grid;
  place-items: center;
  text-align: center;
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

function isChartRenderedEffect(effect: ClientEffect): effect is ChartRenderedEffect {
  return effect.type === "chart_rendered";
}

export function ChatKitPane({ enabled, datasets }: { enabled: boolean; datasets: DatasetSummary[] }) {
  const [config, setConfig] = useState<ChatKitConfig | null>(null);
  const [message, setMessage] = useState("Sign in to inspect ChatKit settings.");
  const [effects, setEffects] = useState<ClientEffect[]>([]);

  const ChatKitComponent = (ChatKitReact as unknown as { ChatKit?: ComponentType<any> }).ChatKit;
  const useChatKitHook =
    (ChatKitReact as unknown as { useChatKit?: (options: unknown) => unknown }).useChatKit ??
    (() => ({
      session: null,
    }));

  useEffect(() => {
    async function loadConfig() {
      if (!enabled) {
        setConfig(null);
        setMessage("Sign in to inspect ChatKit settings.");
        return;
      }

      try {
        const nextConfig = await apiRequest<ChatKitConfig>("/chatkit/config");
        setConfig(nextConfig);
        setMessage(nextConfig.server_ready ? "ChatKit server adapter is ready." : "ChatKit dependency not installed yet.");
      } catch (error) {
        setConfig(null);
        setMessage(error instanceof Error ? error.message : "Unable to load ChatKit config.");
      }
    }

    void loadConfig();
  }, [enabled]);

  const loadedDatasets = useMemo(() => datasets.map((dataset) => ({ ...dataset, rows: dataset.sample_rows as DataRow[] })), [datasets]);

  const chatKit = useChatKitHook({
    api: {
      url: getChatKitConfig().url,
      domainKey: getChatKitConfig().domainKey,
      fetch: authenticatedFetch,
    },
    composer: config
      ? {
          models: [{ value: config.model, label: config.model }],
          tools: config.tools.map((tool) => ({ value: tool, label: formatToolLabel(tool) })),
        }
      : undefined,
    metadata: {
      dataset_ids: datasets.map((dataset) => dataset.id),
      dataset_names: datasets.map((dataset) => dataset.name),
      title: datasets.length ? `Analysis of ${datasets.length} datasets` : "New report",
    },
    onClientTool: async (toolCall: { name?: string; arguments?: Record<string, unknown> }) => {
      const name = (toolCall.name ?? "list_loaded_datasets") as ClientToolName;
      const result = await executeClientTool(
        {
          name,
          arguments: (toolCall.arguments ?? {}) as never,
        } as ClientToolCall,
        loadedDatasets,
      );
      if (result.effects.length) {
        setEffects((current) => [...result.effects, ...current].slice(0, 6));
      }
      return result.payload;
    },
  });

  return (
    <Card>
      <Pill>ChatKit Surface</Pill>
      <h2>Conversation Surface</h2>
      {config ? (
        <>
          <Meta>Model: {config.model}</Meta>
          <List>
            {config.tools.map((tool) => (
              <li key={tool}>{tool}</li>
            ))}
          </List>
          <List>
            {config.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </List>
        </>
      ) : null}
      <Surface>
        {enabled && config && ChatKitComponent ? <ChatKitComponent {...chatKit} /> : <Empty>{message}</Empty>}
      </Surface>
      {effects.length ? (
        <EffectPanel>
          {effects.map((effect, index) => (
            <EffectCard key={`${effect.type}-${index}`}>
              {isChartRenderedEffect(effect) ? (
                <DatasetChart spec={effect.chart} rows={effect.rows} />
              ) : (
                <Meta>{effect.type}</Meta>
              )}
            </EffectCard>
          ))}
        </EffectPanel>
      ) : null}
      <Meta>{message}</Meta>
    </Card>
  );
}
