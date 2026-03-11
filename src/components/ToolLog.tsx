import styled from "styled-components";

import type { ToolEvent } from "../types/report";

const Card = styled.aside`
  background: rgba(255, 251, 245, 0.86);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 1rem 1.2rem;
`;

const Heading = styled.h3`
  margin: 0 0 0.8rem;
  font-size: 1rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const List = styled.ul`
  margin: 0;
  padding-left: 1.1rem;
  color: var(--muted);
  display: grid;
  gap: 0.7rem;
`;

const ToolName = styled.strong`
  color: var(--ink);
`;

export function ToolLog({ events }: { events: ToolEvent[] }) {
  return (
    <Card>
      <Heading>Agent Activity</Heading>
      <List>
        {events.map((event) => (
          <li key={`${event.tool}-${event.detail}`}>
            <ToolName>{event.tool}</ToolName>: {event.detail}
          </li>
        ))}
      </List>
    </Card>
  );
}
