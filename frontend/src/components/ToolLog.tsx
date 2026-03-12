import styled from "styled-components";

import type { ToolEvent } from "../types/report";
import { MetaText, displayHeadingCss, stackedListCss, warmSurfaceCss } from "../ui/primitives";

const Card = styled.aside`
  ${warmSurfaceCss};
  padding: 1rem 1.2rem;
`;

const Heading = styled.h3`
  ${displayHeadingCss};
  margin: 0 0 0.8rem;
  font-size: 1rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const List = styled.ul`
  ${stackedListCss};
  padding-left: 1.1rem;
  color: var(--muted);
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
            <ToolName>{event.tool}</ToolName>: <MetaText as="span">{event.detail}</MetaText>
          </li>
        ))}
      </List>
    </Card>
  );
}
