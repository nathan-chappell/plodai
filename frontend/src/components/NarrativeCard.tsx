import ReactMarkdown from "react-markdown";
import styled from "styled-components";

import type { ReportSection } from "../types/report";

const Card = styled.article`
  background: var(--panel-strong);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 1.2rem;
  box-shadow: var(--shadow);
`;

const Heading = styled.h3`
  margin: 0 0 1rem;
  font-family: var(--font-display);
  font-size: 1.35rem;
`;

const Body = styled.div`
  color: var(--muted);
  line-height: 1.7;

  h2,
  h3 {
    color: var(--ink);
    font-family: var(--font-display);
  }
`;

export function NarrativeCard({ section }: { section: ReportSection }) {
  return (
    <Card>
      <Heading>{section.title}</Heading>
      <Body>
        <ReactMarkdown>{section.markdown}</ReactMarkdown>
      </Body>
    </Card>
  );
}
