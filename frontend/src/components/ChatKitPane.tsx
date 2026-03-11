import { useEffect, useState } from "react";
import styled from "styled-components";

import { apiRequest } from "../lib/api";
import type { ChatKitConfig } from "../types/auth";

const Card = styled.section`
  background: linear-gradient(135deg, rgba(44, 62, 80, 0.94), rgba(26, 36, 47, 0.96));
  color: #f8f6f2;
  border-radius: var(--radius-xl);
  padding: 1.3rem;
  box-shadow: var(--shadow);
  display: grid;
  gap: 0.9rem;
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

export function ChatKitPane({ enabled }: { enabled: boolean }) {
  const [config, setConfig] = useState<ChatKitConfig | null>(null);
  const [message, setMessage] = useState("Sign in to inspect ChatKit settings.");

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

  return (
    <Card>
      <Pill>ChatKit Scaffold</Pill>
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
      <Meta>{message}</Meta>
    </Card>
  );
}
