import type { ToolEvent } from "../types/report";
import { ToolLogCard, ToolLogHeading, ToolLogList, ToolLogName } from "./styles";
import { MetaText } from "../app/styles";

export function ToolLog({ events }: { events: ToolEvent[] }) {
  return (
    <ToolLogCard>
      <ToolLogHeading>Agent Activity</ToolLogHeading>
      <ToolLogList>
        {events.map((event) => (
          <li key={`${event.tool}-${event.detail}`}>
            <ToolLogName>{event.tool}</ToolLogName>: <MetaText as="span">{event.detail}</MetaText>
          </li>
        ))}
      </ToolLogList>
    </ToolLogCard>
  );
}
